import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { assertSafeOutPath, isCliEntry } from "./fetch-guards";
import { fetchSantanderHtml } from "./santander-fetch";
import type { SantanderListResult } from "./santander-list";
import { parseSantanderLot, santanderToWriteLead } from "./santander-parse";
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

export async function harvestSantanderLots(options: {
  lotsPath: string;
  fetchDir?: string;
  dryRun?: boolean;
  limit?: number;
  ceiling?: number;
  skipExisting?: boolean;
  summaryOut?: string;
  applyGoalFilter?: boolean;
}): Promise<HarvestSummary> {
  const summary = createHarvestSummary("Santander Retomados");
  const payload = JSON.parse(readFileSync(options.lotsPath, "utf8")) as SantanderListResult;
  const lots = options.limit ? payload.lots.slice(0, options.limit) : payload.lots;
  const fetchDir = options.fetchDir ?? "/tmp/santander-harvest/lots";
  const ceiling = options.ceiling ?? DEFAULT_CEILING;

  if (options.fetchDir) mkdirSync(fetchDir, { recursive: true });

  for (const lot of lots) {
    summary.scanned++;
    const htmlPath = join(fetchDir, `${lot.id}.html`);
    let html: string;

    if (options.skipExisting !== false && existsSync(htmlPath)) {
      html = readFileSync(htmlPath, "utf8");
    } else {
      try {
        html = await fetchSantanderHtml(lot.url);
        if (options.fetchDir) writeFileSync(htmlPath, html, "utf8");
      } catch (error) {
        bumpSkip(summary, "fetch_error");
        summary.errors.push({
          url: lot.url,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }
    }

    const parsed = parseSantanderLot(lot.id, lot.url, html);
    const input = santanderToWriteLead(parsed);
    if (!input) {
      bumpSkip(summary, parsed.skipReason ?? "skipped");
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

    const writeResult = spawnWriteLead(input);
    if (!writeResult.ok) {
      bumpSkip(summary, "write_error");
      summary.errors.push({ url: input.sourceUrl, error: writeResult.error ?? "" });
      continue;
    }
    recordWriteResult(summary, writeResult.result ?? { created: true });
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
  let lotsPath = "/tmp/santander-lots.json";
  let fetchDir = "/tmp/santander-harvest/lots";
  let dryRun = false;
  let limit: number | undefined;
  let skipExisting = true;
  let summaryOut = "/tmp/santander-harvest/write-summary.json";
  let noGoalFilter = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--lots" && argv[i + 1]) lotsPath = argv[++i]!;
    else if (arg === "--fetch-dir" && argv[i + 1]) fetchDir = argv[++i]!;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--limit" && argv[i + 1]) limit = Number(argv[++i]);
    else if (arg === "--skip-existing") skipExisting = true;
    else if (arg === "--no-skip-existing") skipExisting = false;
    else if (arg === "--summary-out" && argv[i + 1]) summaryOut = argv[++i]!;
    else if (arg === "--no-goal-filter") noGoalFilter = true;
  }

  return { lotsPath, fetchDir, dryRun, limit, skipExisting, summaryOut, noGoalFilter };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = await harvestSantanderLots({
    lotsPath: assertSafeOutPath(args.lotsPath),
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
