import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import type { BradescoDetail } from "./bradesco-fetch";
import { loadBradescoListFile } from "./bradesco-fetch";
import { parseBradescoLead } from "./bradesco-parse";
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

export async function harvestBradescoLots(options: {
  listPath: string;
  detailsDir: string;
  dryRun?: boolean;
  limit?: number;
  ceiling?: number;
  summaryOut?: string;
  applyGoalFilter?: boolean;
}): Promise<HarvestSummary> {
  const summary = createHarvestSummary("Bradesco Vitrine");
  const ceiling = options.ceiling ?? DEFAULT_CEILING;
  const list = loadBradescoListFile(readFileSync(options.listPath, "utf8"));
  const lots = options.limit ? list.slice(0, options.limit) : list;

  for (const lot of lots) {
    summary.scanned++;
    const detailPath = join(options.detailsDir, `${lot.guid}.json`);
    if (!existsSync(detailPath)) {
      bumpSkip(summary, "missing_detail");
      continue;
    }

    const detail = JSON.parse(readFileSync(detailPath, "utf8")) as BradescoDetail;
    const parsed = parseBradescoLead(lot, detail);
    if (!parsed.input) {
      bumpSkip(summary, parsed.skip ?? "skipped");
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

    const writeResult = spawnWriteLead(parsed.input);
    if (!writeResult.ok) {
      const err = writeResult.error ?? "write-lead failed";
      if (/damage|sinistro|monta|sucata|batido|sinistrado/i.test(err)) {
        bumpSkip(summary, "damage_write_lead");
      } else {
        bumpSkip(summary, "write_error");
        summary.errors.push({ url: parsed.input.sourceUrl, error: err });
      }
      continue;
    }

    recordWriteResult(summary, writeResult.result ?? { created: true });
  }

  if (options.summaryOut) {
    writeSummary(options.summaryOut, summary);
  }

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
  listPath: string;
  detailsDir: string;
  dryRun: boolean;
  limit?: number;
  summaryOut?: string;
  noGoalFilter: boolean;
} {
  let listPath = "/tmp/bradesco-harvest/list.json";
  let detailsDir = "/tmp/bradesco-harvest/details";
  let dryRun = false;
  let limit: number | undefined;
  let summaryOut = "/tmp/bradesco-harvest/write-summary.json";
  let noGoalFilter = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--list" && argv[i + 1]) listPath = argv[++i]!;
    else if (arg === "--details-dir" && argv[i + 1]) detailsDir = argv[++i]!;
    else if (arg === "--dry-run") dryRun = true;
    else if (arg === "--limit" && argv[i + 1]) limit = Number(argv[++i]);
    else if (arg === "--summary-out" && argv[i + 1]) summaryOut = argv[++i]!;
    else if (arg === "--no-goal-filter") noGoalFilter = true;
  }

  return { listPath, detailsDir, dryRun, limit, summaryOut, noGoalFilter };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = await harvestBradescoLots({
    listPath: assertSafeOutPath(args.listPath),
    detailsDir: assertSafeOutPath(args.detailsDir),
    dryRun: args.dryRun,
    limit: args.limit,
    summaryOut: args.summaryOut ? assertSafeOutPath(args.summaryOut) : undefined,
    applyGoalFilter: !args.noGoalFilter,
  });

  console.log(
    JSON.stringify(
      {
        ...summary,
        detailFiles: existsSync(args.detailsDir)
          ? readdirSync(args.detailsDir).length
          : 0,
      },
      null,
      2,
    ),
  );
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
