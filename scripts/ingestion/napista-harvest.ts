// End-to-end NaPista harvest: list below-FIPE dealer cards per city+year,
// parse each card, write leads through write-lead.ts. Mirrors olx-harvest.ts.
// Dealer below-FIPE stock → dealPhase "market", sellerType "dealer",
// sourceChannel "aggregator", confidence "high".
//
//   ./node_modules/.bin/tsx scripts/ingestion/napista-harvest.ts
//     [--out /tmp/napista-harvest/list.json]
//     [--max-pages <n>] [--dry-run] [--limit <n>] [--no-goal-filter]
//     [--summary-out /tmp/napista-harvest/write-summary.json]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { spawnSync } from "node:child_process";
import { assertSafeOutPath, isCliEntry } from "./fetch-guards";
import { listNapistaAds, DEFAULT_MAX_PAGES } from "./napista-list";
import { parseNapistaCard, napistaToWriteLead } from "./napista-parse";
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

export async function harvestNapista(options: {
  maxPagesPerTarget?: number;
  dryRun?: boolean;
  limit?: number;
  ceiling?: number;
  summaryOut?: string;
  applyGoalFilter?: boolean;
}): Promise<HarvestSummary> {
  const summary = createHarvestSummary("NaPista");
  const ceiling = options.ceiling ?? DEFAULT_CEILING;

  const listResult = await listNapistaAds({
    maxPagesPerTarget: options.maxPagesPerTarget ?? DEFAULT_MAX_PAGES,
    dryRun: options.dryRun,
  });

  const entries = options.limit
    ? listResult.entries.slice(0, options.limit)
    : listResult.entries;

  for (const entry of entries) {
    summary.scanned++;

    const parsed = parseNapistaCard(entry.card);
    if (!parsed) {
      bumpSkip(summary, "parse_failed");
      continue;
    }

    const { input, skipReason } = napistaToWriteLead(parsed, entry.id);
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
      await throttleFetch();
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

    await throttleFetch();
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
  let maxPages = DEFAULT_MAX_PAGES;
  let dryRun = false;
  let limit: number | undefined;
  let summaryOut = "/tmp/napista-harvest/write-summary.json";
  let noGoalFilter = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--max-pages" && argv[i + 1]) maxPages = Number(argv[++i]);
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--limit" && argv[i + 1]) limit = Number(argv[++i]);
    else if (arg === "--summary-out" && argv[i + 1]) summaryOut = argv[++i]!;
    else if (arg === "--no-goal-filter") noGoalFilter = true;
  }
  return { maxPages, dryRun, limit, summaryOut, noGoalFilter };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  mkdirSync(dirname(assertSafeOutPath(args.summaryOut)), { recursive: true });
  const summary = await harvestNapista({
    maxPagesPerTarget: args.maxPages,
    dryRun: args.dryRun,
    limit: args.limit,
    summaryOut: assertSafeOutPath(args.summaryOut),
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
