// End-to-end Webmotors repasse harvest. Uses Playwright+stealth to warm up the
// homepage (PerimeterX bypass), then calls the internal JSON API for each
// keyword pass. For each result, runs webmotors-parse (fail-closed repasse gate)
// and writes pre_repossession leads through write-lead. Mirrors olx-harvest.ts.
//
// REPASSE-ONLY: plain sales, dealer stock, and paid-off cars are all skipped.
//
//   ./node_modules/.bin/tsx scripts/ingestion/webmotors-harvest.ts
//     [--list /tmp/webmotors-harvest/list.json]
//     [--dry-run] [--limit <n>] [--no-goal-filter] [--summary-out <file>]

import { spawnSync } from "node:child_process";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import {
  assertSafeOutPath,
  isCliEntry,
} from "./fetch-guards";
import { webmotorsToWriteLead, type WebmotorsSearchResult } from "./webmotors-parse";
import { fetchApiPage, WM_HOMEPAGE, WM_QUERIES, WM_API_BASE } from "./webmotors-list";
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

chromium.use(stealth());

// ─── Core harvest function ───────────────────────────────────────────────────

export async function harvestWebmotors(options: {
  queries?: string[];
  maxPagesPerQuery?: number;
  dryRun?: boolean;
  limit?: number;
  ceiling?: number;
  summaryOut?: string;
  applyGoalFilter?: boolean;
}): Promise<HarvestSummary> {
  const summary = createHarvestSummary("Webmotors");
  const queries = options.queries ?? WM_QUERIES;
  const maxPages = options.maxPagesPerQuery ?? 10;
  const ceiling = options.ceiling ?? DEFAULT_CEILING;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();

    // Warm up homepage so PerimeterX issues a valid session cookie.
    await page.goto(WM_HOMEPAGE, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(3000);

    // Track seen IDs to skip duplicates across keyword passes.
    const seen = new Set<string>();

    outer: for (const keyword of queries) {
      for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
        let results: WebmotorsSearchResult[];
        try {
          results = await fetchApiPage(page, keyword, pageNo);
        } catch (err) {
          bumpSkip(summary, "fetch_error");
          summary.errors.push({
            url: `${WM_API_BASE}?q=${keyword}&pagina=${pageNo}`,
            error: err instanceof Error ? err.message : String(err),
          });
          break;
        }

        if (results.length === 0) break;

        for (const r of results) {
          const id = String(r.UniqueId);
          if (seen.has(id)) continue;
          seen.add(id);
          summary.scanned++;

          const { input, skipReason } = webmotorsToWriteLead(r);
          if (!input) {
            bumpSkip(summary, skipReason ?? "skipped");
            continue;
          }

          if (options.limit !== undefined && summary.scanned > options.limit) {
            bumpSkip(summary, "limit");
            break outer;
          }

          if (hasReachedCeiling(summary, ceiling)) {
            bumpSkip(summary, "ceiling");
            break outer;
          }

          if (options.dryRun) {
            recordWriteResult(summary, { created: true });
            if (summary.sampleUrls.length < 10) summary.sampleUrls.push(input.sourceUrl);
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
        }

        await throttleFetch();
      }
    }
  } finally {
    await browser.close();
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

// ─── CLI entry ────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  let dryRun = false;
  let limit: number | undefined;
  let maxPages = 10;
  let summaryOut = "/tmp/webmotors-harvest/write-summary.json";
  let noGoalFilter = false;
  const extraQueries: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--dry-run") dryRun = true;
    else if (arg === "--limit" && argv[i + 1]) limit = Number(argv[++i]);
    else if (arg === "--max-pages" && argv[i + 1]) maxPages = Number(argv[++i]);
    else if (arg === "--summary-out" && argv[i + 1]) summaryOut = argv[++i]!;
    else if (arg === "--no-goal-filter") noGoalFilter = true;
    else if (arg === "--query" && argv[i + 1]) extraQueries.push(argv[++i]!);
  }
  return { dryRun, limit, maxPages, summaryOut, noGoalFilter, extraQueries };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const summary = await harvestWebmotors({
    queries: [...WM_QUERIES, ...args.extraQueries],
    maxPagesPerQuery: args.maxPages,
    dryRun: args.dryRun,
    limit: args.limit,
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
