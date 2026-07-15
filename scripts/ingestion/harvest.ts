import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { assertSafeOutPath, isCliEntry } from "./fetch-guards";
import type { HarvestSummary } from "./lib/harvest-runner";
import { harvestBradescoLots } from "./bradesco-harvest";
import { harvestVipLots } from "./vip-harvest";
import { harvestBidchainLots } from "./bidchain-harvest";
import { harvestMglLots } from "./mgl-harvest";
import { harvestSantanderLots } from "./santander-harvest";

export type HarvestSource = "bradesco" | "vip" | "bidchain" | "mgl" | "santander";

export type CombinedHarvestSummary = {
  sources: Record<string, HarvestSummary>;
  totalWritten: number;
  totalErrors: number;
  durationMs: number;
  startedAt: string;
};

const ALL_SOURCES: HarvestSource[] = ["bradesco", "vip", "bidchain", "mgl", "santander"];

function parseArgs(argv: string[]): {
  source?: HarvestSource;
  all: boolean;
  dryRun: boolean;
  limit?: number;
  excludeInsurer: boolean;
  noGoalFilter: boolean;
  summaryOut: string;
} {
  let source: HarvestSource | undefined;
  let all = false;
  let dryRun = false;
  let limit: number | undefined;
  let excludeInsurer = false;
  let noGoalFilter = false;
  let summaryOut = "/tmp/harvest-summary.json";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--source" && argv[i + 1]) source = argv[++i] as HarvestSource;
    else if (arg === "--all") all = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--limit" && argv[i + 1]) limit = Number(argv[++i]);
    else if (arg === "--exclude-insurer") excludeInsurer = true;
    else if (arg === "--no-goal-filter") noGoalFilter = true;
    else if (arg === "--summary-out" && argv[i + 1]) summaryOut = argv[++i]!;
  }

  return { source, all, dryRun, limit, excludeInsurer, noGoalFilter, summaryOut };
}

function runStep(label: string, args: string[]): void {
  const result = spawnSync("./node_modules/.bin/tsx", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: "inherit",
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed with exit ${result.status}`);
  }
}

export async function runHarvestSource(
  source: HarvestSource,
  options: {
    dryRun?: boolean;
    limit?: number;
    excludeInsurer?: boolean;
    applyGoalFilter?: boolean;
  },
): Promise<HarvestSummary> {
  const common = {
    dryRun: options.dryRun,
    limit: options.limit,
    applyGoalFilter: options.applyGoalFilter,
  };

  switch (source) {
    case "bradesco": {
      runStep("bradesco-list", [
        "scripts/ingestion/bradesco-list.ts",
        "--out",
        "/tmp/bradesco-harvest/list.json",
      ]);
      runStep("bradesco-fetch", [
        "scripts/ingestion/bradesco-fetch.ts",
        "--list",
        "/tmp/bradesco-harvest/list.json",
        "--out-dir",
        "/tmp/bradesco-harvest/details",
        "--skip-existing",
        ...(options.limit ? ["--limit", String(options.limit)] : []),
      ]);
      return harvestBradescoLots({
        listPath: "/tmp/bradesco-harvest/list.json",
        detailsDir: "/tmp/bradesco-harvest/details",
        summaryOut: "/tmp/bradesco-harvest/write-summary.json",
        ...common,
      });
    }
    case "vip": {
      runStep("vip-list", [
        "scripts/ingestion/vip-list-financeiras.ts",
        "--out",
        "/tmp/vip-financeiras-lots.json",
      ]);
      runStep("vip-fetch", [
        "scripts/ingestion/vip-fetch-batch.ts",
        "--lots",
        "/tmp/vip-financeiras-lots.json",
        "--out",
        "/tmp/vip-financeiras-details.json",
        "--skip-existing",
        ...(options.limit ? ["--limit", String(options.limit)] : []),
      ]);
      return harvestVipLots({
        detailsPath: "/tmp/vip-financeiras-details.json",
        excludeInsurer: options.excludeInsurer,
        summaryOut: "/tmp/vip-financeiras-write-summary.json",
        ...common,
      });
    }
    case "bidchain": {
      runStep("bidchain-list", [
        "scripts/ingestion/bidchain-list.ts",
        "--out",
        "/tmp/bidchain-lots.json",
      ]);
      return harvestBidchainLots({
        lotsPath: "/tmp/bidchain-lots.json",
        fetchDir: "/tmp/bid-harvest/lots",
        summaryOut: "/tmp/bid-harvest/write-summary.json",
        skipExisting: true,
        ...common,
      });
    }
    case "mgl": {
      runStep("mgl-list-auctions", [
        "scripts/ingestion/mgl-list-auctions.ts",
        "--out",
        "/tmp/mgl-auctions.json",
      ]);
      return harvestMglLots({
        auctionsPath: "/tmp/mgl-auctions.json",
        fetchDir: "/tmp/mgl-harvest/lots",
        summaryOut: "/tmp/mgl-harvest/write-summary.json",
        skipExisting: true,
        ...common,
      });
    }
    case "santander": {
      return harvestSantanderLots({
        lotsPath: "/tmp/santander-lots.json",
        fetchDir: "/tmp/santander-harvest/lots",
        summaryOut: "/tmp/santander-harvest/write-summary.json",
        skipExisting: true,
        ...common,
      });
    }
    default:
      throw new Error(`Unknown source: ${source satisfies never}`);
  }
}

export async function runHarvest(options: {
  sources: HarvestSource[];
  dryRun?: boolean;
  limit?: number;
  excludeInsurer?: boolean;
  applyGoalFilter?: boolean;
  summaryOut?: string;
}): Promise<CombinedHarvestSummary> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const sources: Record<string, HarvestSummary> = {};
  let totalWritten = 0;
  let totalErrors = 0;

  for (const source of options.sources) {
    const summary = await runHarvestSource(source, options);
    sources[source] = summary;
    totalWritten +=
      summary.written.created + summary.written.updated + summary.written.merged;
    totalErrors += summary.errors.length;
  }

  const combined: CombinedHarvestSummary = {
    sources,
    totalWritten,
    totalErrors,
    durationMs: Date.now() - start,
    startedAt,
  };

  if (options.summaryOut) {
    writeFileSync(assertSafeOutPath(options.summaryOut), JSON.stringify(combined, null, 2), "utf8");
  }

  return combined;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sources = args.all ? ALL_SOURCES : args.source ? [args.source] : [];
  if (sources.length === 0) {
    throw new Error("Specify --source <name> or --all");
  }

  const combined = await runHarvest({
    sources,
    dryRun: args.dryRun,
    limit: args.limit,
    excludeInsurer: args.excludeInsurer,
    applyGoalFilter: !args.noGoalFilter,
    summaryOut: args.summaryOut,
  });

  console.log(JSON.stringify(combined, null, 2));
  if (combined.totalErrors > 0 && !args.dryRun) process.exit(1);
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
