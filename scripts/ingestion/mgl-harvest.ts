import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { assertSafeOutPath, isCliEntry } from "./fetch-guards";
import {
  assertAllowedMglUrl,
  MGL_ALLOWED_HOSTS,
} from "./mgl-fetch";
import { listMglAuctionLots } from "./mgl-list-lots";
import type { MglAuctionListResult } from "./mgl-list-auctions";
import { parseMglLead, type MglListLotRow } from "./mgl-parse";
import { detectDamageSignals } from "../../src/lib/filters/damageSignals";
import {
  bumpSkip,
  createHarvestSummary,
  DEFAULT_CEILING,
  hasReachedCeiling,
  recordWriteResult,
  spawnWriteLead,
  writeSummary,
  type HarvestSummary,
} from "./lib/harvest-runner";
import {
  assertFinalUrlAllowed,
  assertHttpOk,
  assertNotCloudflareBlock,
} from "./fetch-guards";

chromium.use(stealth());

function runCheckDamage(text: string): { blocked: boolean; reasons: string[] } {
  const cleaned = text.replace(/eventual\s+sinistro[^.]{0,80}\.?/gi, " ");
  const r = detectDamageSignals(cleaned);
  return { blocked: r.blocked, reasons: r.reasons };
}

export async function harvestMglLots(options: {
  auctionsPath: string;
  fetchDir?: string;
  dryRun?: boolean;
  limit?: number;
  ceiling?: number;
  skipExisting?: boolean;
  summaryOut?: string;
  applyGoalFilter?: boolean;
}): Promise<HarvestSummary> {
  const summary = createHarvestSummary("MGL");
  const ceiling = options.ceiling ?? DEFAULT_CEILING;
  const fetchDir = options.fetchDir ?? "/tmp/mgl-harvest/lots";
  mkdirSync(fetchDir, { recursive: true });

  const payload = JSON.parse(readFileSync(options.auctionsPath, "utf8")) as MglAuctionListResult;
  const allLots: MglListLotRow[] = [];

  for (const auction of payload.auctions) {
    const listed = await listMglAuctionLots(auction.url);
    for (const lot of listed.lots) {
      allLots.push({
        id: lot.id,
        url: lot.url,
        statusLote: lot.statusLote,
        statusLeilao: lot.statusLeilao,
        statusLabel: lot.statusLabel,
        valorMinimo: lot.valorMinimo,
        valorVendaDireta: lot.valorVendaDireta,
        valorAvaliacao: lot.valorAvaliacao,
        isVendaDireta: lot.isVendaDireta,
        categoria: lot.categoria,
        auctionId: listed.auctionId,
        titulo: lot.titulo,
      });
    }
  }

  const lots = options.limit ? allLots.slice(0, options.limit) : allLots;
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const lot of lots) {
      summary.scanned++;
      const htmlPath = join(fetchDir, `${lot.id}.html`);
      let html: string;

      if (options.skipExisting !== false && existsSync(htmlPath)) {
        html = readFileSync(htmlPath, "utf8");
      } else {
        try {
          const parsed = assertAllowedMglUrl(lot.url);
          const response = await page.goto(parsed.toString(), {
            waitUntil: "domcontentloaded",
            timeout: 60_000,
          });
          await page.waitForTimeout(2000);
          assertFinalUrlAllowed(page.url(), MGL_ALLOWED_HOSTS, "MGL");
          html = await page.content();
          assertNotCloudflareBlock(html, parsed.toString());
          assertHttpOk(response, parsed.toString());
          writeFileSync(htmlPath, html, "utf8");
        } catch (error) {
          bumpSkip(summary, "fetch_error");
          summary.errors.push({
            url: lot.url,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
      }

      if (/Attention Required!\s*\|\s*Cloudflare/i.test(html) || html.length < 5000) {
        bumpSkip(summary, "bad_html");
        continue;
      }

      const parsed = parseMglLead(lot.id, lot.url, html, lot);
      if (!parsed.input) {
        bumpSkip(summary, parsed.skip ?? "skipped");
        continue;
      }

      const dmg = runCheckDamage(
        [parsed.input.notes ?? "", lot.url, lot.titulo ?? ""].join("\n"),
      );
      if (dmg.blocked) {
        bumpSkip(summary, "damage");
        continue;
      }

      if (hasReachedCeiling(summary, ceiling)) {
        bumpSkip(summary, "ceiling");
        continue;
      }

      if (options.dryRun) {
        recordWriteResult(summary, { created: true });
        continue;
      }

      const writeResult = spawnWriteLead(parsed.input);
      if (!writeResult.ok) {
        bumpSkip(
          summary,
          /damage|sinistro|monta|sucata|batido/i.test(writeResult.error ?? "")
            ? "damage_write_lead"
            : "write_error",
        );
        if (!/damage|sinistro|monta|sucata|batido/i.test(writeResult.error ?? "")) {
          summary.errors.push({ url: parsed.input.sourceUrl, error: writeResult.error ?? "" });
        }
        continue;
      }
      recordWriteResult(summary, writeResult.result ?? { created: true });
    }
  } finally {
    await browser.close();
  }

  if (options.summaryOut) writeSummary(options.summaryOut, summary);

  if (options.applyGoalFilter !== false && !options.dryRun) {
    spawnSync(
      "./node_modules/.bin/tsx",
      ["scripts/ingestion/apply-goal-filter.ts", "--min-goal-fit", "50"],
      { encoding: "utf8", cwd: process.cwd(), stdio: "inherit" },
    );
  }

  return summary;
}

function parseArgs(argv: string[]): {
  auctionsPath: string;
  fetchDir: string;
  dryRun: boolean;
  limit?: number;
  skipExisting: boolean;
  summaryOut?: string;
  noGoalFilter: boolean;
} {
  let auctionsPath = "/tmp/mgl-auctions.json";
  let fetchDir = "/tmp/mgl-harvest/lots";
  let dryRun = false;
  let limit: number | undefined;
  let skipExisting = true;
  let summaryOut = "/tmp/mgl-harvest/write-summary.json";
  let noGoalFilter = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--auctions" && argv[i + 1]) auctionsPath = argv[++i]!;
    else if (arg === "--fetch-dir" && argv[i + 1]) fetchDir = argv[++i]!;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--limit" && argv[i + 1]) limit = Number(argv[++i]);
    else if (arg === "--skip-existing") skipExisting = true;
    else if (arg === "--no-skip-existing") skipExisting = false;
    else if (arg === "--summary-out" && argv[i + 1]) summaryOut = argv[++i]!;
    else if (arg === "--no-goal-filter") noGoalFilter = true;
  }

  return { auctionsPath, fetchDir, dryRun, limit, skipExisting, summaryOut, noGoalFilter };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = await harvestMglLots({
    auctionsPath: assertSafeOutPath(args.auctionsPath),
    fetchDir: assertSafeOutPath(args.fetchDir),
    dryRun: args.dryRun,
    limit: args.limit,
    skipExisting: args.skipExisting,
    summaryOut: args.summaryOut ? assertSafeOutPath(args.summaryOut) : undefined,
    applyGoalFilter: !args.noGoalFilter,
  });
  console.log(JSON.stringify(summary, null, 2));
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
