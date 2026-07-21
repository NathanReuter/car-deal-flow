// Discovers Webmotors individual-seller (PF) car listings via their internal
// JSON API. Uses Playwright+stealth to bypass PerimeterX, mirrors the
// olx-list.ts / olx-harvest.ts pattern. Never logs in.
//
// Strategy:
//   1. Warm up the Webmotors homepage so PerimeterX grants a session cookie.
//   2. For each keyword pass, hit /api/search/car with tipovendedor=PF.
//   3. Paginate until SearchResults is empty (Pagination.PageTotal is always 0).
//   4. Deduplicate by UniqueId and write a JSON list file.
//
//   ./node_modules/.bin/tsx scripts/ingestion/webmotors-list.ts \
//     --out /tmp/webmotors-harvest/list.json [--max-pages 10] [--dry-run]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright-extra";
import type { Page } from "playwright";
import stealth from "puppeteer-extra-plugin-stealth";
import { assertSafeOutPath, isCliEntry } from "./fetch-guards";
import { throttleFetch } from "./lib/harvest-runner";
import type { WebmotorsSearchResult } from "./webmotors-parse";

chromium.use(stealth());

// ─── Constants ──────────────────────────────────────────────────────────────

export const WM_HOMEPAGE = "https://www.webmotors.com.br/";
export const WM_API_BASE = "https://www.webmotors.com.br/api/search/car";

/** Repasse-signal keywords — relevance filter, not exact-match. Re-checked at parse. */
export const WM_QUERIES = ["repasse", "assumo+financiamento", "financiado"];

export const DEFAULT_MAX_PAGES = 10;

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WmListCard {
  uniqueId: string;
  title: string;
  brand: string;
  model: string;
  year: number;
  priceBRL: number | null;
  city: string;
  state: string;
}

export interface WmListResult {
  generatedAt: string;
  queries: string[];
  ads: WmListCard[];
}

// ─── API helpers ─────────────────────────────────────────────────────────────

function buildApiUrl(keyword: string, page: number): string {
  const params = new URLSearchParams({
    tipovendedor: "PF",
    tipoveiculo: "carros",
    q: keyword.replace(/\+/g, " "), // URLSearchParams will re-encode spaces
    pagina: String(page),
    quantidade: "24",
    ordem: "1",
  });
  return `${WM_API_BASE}?${params.toString()}`;
}

interface WmApiResponse {
  SearchResults?: WebmotorsSearchResult[];
}

async function fetchApiPage(
  page: Page,
  keyword: string,
  pageNo: number,
): Promise<WebmotorsSearchResult[]> {
  const url = buildApiUrl(keyword, pageNo);

  const results = await page.evaluate(async (apiUrl: string) => {
    const resp = await fetch(apiUrl, {
      headers: { "Accept": "application/json" },
      credentials: "include",
    });
    if (!resp.ok) return null;
    return resp.json() as Promise<unknown>;
  }, url);

  if (!results || typeof results !== "object") return [];
  const body = results as WmApiResponse;
  return body.SearchResults ?? [];
}

function resultToCard(r: WebmotorsSearchResult): WmListCard {
  const loc = r.Seller.Localization?.[0];
  const city = loc?.City ?? r.Seller.City ?? "";
  const abbrState = loc?.AbbrState ?? extractAbbrState(r.Seller.State ?? "");
  const price =
    typeof r.Prices.Price === "number" && r.Prices.Price > 0 ? r.Prices.Price : null;
  return {
    uniqueId: String(r.UniqueId),
    title: r.Specification.Title ?? "",
    brand: r.Specification.Make?.Value ?? "",
    model: r.Specification.Model?.Value ?? "",
    year: r.Specification.YearModel ?? 0,
    priceBRL: price,
    city,
    state: abbrState,
  };
}

function extractAbbrState(raw: string): string {
  const m = raw.match(/\(([A-Z]{2})\)/);
  return m ? m[1] : raw;
}

// ─── Core list function ───────────────────────────────────────────────────────

export async function listWebmotorsAds(options: {
  queries?: string[];
  maxPagesPerQuery?: number;
  page: Page;
}): Promise<WmListResult> {
  const queries = options.queries ?? WM_QUERIES;
  const maxPages = options.maxPagesPerQuery ?? DEFAULT_MAX_PAGES;
  const byId = new Map<string, WmListCard>();

  for (const keyword of queries) {
    for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
      const results = await fetchApiPage(options.page, keyword, pageNo);
      if (results.length === 0) break;

      let newOnPage = 0;
      for (const r of results) {
        const id = String(r.UniqueId);
        if (!byId.has(id)) {
          byId.set(id, resultToCard(r));
          newOnPage++;
        }
      }
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

// ─── CLI entry ────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  let out = "/tmp/webmotors-harvest/list.json";
  let maxPages = DEFAULT_MAX_PAGES;
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
    // Warm up the homepage so PerimeterX issues a valid session cookie.
    await page.goto(WM_HOMEPAGE, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3000);

    const result = await listWebmotorsAds({
      queries: [...WM_QUERIES, ...args.extraQueries],
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
