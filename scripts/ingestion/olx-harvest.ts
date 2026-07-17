// End-to-end OLX repasse harvest: reads the olx-list.ts output, fetches each
// ad detail via Playwright+stealth (cached in fetchDir), parses the embedded
// JSON, and writes pre_repossession leads through write-lead. Mirrors
// santander-harvest. Never logs in, never contacts sellers.
//
//   ./node_modules/.bin/tsx scripts/ingestion/olx-harvest.ts
//     [--list /tmp/olx-harvest/list.json] [--fetch-dir /tmp/olx-harvest/details]
//     [--dry-run] [--limit <n>] [--no-goal-filter] [--summary-out <file>]

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { chromium } from "playwright-extra";
import type { Page } from "playwright";
import stealth from "puppeteer-extra-plugin-stealth";
import {
  assertNotCloudflareBlock,
  assertSafeOutPath,
  isCliEntry,
} from "./fetch-guards";
import type { OlxListResult } from "./olx-list";
import { olxToWriteLead, parseOlxDetail } from "./olx-parse";
import {
  bumpSkip,
  createHarvestSummary,
  DEFAULT_CEILING,
  hasReachedCeiling,
  recordWriteResult,
  spawnWriteLead,
  throttleFetch,
  writeSummary,
  type HarvestSummary,
} from "./lib/harvest-runner";

chromium.use(stealth());

export class OlxFetchError extends Error {}

/** OLX serves ads from regional subdomains (sp.olx.com.br, pa.olx.com.br, …). */
export function assertOlxHost(url: string): void {
  const host = new URL(url).hostname.toLowerCase();
  if (host !== "olx.com.br" && !host.endsWith(".olx.com.br")) {
    throw new OlxFetchError(`URL host not allowed for OLX: ${host}`);
  }
}

export async function fetchOlxHtmlWithPage(page: Page, url: string): Promise<string> {
  assertOlxHost(url);
  const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(2500);
  assertOlxHost(page.url());
  const html = await page.content();
  assertNotCloudflareBlock(html, url);
  if (response && response.status() >= 400) {
    throw new OlxFetchError(`HTTP ${response.status()} for ${url}`);
  }
  return html;
}

export async function harvestOlxAds(options: {
  listPath: string;
  fetchDir?: string;
  dryRun?: boolean;
  limit?: number;
  ceiling?: number;
  skipExisting?: boolean;
  summaryOut?: string;
  applyGoalFilter?: boolean;
}): Promise<HarvestSummary> {
  const summary = createHarvestSummary("OLX");
  const payload = JSON.parse(readFileSync(options.listPath, "utf8")) as OlxListResult;
  const ads = options.limit ? payload.ads.slice(0, options.limit) : payload.ads;
  const fetchDir = options.fetchDir ?? "/tmp/olx-harvest/details";
  const ceiling = options.ceiling ?? DEFAULT_CEILING;
  const skipExisting = options.skipExisting ?? true;

  mkdirSync(fetchDir, { recursive: true });

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();

    for (const ad of ads) {
      summary.scanned++;

      const htmlPath = join(fetchDir, `${ad.listId}.html`);
      let html: string;
      if (skipExisting && existsSync(htmlPath)) {
        html = readFileSync(htmlPath, "utf8");
      } else {
        try {
          html = await fetchOlxHtmlWithPage(page, ad.url);
          writeFileSync(htmlPath, html, "utf8");
          await throttleFetch();
        } catch (error) {
          bumpSkip(summary, "fetch_error");
          summary.errors.push({
            url: ad.url,
            error: error instanceof Error ? error.message : String(error),
          });
          continue;
        }
      }

      const detail = parseOlxDetail(html);
      if (!detail) {
        bumpSkip(summary, "no_initial_data");
        continue;
      }

      const { input, skipReason } = olxToWriteLead(detail);
      if (!input) {
        bumpSkip(summary, skipReason ?? "skipped");
        continue;
      }

      if (hasReachedCeiling(summary, ceiling)) {
        bumpSkip(summary, "ceiling");
        continue;
      }

      if (options.dryRun) {
        recordWriteResult(summary, { created: true });
        if (summary.sampleUrls.length < 10) summary.sampleUrls.push(input.sourceUrl);
        continue;
      }

      const writeResult = spawnWriteLead(input);
      if (!writeResult.ok) {
        bumpSkip(summary, "write_error");
        summary.errors.push({ url: input.sourceUrl, error: writeResult.error ?? "" });
        continue;
      }
      recordWriteResult(summary, writeResult.result ?? { created: true });
      if (summary.sampleUrls.length < 10) summary.sampleUrls.push(input.sourceUrl);
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

function parseArgs(argv: string[]) {
  let listPath = "/tmp/olx-harvest/list.json";
  let fetchDir = "/tmp/olx-harvest/details";
  let dryRun = false;
  let limit: number | undefined;
  let skipExisting = true;
  let summaryOut = "/tmp/olx-harvest/write-summary.json";
  let noGoalFilter = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--list" && argv[i + 1]) listPath = argv[++i]!;
    else if (arg === "--fetch-dir" && argv[i + 1]) fetchDir = argv[++i]!;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--limit" && argv[i + 1]) limit = Number(argv[++i]);
    else if (arg === "--no-skip-existing") skipExisting = false;
    else if (arg === "--summary-out" && argv[i + 1]) summaryOut = argv[++i]!;
    else if (arg === "--no-goal-filter") noGoalFilter = true;
  }
  return { listPath, fetchDir, dryRun, limit, skipExisting, summaryOut, noGoalFilter };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = await harvestOlxAds({
    listPath: assertSafeOutPath(args.listPath),
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
