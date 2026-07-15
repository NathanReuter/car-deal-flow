import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { assertSafeOutPath, isCliEntry } from "./fetch-guards";
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
import { parseVipLead, type VipDetail } from "./vip-parse";
import type { VipDetailsFile } from "./vip-fetch-batch";

export async function harvestVipLots(options: {
  detailsPath: string;
  dryRun?: boolean;
  limit?: number;
  excludeInsurer?: boolean;
  ceiling?: number;
  summaryOut?: string;
  applyGoalFilter?: boolean;
}): Promise<HarvestSummary> {
  const summary = createHarvestSummary("VIP Leilões");
  const payload = JSON.parse(readFileSync(options.detailsPath, "utf8")) as VipDetailsFile;
  const details = options.limit ? payload.details.slice(0, options.limit) : payload.details;

  for (const err of payload.errors ?? []) {
    summary.errors.push({ url: err.url, error: err.error });
  }

  for (const detail of details) {
    summary.scanned++;
    const parsed = parseVipLead(detail, { excludeInsurer: options.excludeInsurer });
    if (!parsed.input) {
      bumpSkip(summary, parsed.skip ?? "skipped");
      continue;
    }

    if (hasReachedCeiling(summary, options.ceiling ?? DEFAULT_CEILING)) {
      bumpSkip(summary, "ceiling");
      continue;
    }

    if (options.dryRun) {
      recordWriteResult(summary, { created: true });
      continue;
    }

    const writeResult = spawnWriteLead(parsed.input);
    if (!writeResult.ok) {
      bumpSkip(summary, /damage|sinistro|monta|sucata|batido/i.test(writeResult.error ?? "")
        ? "damage_write_lead"
        : "write_error");
      if (!/damage|sinistro|monta|sucata|batido/i.test(writeResult.error ?? "")) {
        summary.errors.push({ url: parsed.input.sourceUrl, error: writeResult.error ?? "" });
      }
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

function parseArgs(argv: string[]): {
  detailsPath: string;
  dryRun: boolean;
  limit?: number;
  excludeInsurer: boolean;
  summaryOut?: string;
  noGoalFilter: boolean;
} {
  let detailsPath = "/tmp/vip-financeiras-details.json";
  let dryRun = false;
  let limit: number | undefined;
  let excludeInsurer = false;
  let summaryOut = "/tmp/vip-financeiras-write-summary.json";
  let noGoalFilter = false;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--details" && argv[i + 1]) detailsPath = argv[++i]!;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--limit" && argv[i + 1]) limit = Number(argv[++i]);
    else if (arg === "--exclude-insurer") excludeInsurer = true;
    else if (arg === "--summary-out" && argv[i + 1]) summaryOut = argv[++i]!;
    else if (arg === "--no-goal-filter") noGoalFilter = true;
  }
  return { detailsPath, dryRun, limit, excludeInsurer, summaryOut, noGoalFilter };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = await harvestVipLots({
    detailsPath: assertSafeOutPath(args.detailsPath),
    dryRun: args.dryRun,
    limit: args.limit,
    excludeInsurer: args.excludeInsurer,
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
