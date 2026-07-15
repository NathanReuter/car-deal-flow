import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertSafeOutPath, isCliEntry } from "./fetch-guards";
import { detectDamageSignals } from "../../src/lib/filters/damageSignals";
import { shouldSkipListing } from "./lib/listing-filters";

export const BRADESCO_API_BASE = "https://api.vitrinebradesco.com.br/v1";

export type BradescoListLot = {
  guid: string;
  slug?: string;
  name?: string;
  price?: number | null;
  category?: string;
  description?: string;
  city?: string | null;
  state?: string | null;
  auction_date?: string | null;
  vehicle_type_of_recovery?: string | null;
  type?: string;
  is_waste?: boolean;
};

export type BradescoListResult = {
  lots: BradescoListLot[];
  meta: {
    pages: number;
    total: number;
    fetchedPages: number;
  };
  skipped: Record<string, number>;
};

export function parseBradescoListResponse(body: unknown): {
  lots: BradescoListLot[];
  totalPages: number;
  totalAuctions: number;
} {
  const payload = body as {
    data?: BradescoListLot[];
    total_pages?: number;
    total_auctions?: number;
  };
  return {
    lots: payload.data ?? [],
    totalPages: payload.total_pages ?? 0,
    totalAuctions: payload.total_auctions ?? 0,
  };
}

export function filterBradescoListLot(
  lot: BradescoListLot,
): { keep: boolean; reason?: string } {
  const category = (lot.category || "").trim();
  if (category && category !== "Carro") {
    return { keep: false, reason: `non_car_category:${category}` };
  }

  if (lot.is_waste) {
    return { keep: false, reason: "is_waste" };
  }

  const recoverySkip = shouldSkipListing({
    recoveryType: lot.vehicle_type_of_recovery ?? undefined,
  });
  if (recoverySkip.skip) {
    return { keep: false, reason: recoverySkip.reason };
  }

  const description = lot.description ?? "";
  const damage = detectDamageSignals(description);
  if (damage.blocked) {
    return { keep: false, reason: `damage_list:${damage.reasons.join(",")}` };
  }

  return { keep: true };
}

function bumpSkip(skipped: Record<string, number>, reason: string) {
  skipped[reason] = (skipped[reason] ?? 0) + 1;
}

export async function fetchBradescoListPage(page: number): Promise<{
  lots: BradescoListLot[];
  totalPages: number;
  totalAuctions: number;
}> {
  const url = `${BRADESCO_API_BASE}/auctions?page=${page}&type=vehicles`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Bradesco list HTTP ${response.status} for page ${page}`);
  }
  const body = await response.json();
  return parseBradescoListResponse(body);
}

export async function listBradescoVehicles(options?: {
  maxPages?: number;
}): Promise<BradescoListResult> {
  const maxPages = options?.maxPages;
  const lots: BradescoListLot[] = [];
  const skipped: Record<string, number> = {};
  let totalPages = 0;
  let totalAuctions = 0;
  let fetchedPages = 0;

  for (let page = 1; ; page++) {
    if (maxPages !== undefined && page > maxPages) break;

    const payload = await fetchBradescoListPage(page);
    totalPages = payload.totalPages;
    totalAuctions = payload.totalAuctions;
    fetchedPages = page;

    if (payload.lots.length === 0) break;

    for (const lot of payload.lots) {
      const decision = filterBradescoListLot(lot);
      if (decision.keep) lots.push(lot);
      else if (decision.reason) bumpSkip(skipped, decision.reason);
    }

    if (page >= payload.totalPages) break;
  }

  return {
    lots,
    meta: { pages: totalPages, total: totalAuctions, fetchedPages },
    skipped,
  };
}

function parseArgs(argv: string[]): { out: string; maxPages?: number } {
  let out = "/tmp/bradesco-harvest/list.json";
  let maxPages: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out" && argv[i + 1]) out = argv[++i]!;
    else if (arg === "--max-pages" && argv[i + 1]) maxPages = Number(argv[++i]);
  }

  return { out, maxPages };
}

async function main() {
  const { out, maxPages } = parseArgs(process.argv.slice(2));
  const result = await listBradescoVehicles({ maxPages });
  const payload = {
    total: result.lots.length,
    meta: result.meta,
    skipped: result.skipped,
    lots: result.lots,
  };

  const safeOut = assertSafeOutPath(out);
  mkdirSync(dirname(safeOut), { recursive: true });
  writeFileSync(safeOut, JSON.stringify(payload, null, 2), "utf8");

  console.error(
    JSON.stringify({
      out: safeOut,
      kept: result.lots.length,
      skipped: result.skipped,
      meta: result.meta,
    }),
  );
  console.log(JSON.stringify({ out: safeOut, kept: result.lots.length, meta: result.meta }));
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
