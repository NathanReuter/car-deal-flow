import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import {
  assertFinalUrlAllowed,
  assertHttpOk,
  assertNotCloudflareBlock,
  assertSafeOutPath,
  isCliEntry,
} from "./fetch-guards";
import {
  assertAllowedBidchainUrl,
  BIDCHAIN_ALLOWED_HOSTS,
} from "./bidchain-fetch";
import { detectDamageSignals } from "../../src/lib/filters/damageSignals";

chromium.use(stealth());

export type BidchainListLot = {
  id: string;
  url: string;
  title: string;
  host: string;
};

export type BidchainListResult = {
  lots: BidchainListLot[];
  meta: { pages: number; sources: string[]; total: number };
  skipped: Record<string, number>;
};

const LOTE_HREF = /href=["']([^"']*\/lote\/(\d+)(?:\/[^"'#?]*)?)["']/gi;

export function extractBidchainLotId(url: string): string | null {
  const m = url.match(/\/lote\/(\d+)/i);
  return m?.[1] ?? null;
}

export function extractBidchainLotsFromHtml(
  html: string,
  baseUrl: string,
): BidchainListLot[] {
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const lots: BidchainListLot[] = [];

  for (const match of html.matchAll(LOTE_HREF)) {
    const path = match[1] ?? "";
    const id = match[2];
    if (!id || seen.has(id)) continue;

    const url = path.startsWith("http")
      ? path
      : `${base.origin}${path.startsWith("/") ? path : `/${path}`}`;
    seen.add(id);

    const anchorRe = new RegExp(
      `<a[^>]+href=["'][^"']*\\/lote\\/${id}[^"']*["'][^>]*>([\\s\\S]*?)<\\/a>`,
      "i",
    );
    const anchor = html.match(anchorRe);
    const title = (anchor?.[1] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    lots.push({
      id,
      url,
      title: title || `Lote ${id}`,
      host: new URL(url).hostname.toLowerCase(),
    });
  }

  return lots;
}

export function filterBidchainListLot(
  lot: BidchainListLot,
): { keep: boolean; reason?: string } {
  const blob = `${lot.title} ${lot.url}`;
  if (/\bsucata\b|\bbatido\b|sinistrad/i.test(blob)) {
    return { keep: false, reason: "damage_list_title" };
  }
  const damage = detectDamageSignals(blob);
  if (damage.blocked) {
    return { keep: false, reason: `damage_list:${damage.reasons.join(",")}` };
  }
  if (
    /\b(moto|motocicleta|caminh[aã]o|onibus|ônibus|trator)\b/i.test(blob) ||
    /\bcg\s*\d/i.test(blob)
  ) {
    return { keep: false, reason: "non_car" };
  }
  return { keep: true };
}

function bumpSkip(skipped: Record<string, number>, reason: string) {
  skipped[reason] = (skipped[reason] ?? 0) + 1;
}

export async function listBidchainLots(options: {
  seedUrls?: string[];
  maxPages?: number;
}): Promise<BidchainListResult> {
  const seeds =
    options.seedUrls ??
    [
      "https://bidchain.com.br/por-categoria/4",
      "https://bidchain.com.br/leiloes",
    ];
  const maxPages = options.maxPages ?? 20;
  const skipped: Record<string, number> = {};
  const byId = new Map<string, BidchainListLot>();

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    for (const seed of seeds) {
      const parsed = assertAllowedBidchainUrl(seed);
      const response = await page.goto(parsed.toString(), {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      await page.waitForTimeout(1500);
      assertFinalUrlAllowed(page.url(), BIDCHAIN_ALLOWED_HOSTS, "BIDchain");
      assertHttpOk(response, parsed.toString());
      const html = await page.content();
      assertNotCloudflareBlock(html, parsed.toString());

      for (const lot of extractBidchainLotsFromHtml(html, page.url())) {
        const filter = filterBidchainListLot(lot);
        if (!filter.keep) {
          bumpSkip(skipped, filter.reason ?? "skipped");
          continue;
        }
        byId.set(lot.id, lot);
      }

      for (let p = 2; p <= maxPages; p++) {
        const nextUrl = `${parsed.origin}${parsed.pathname}?page=${p}`;
        try {
          const next = assertAllowedBidchainUrl(nextUrl);
          const nextResp = await page.goto(next.toString(), {
            waitUntil: "domcontentloaded",
            timeout: 60_000,
          });
          await page.waitForTimeout(1200);
          const nextHtml = await page.content();
          assertHttpOk(nextResp, next.toString());
          const batch = extractBidchainLotsFromHtml(nextHtml, page.url());
          if (batch.length === 0) break;
          let added = 0;
          for (const lot of batch) {
            const filter = filterBidchainListLot(lot);
            if (!filter.keep) {
              bumpSkip(skipped, filter.reason ?? "skipped");
              continue;
            }
            if (!byId.has(lot.id)) {
              byId.set(lot.id, lot);
              added++;
            }
          }
          if (added === 0) break;
        } catch {
          break;
        }
      }
    }
  } finally {
    await browser.close();
  }

  const lots = [...byId.values()];
  return {
    lots,
    meta: { pages: maxPages, sources: seeds, total: lots.length },
    skipped,
  };
}

function parseArgs(argv: string[]): { out: string; maxPages?: number } {
  let out = "/tmp/bidchain-lots.json";
  let maxPages: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out" && argv[i + 1]) out = argv[++i]!;
    else if (arg === "--max-pages" && argv[i + 1]) maxPages = Number(argv[++i]);
  }
  return { out, maxPages };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await listBidchainLots({ maxPages: args.maxPages });
  const safeOut = assertSafeOutPath(args.out);
  mkdirSync(dirname(safeOut), { recursive: true });
  writeFileSync(safeOut, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
