// Discovers NaPista below-FIPE listings via the public JSON API embedded in
// __NEXT_DATA__. No anti-bot / Cloudflare — plain fetch with a Chrome UA.
// Outputs a list JSON to a /tmp path for napista-harvest to consume.
//
//   ./node_modules/.bin/tsx scripts/ingestion/napista-list.ts --out /tmp/napista-harvest/list.json
//     [--max-pages <n per city+year, default 10>] [--dry-run]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertSafeOutPath, isCliEntry } from "./fetch-guards";
import { throttleFetch } from "./lib/harvest-runner";
import type { NapistaCard } from "./napista-parse";

const CHROME_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) " +
  "AppleWebKit/537.36 (KHTML, like Gecko) " +
  "Chrome/125.0.0.0 Safari/537.36";

/** South-first city slugs (buyer in Santa Catarina). */
export const NAPISTA_CITY_SLUGS = [
  "florianopolis",
  "joinville",
  "blumenau",
  "curitiba",
  "porto-alegre",
  "sao-paulo",
  "rio-de-janeiro",
  "belo-horizonte",
];

/** Model years to search: 2021..current year. */
export const NAPISTA_YEARS = [2021, 2022, 2023, 2024, 2025, 2026];

export const NAPISTA_PAGE_SIZE = 48;
export const DEFAULT_MAX_PAGES = 10;

export interface NapistaListEntry {
  id: string;
  citySlug: string;
  year: number;
  card: NapistaCard;
}

export interface NapistaListResult {
  generatedAt: string;
  cities: string[];
  years: number[];
  entries: NapistaListEntry[];
}

type NextData = {
  props?: {
    pageProps?: {
      searchResult?: {
        offersTotal?: number;
        offers?: NapistaCard[];
      };
    };
  };
};

export function extractNextData(html: string): NextData | null {
  const m = html.match(/<script[^>]+id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) return null;
  try {
    return JSON.parse(m[1]) as NextData;
  } catch {
    return null;
  }
}

export function extractOffers(data: NextData): NapistaCard[] {
  return data?.props?.pageProps?.searchResult?.offers ?? [];
}

export async function fetchNapistaPage(
  citySlug: string,
  year: number,
  pageNo: number,
): Promise<NapistaCard[]> {
  const url =
    `https://napista.com.br/busca/carro/${citySlug}/${year}/valor-abaixo-da-fipe` +
    (pageNo > 1 ? `?pn=${pageNo}` : "");

  const res = await fetch(url, {
    headers: {
      "User-Agent": CHROME_UA,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
    },
  });

  if (!res.ok) {
    throw new Error(`HTTP ${res.status} fetching NaPista page: ${url}`);
  }

  const html = await res.text();
  const data = extractNextData(html);
  if (!data) return [];
  return extractOffers(data);
}

export async function listNapistaAds(options: {
  cities?: string[];
  years?: number[];
  maxPagesPerTarget?: number;
  dryRun?: boolean;
}): Promise<NapistaListResult> {
  const cities = options.cities ?? NAPISTA_CITY_SLUGS;
  const years = options.years ?? NAPISTA_YEARS;
  const maxPages = options.maxPagesPerTarget ?? DEFAULT_MAX_PAGES;

  const byId = new Map<string, NapistaListEntry>();

  for (const citySlug of cities) {
    for (const year of years) {
      for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
        let offers: NapistaCard[];
        try {
          offers = await fetchNapistaPage(citySlug, year, pageNo);
        } catch (err) {
          console.error(
            `NaPista fetch error (${citySlug}/${year} p${pageNo}):`,
            err instanceof Error ? err.message : String(err),
          );
          break;
        }

        if (offers.length === 0) break;

        let newOnPage = 0;
        for (const card of offers) {
          if (card.id && !byId.has(card.id)) {
            byId.set(card.id, { id: card.id, citySlug, year, card });
            newOnPage++;
          }
        }

        // If nothing new this page, we've run past the end.
        if (newOnPage === 0) break;

        if (options.dryRun) break; // one page per target in dry-run

        await throttleFetch();
      }
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    cities,
    years,
    entries: [...byId.values()],
  };
}

function parseArgs(argv: string[]) {
  let out = "/tmp/napista-harvest/list.json";
  let maxPages = DEFAULT_MAX_PAGES;
  let dryRun = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out" && argv[i + 1]) out = argv[++i]!;
    else if (arg === "--max-pages" && argv[i + 1]) maxPages = Number(argv[++i]);
    else if (arg === "--dry-run") dryRun = true;
  }
  return { out, maxPages, dryRun };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await listNapistaAds({ maxPagesPerTarget: args.maxPages, dryRun: args.dryRun });
  const safeOut = assertSafeOutPath(args.out);
  mkdirSync(dirname(safeOut), { recursive: true });
  writeFileSync(safeOut, JSON.stringify(result, null, 2), "utf8");
  console.log(
    JSON.stringify({ entries: result.entries.length, cities: result.cities.length, out: safeOut }),
  );
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
