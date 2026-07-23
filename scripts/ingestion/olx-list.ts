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
  "transferir financiamento",
  "veículo já financiado",
  "quitar e transferir",
  "aceito repasse",
];

/**
 * OLX regional subdomains to search, ordered south-first (buyer is in SC;
 * southern cars are cheaper to inspect/transport). www is the national
 * fallback and comes last since it heavily overlaps the regional results.
 */
export const OLX_REGION_HOSTS = [
  "sc",
  "pr",
  "rs",
  "sp",
  "rj",
  "mg",
  "pb",
  "pe",
  "ce",
  "rn",
  "www",
];

const OLX_PATH = "/autos-e-pecas/carros-vans-e-utilitarios";

/** Builds the OLX search URL for a given subdomain, query, and page number. */
export function buildOlxSearchUrl(host: string, query: string, pageNo: number): string {
  const base = `https://${host}.olx.com.br${OLX_PATH}`;
  const qs = `?q=${encodeURIComponent(query)}` + (pageNo > 1 ? `&o=${pageNo}` : "");
  return base + qs;
}

/** Deduplicate OlxSearchCards by listId — first occurrence (lowest-index region) wins. */
export function dedupeByListId(cards: OlxSearchCard[]): OlxSearchCard[] {
  const seen = new Set<string>();
  const out: OlxSearchCard[] = [];
  for (const card of cards) {
    if (!seen.has(card.listId)) {
      seen.add(card.listId);
      out.push(card);
    }
  }
  return out;
}

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

/** Transient network faults (flaky wifi, mid-request Cloudflare hiccups) worth
 * retrying. Deliberately narrow — parse/block failures must still fail closed. */
export function isRetryableGotoError(message: string): boolean {
  return /net::ERR_(NETWORK_CHANGED|CONNECTION_RESET|CONNECTION_CLOSED|CONNECTION_REFUSED|CONNECTION_TIMED_OUT|TIMED_OUT|INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|ADDRESS_UNREACHABLE)/i.test(
    message,
  );
}

/** page.goto with bounded retry/backoff for transient network errors only.
 * Non-retryable errors (and exhausted retries) propagate unchanged. */
export async function gotoWithRetry(
  page: Page,
  url: string,
  options: { timeout?: number; maxAttempts?: number; backoffMs?: number } = {},
): Promise<void> {
  const maxAttempts = options.maxAttempts ?? 3;
  const backoffMs = options.backoffMs ?? 1500;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: options.timeout ?? 60_000 });
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!isRetryableGotoError(message) || attempt === maxAttempts) throw error;
      await new Promise((resolve) => setTimeout(resolve, backoffMs * attempt));
    }
  }
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
  regions?: string[];
  page: Page;
}): Promise<OlxListResult> {
  const queries = options.queries ?? OLX_QUERIES;
  const maxPages = options.maxPagesPerQuery ?? 8;
  const regions = options.regions ?? OLX_REGION_HOSTS;
  // Cross-region dedupe: first occurrence (earliest region in the ordered list) wins.
  const byId = new Map<string, OlxSearchCard>();

  for (const host of regions) {
    for (const query of queries) {
      for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
        const url = buildOlxSearchUrl(host, query, pageNo);
        await gotoWithRetry(options.page, url);
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
  }

  return {
    generatedAt: new Date().toISOString(),
    queries,
    ads: [...byId.values()],
  };
}

function parseArgs(argv: string[]) {
  let out = "/tmp/olx-harvest/list.json";
  let maxPages = 8;
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
