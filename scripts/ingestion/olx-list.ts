// Discovers OLX repasse ad URLs from public search results. Deterministic
// discovery only — parsing/writing happens in olx-parse/olx-harvest. OLX sits
// behind Cloudflare, so this uses the same Playwright+stealth stack as
// mgl-fetch (probe: docs/superpowers/specs/2026-07-17-olx-repasse-probe.md).
// Never logs in.
//
//   ./node_modules/.bin/tsx scripts/ingestion/olx-list.ts --out /tmp/olx-harvest/list.json
//     [--max-pages <n per query, default 5>] [--query "extra query"]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright-extra";
import type { Page } from "playwright";
import stealth from "puppeteer-extra-plugin-stealth";
import { assertSafeOutPath, isCliEntry } from "./fetch-guards";
import { throttleFetch } from "./lib/harvest-runner";
import { parseBrl } from "./lib/parse-common";

chromium.use(stealth());

export const OLX_SEARCH_BASE =
  "https://www.olx.com.br/autos-e-pecas/carros-vans-e-utilitarios";

/** Queries that surface financing-transfer ads. Signal is re-checked at parse. */
export const OLX_QUERIES = [
  "repasse financiamento",
  "assumo financiamento",
  "passo financiamento",
];

export interface OlxSearchCard {
  url: string;
  listId: string;
  title: string;
  /** Listed price (usually the entrada ask for repasse ads); null when absent. */
  priceBRL: number | null;
  postedLabel: string | null;
}

export interface OlxListResult {
  generatedAt: string;
  queries: string[];
  ads: OlxSearchCard[];
}

const CARD_RE = /<section[^>]*class="[^"]*olx-adcard[^"]*"[^>]*>[\s\S]*?<\/section>/g;
const AD_URL_RE =
  /href="(https:\/\/[a-z]{2}\.olx\.com\.br\/[^"]*?-(\d{9,}))(?:[?#][^"]*)?"/;

export function parseOlxSearchCards(html: string): OlxSearchCard[] {
  const cards: OlxSearchCard[] = [];
  for (const section of html.match(CARD_RE) ?? []) {
    const link = section.match(AD_URL_RE);
    if (!link) continue;
    const title = section.match(/<h2[^>]*>([^<]+)<\/h2>/);
    const price = section.match(/R\$\s?[\d.]+/);
    const posted = section.match(/olx-adcard__date[^>]*>([^<]+)</);
    cards.push({
      url: link[1],
      listId: link[2],
      title: title ? title[1].trim() : "",
      priceBRL: price ? parseBrl(price[0]) : null,
      postedLabel: posted ? posted[1].trim() : null,
    });
  }
  return cards;
}

export async function listOlxAds(options: {
  queries?: string[];
  maxPagesPerQuery?: number;
  page: Page;
}): Promise<OlxListResult> {
  const queries = options.queries ?? OLX_QUERIES;
  const maxPages = options.maxPagesPerQuery ?? 5;
  const byId = new Map<string, OlxSearchCard>();

  for (const query of queries) {
    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
      const url =
        `${OLX_SEARCH_BASE}?q=${encodeURIComponent(query)}` +
        (pageNo > 1 ? `&o=${pageNo}` : "");
      await options.page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await options.page.waitForTimeout(2500);
      const cards = parseOlxSearchCards(await options.page.content());
      if (cards.length === 0) break;
      let newOnPage = 0;
      for (const card of cards) {
        if (!byId.has(card.listId)) {
          byId.set(card.listId, card);
          newOnPage++;
        }
      }
      // A page with nothing new means we ran past the end of this query.
      if (newOnPage === 0) break;
      await throttleFetch();
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    queries,
    ads: [...byId.values()],
  };
}

function parseArgs(argv: string[]) {
  let out = "/tmp/olx-harvest/list.json";
  let maxPages = 5;
  const extraQueries: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out" && argv[i + 1]) out = argv[++i]!;
    else if (arg === "--max-pages" && argv[i + 1]) maxPages = Number(argv[++i]);
    else if (arg === "--query" && argv[i + 1]) extraQueries.push(argv[++i]!);
  }
  return { out, maxPages, extraQueries };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const result = await listOlxAds({
      queries: [...OLX_QUERIES, ...args.extraQueries],
      maxPagesPerQuery: args.maxPages,
      page,
    });
    const safeOut = assertSafeOutPath(args.out);
    mkdirSync(dirname(safeOut), { recursive: true });
    writeFileSync(safeOut, JSON.stringify(result, null, 2), "utf8");
    console.log(
      JSON.stringify({ ads: result.ads.length, queries: result.queries.length, out: safeOut }),
    );
  } finally {
    await browser.close();
  }
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
