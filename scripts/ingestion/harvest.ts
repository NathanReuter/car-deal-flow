import { writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { assertSafeOutPath, isCliEntry } from "./fetch-guards";
import {
  createHarvestSummary,
  type HarvestSummary,
} from "./lib/harvest-runner";
import { harvestBradescoLots } from "./bradesco-harvest";
import { harvestVipLots } from "./vip-harvest";
import { harvestBidchainLots } from "./bidchain-harvest";
import { harvestMglLots } from "./mgl-harvest";
import { harvestSantanderLots } from "./santander-harvest";
import { harvestOlxAds } from "./olx-harvest";

export type HarvestSource = "bradesco" | "vip" | "bidchain" | "mgl" | "santander" | "olx";

export type HarvestPhase = "pre" | "auction" | "market" | "all";

/** Sources by deal phase; "olx" harvests pre-repossession repasse ads. */
export const PHASE_SOURCES: Record<Exclude<HarvestPhase, "all">, HarvestSource[]> = {
  auction: ["bradesco", "vip", "bidchain", "mgl", "santander"],
  pre: ["olx"],
  market: [],
};

export function sourcesForPhase(phase: HarvestPhase): HarvestSource[] {
  if (phase === "all") return [...PHASE_SOURCES.auction, ...PHASE_SOURCES.pre, ...PHASE_SOURCES.market];
  return [...PHASE_SOURCES[phase]];
}

export type CombinedHarvestSummary = {
  sources: Record<string, HarvestSummary | FailedHarvestSummary>;
  totalWritten: number;
  totalErrors: number;
  durationMs: number;
  startedAt: string;
};

export type FailedHarvestSummary = HarvestSummary & {
  failed: true;
  failureReason: string;
};

const ALL_SOURCES: HarvestSource[] = sourcesForPhase("all");
const VALID_SOURCES = new Set<string>(ALL_SOURCES);

export const SANTANDER_LOTS_PATH = "/tmp/santander-lots.json";
export const SANTANDER_HTML_CAPTURE = "/tmp/santander-retomados.html";

export function parseHarvestSource(raw: string): HarvestSource {
  if (!VALID_SOURCES.has(raw)) {
    throw new Error(`Invalid --source "${raw}". Use one of: ${ALL_SOURCES.join(", ")}`);
  }
  return raw as HarvestSource;
}

export function parseHarvestPhase(raw: string): HarvestPhase {
  if (raw !== "pre" && raw !== "auction" && raw !== "market" && raw !== "all") {
    throw new Error(`Invalid --phase "${raw}". Use one of: pre, auction, market, all`);
  }
  return raw;
}

function parseArgs(argv: string[]): {
  source?: HarvestSource;
  phase?: HarvestPhase;
  all: boolean;
  dryRun: boolean;
  limit?: number;
  excludeInsurer: boolean;
  noGoalFilter: boolean;
  noCleanup: boolean;
  skipLinkCheck: boolean;
  summaryOut: string;
} {
  let source: HarvestSource | undefined;
  let phase: HarvestPhase | undefined;
  let all = false;
  let dryRun = false;
  let limit: number | undefined;
  let excludeInsurer = false;
  let noGoalFilter = false;
  let noCleanup = false;
  let skipLinkCheck = false;
  let summaryOut = "/tmp/harvest-summary.json";

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--source" && argv[i + 1]) source = parseHarvestSource(argv[++i]!);
    else if (arg === "--phase" && argv[i + 1]) phase = parseHarvestPhase(argv[++i]!);
    else if (arg === "--all") all = true;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--limit" && argv[i + 1]) limit = Number(argv[++i]);
    else if (arg === "--exclude-insurer") excludeInsurer = true;
    else if (arg === "--no-goal-filter") noGoalFilter = true;
    else if (arg === "--no-cleanup") noCleanup = true;
    else if (arg === "--skip-link-check") skipLinkCheck = true;
    else if (arg === "--summary-out" && argv[i + 1]) summaryOut = argv[++i]!;
  }

  return { source, phase, all, dryRun, limit, excludeInsurer, noGoalFilter, noCleanup, skipLinkCheck, summaryOut };
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

function runGoalFilter(): void {
  spawnSync(
    "./node_modules/.bin/tsx",
    ["scripts/ingestion/apply-goal-filter.ts", "--min-goal-fit", "50"],
    { encoding: "utf8", cwd: process.cwd(), stdio: "inherit" },
  );
}

/** Soft-expire dead inventory (auction dates passed, then broken source links).
 * Runs once at the end of a harvest, after goal triage. Independent of goal
 * fit, so it runs even when --no-goal-filter is set. The broken-link sweep
 * fetches every new_lead/parked lot's URL sequentially, so --skip-link-check
 * lets a fast/incremental harvest skip it; it stays on by default because
 * null-date sources (BIDchain/MGL/Santander) rely on it as their only cleanup. */
function runCleanup(includeBrokenLinks: boolean): void {
  const args = ["scripts/ingestion/post-harvest-cleanup.ts"];
  if (!includeBrokenLinks) args.push("--skip-broken-links");
  spawnSync("./node_modules/.bin/tsx", args, {
    encoding: "utf8",
    cwd: process.cwd(),
    stdio: "inherit",
  });
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
      runStep("santander-list", [
        "scripts/ingestion/santander-list.ts",
        "--out",
        SANTANDER_LOTS_PATH,
      ]);
      return harvestSantanderLots({
        lotsPath: SANTANDER_LOTS_PATH,
        fetchDir: "/tmp/santander-harvest/lots",
        summaryOut: "/tmp/santander-harvest/write-summary.json",
        skipExisting: true,
        ...common,
      });
    }
    case "olx": {
      runStep("olx-list", [
        "scripts/ingestion/olx-list.ts",
        "--out",
        "/tmp/olx-harvest/list.json",
      ]);
      return harvestOlxAds({
        listPath: "/tmp/olx-harvest/list.json",
        fetchDir: "/tmp/olx-harvest/details",
        summaryOut: "/tmp/olx-harvest/write-summary.json",
        skipExisting: true,
        ...common,
      });
    }
    default:
      throw new Error(`Unknown source: ${source satisfies never}`);
  }
}

function failedSummary(source: HarvestSource, reason: string): FailedHarvestSummary {
  return {
    ...createHarvestSummary(source),
    failed: true,
    failureReason: reason,
    errors: [{ url: source, error: reason }],
  };
}

export async function runHarvest(options: {
  sources: HarvestSource[];
  dryRun?: boolean;
  limit?: number;
  excludeInsurer?: boolean;
  applyGoalFilter?: boolean;
  cleanup?: boolean;
  checkBrokenLinks?: boolean;
  summaryOut?: string;
}): Promise<CombinedHarvestSummary> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const sources: Record<string, HarvestSummary | FailedHarvestSummary> = {};
  let totalWritten = 0;
  let totalErrors = 0;
  const deferGoalFilter = options.sources.length > 1;
  const perSourceGoalFilter =
    deferGoalFilter ? false : options.applyGoalFilter !== false;

  for (const source of options.sources) {
    try {
      const summary = await runHarvestSource(source, {
        dryRun: options.dryRun,
        limit: options.limit,
        excludeInsurer: options.excludeInsurer,
        applyGoalFilter: perSourceGoalFilter,
      });
      sources[source] = summary;
      totalWritten +=
        summary.written.created + summary.written.updated + summary.written.merged;
      totalErrors += summary.errors.length;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      const summary = failedSummary(source, reason);
      sources[source] = summary;
      totalErrors += 1;
    }
  }

  if (deferGoalFilter && options.applyGoalFilter !== false && !options.dryRun) {
    runGoalFilter();
  }

  // Cleanup runs once after all sources + goal triage. It never writes on a
  // dry run and is independent of goal fit, so --no-goal-filter still cleans up.
  if (options.cleanup !== false && !options.dryRun) {
    runCleanup(options.checkBrokenLinks !== false);
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
  const sources = args.all
    ? ALL_SOURCES
    : args.phase
      ? sourcesForPhase(args.phase)
      : args.source
        ? [args.source]
        : [];
  if (sources.length === 0) {
    throw new Error("Specify --source <name>, --phase <pre|auction|all>, or --all");
  }

  const combined = await runHarvest({
    sources,
    dryRun: args.dryRun,
    limit: args.limit,
    excludeInsurer: args.excludeInsurer,
    applyGoalFilter: !args.noGoalFilter,
    cleanup: !args.noCleanup,
    checkBrokenLinks: !args.skipLinkCheck,
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
