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
  isAllowedBidchainHost,
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

export function normalizeBidchainLotUrl(raw: string, baseUrl: string): string | null {
  try {
    const url = raw.startsWith("http") ? raw : new URL(raw, baseUrl).toString();
    if (!/\/lote\/\d+/i.test(url)) return null;
    assertAllowedBidchainUrl(url);
    return url;
  } catch {
    return null;
  }
}

export function extractBidchainPaginationUrls(html: string, baseUrl: string): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (href: string) => {
    try {
      const url = new URL(href, baseUrl).toString();
      assertAllowedBidchainUrl(url);
      if (seen.has(url)) return;
      seen.add(url);
      out.push(url);
    } catch {
      // skip non-allowlisted or invalid hrefs
    }
  };

  for (const match of html.matchAll(/href=["']([^"']*(?:[?&]page=\d+|\/page\/\d+)[^"']*)["']/gi)) {
    add(match[1] ?? "");
  }
  for (const match of html.matchAll(
    /href=["']([^"']+)["'][^>]*>\s*(?:Next|Próximo|Próxima|›|»|&gt;)/gi,
  )) {
    add(match[1] ?? "");
  }
  return out;
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

    const url = normalizeBidchainLotUrl(path, baseUrl);
    if (!url) continue;
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

  return lots.filter((lot) => isAllowedBidchainHost(lot.host));
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
      const visited = new Set<string>();
      const queue = [parsed.toString()];

      while (queue.length > 0 && visited.size < maxPages) {
        const pageUrl = queue.shift()!;
        if (visited.has(pageUrl)) continue;
        visited.add(pageUrl);

        const response = await page.goto(pageUrl, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
        await page.waitForTimeout(1500);
        assertFinalUrlAllowed(page.url(), BIDCHAIN_ALLOWED_HOSTS, "BIDchain");
        assertHttpOk(response, pageUrl);
        const html = await page.content();
        assertNotCloudflareBlock(html, pageUrl);

        for (const lot of extractBidchainLotsFromHtml(html, page.url())) {
          const filter = filterBidchainListLot(lot);
          if (!filter.keep) {
            bumpSkip(skipped, filter.reason ?? "skipped");
            continue;
          }
          byId.set(lot.id, lot);
        }

        for (const nextUrl of extractBidchainPaginationUrls(html, page.url())) {
          if (!visited.has(nextUrl) && !queue.includes(nextUrl)) {
            queue.push(nextUrl);
          }
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
