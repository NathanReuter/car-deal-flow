import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { assertSafeOutPath, isCliEntry } from "./fetch-guards";
import { BRADESCO_API_BASE, type BradescoListLot } from "./bradesco-list";

export type BradescoDetail = BradescoListLot & {
  url?: string | null;
  address?: string | null;
  auction_location?: string | null;
  images?: string[];
  auctioneer?: {
    name?: string;
    website?: string;
  };
};

export function loadBradescoListFile(raw: string): BradescoListLot[] {
  const payload = JSON.parse(raw) as { lots?: BradescoListLot[] };
  return payload.lots ?? [];
}

export async function fetchBradescoDetail(guid: string): Promise<BradescoDetail> {
  const url = `${BRADESCO_API_BASE}/auctions/${guid}`;
  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Bradesco detail HTTP ${response.status} for ${guid}`);
  }
  return (await response.json()) as BradescoDetail;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function writeBradescoDetails(options: {
  lots: Array<{ guid: string }>;
  outDir: string;
  skipExisting?: boolean;
  fetchDetail?: (guid: string) => Promise<BradescoDetail>;
  delayMs?: number;
  limit?: number;
}): Promise<{
  written: number;
  skippedExisting: number;
  errors: Array<{ guid: string; error: string }>;
}> {
  const outDir = assertSafeOutPath(options.outDir);
  mkdirSync(outDir, { recursive: true });

  const fetchDetail = options.fetchDetail ?? fetchBradescoDetail;
  const delayMs = options.delayMs ?? 200;
  let written = 0;
  let skippedExisting = 0;
  const errors: Array<{ guid: string; error: string }> = [];

  const lots = options.limit ? options.lots.slice(0, options.limit) : options.lots;

  for (const lot of lots) {
    const path = join(outDir, `${lot.guid}.json`);
    if (options.skipExisting && existsSync(path)) {
      skippedExisting++;
      continue;
    }

    try {
      const detail = await fetchDetail(lot.guid);
      writeFileSync(path, JSON.stringify(detail, null, 2), "utf8");
      written++;
    } catch (error) {
      errors.push({
        guid: lot.guid,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  return { written, skippedExisting, errors };
}

function parseArgs(argv: string[]): {
  listPath: string;
  outDir: string;
  skipExisting: boolean;
  limit?: number;
} {
  let listPath = "/tmp/bradesco-harvest/list.json";
  let outDir = "/tmp/bradesco-harvest/details";
  let skipExisting = false;
  let limit: number | undefined;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--list" && argv[i + 1]) listPath = argv[++i]!;
    else if (arg === "--out-dir" && argv[i + 1]) outDir = argv[++i]!;
    else if (arg === "--skip-existing") skipExisting = true;
    else if (arg === "--limit" && argv[i + 1]) limit = Number(argv[++i]);
  }

  return { listPath, outDir, skipExisting, limit };
}

async function main() {
  const { listPath, outDir, skipExisting, limit } = parseArgs(process.argv.slice(2));
  const safeList = assertSafeOutPath(listPath);
  const lots = loadBradescoListFile(readFileSync(safeList, "utf8"));
  const result = await writeBradescoDetails({
    lots,
    outDir,
    skipExisting,
    limit,
  });

  console.log(JSON.stringify({ ...result, totalLots: lots.length, outDir }, null, 2));
  if (result.errors.length > 0) process.exitCode = 1;
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
