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
import {
  buildApiUrl,
  fetchApiPage,
  warmWebmotorsContext,
  WebmotorsBlockError,
  WM_API_BASE,
  WM_PACING,
  wmLaunchOptions,
  WM_QUERIES,
  WM_ROTATE_EVERY_PAGES,
} from "./webmotors-list";
import type { BrowserContext, Page } from "playwright";
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

/** Record an anti-bot block in the summary and persist it before aborting, so
 * a failed run is still inspectable. */
function recordBlock(
  summary: HarvestSummary,
  url: string,
  reason: string,
  summaryOut?: string,
): void {
  bumpSkip(summary, "blocked");
  summary.errors.push({ url, error: reason });
  if (summaryOut) writeSummary(summaryOut, summary);
}

export async function harvestWebmotors(options: {
  queries?: string[];
  maxPagesPerQuery?: number;
  dryRun?: boolean;
  limit?: number;
  ceiling?: number;
  summaryOut?: string;
  applyGoalFilter?: boolean;
  /** Reuse an already-warmed page instead of launching a browser (tests). */
  page?: Page;
  /** Jitter window for inter-request pacing (opt-in; default fixed delay). */
  pacing?: { minMs: number; maxMs: number };
  /** Rotate the context + re-warm every N fetches (real runs only). */
  rotateEveryPages?: number;
}): Promise<HarvestSummary> {
  const summary = createHarvestSummary("Webmotors");
  const queries = options.queries ?? WM_QUERIES;
  const maxPages = options.maxPagesPerQuery ?? 10;
  const ceiling = options.ceiling ?? DEFAULT_CEILING;
  const usingDefaultQueries =
    queries.length === WM_QUERIES.length && queries.every((q, i) => q === WM_QUERIES[i]);

  // Plausibility signals for the guard below. A completed run that saw nothing
  // is almost always a silent anti-bot block, not a genuinely empty market; a
  // run where only some default queries came back empty smells like a partial
  // block. All three default queries (repasse / assumo financiamento /
  // financiado) reliably return listings on a healthy session.
  let rawResultsTotal = 0;
  let queriesAttempted = 0;
  let queriesWithResults = 0;
  let stoppedEarly = false; // limit/ceiling reached — plausibility not meaningful

  const ownBrowser = !options.page;
  const browser = ownBrowser ? await chromium.launch(wmLaunchOptions()) : null;
  const rotateEvery = options.rotateEveryPages ?? WM_ROTATE_EVERY_PAGES;
  let context: BrowserContext | null = null;
  let pagesSinceWarm = 0;
  try {
    // Warm up homepage so PerimeterX/Cloudflare issue a valid session cookie.
    let page: Page;
    if (ownBrowser) {
      const warm = await warmWebmotorsContext(browser!);
      context = warm.context;
      page = warm.page;
    } else {
      page = options.page!;
    }

    // Track seen IDs to skip duplicates across keyword passes (and rotations).
    const seen = new Set<string>();

    outer: for (const keyword of queries) {
      queriesAttempted++;
      let rawThisKeyword = 0;
      for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
        // Rotate to a fresh session before crossing the ~6-page block ceiling.
        if (ownBrowser && pagesSinceWarm >= rotateEvery) {
          if (context) await context.close();
          const warm = await warmWebmotorsContext(browser!);
          context = warm.context;
          page = warm.page;
          pagesSinceWarm = 0;
        }

        const pageUrl = buildApiUrl(keyword, pageNo);
        let results: WebmotorsSearchResult[];
        try {
          results = await fetchApiPage(page, keyword, pageNo);
          pagesSinceWarm++;
        } catch (err) {
          // Anti-bot block ⇒ fail closed: record it and abort the whole run so
          // the orchestrator marks the source failed instead of silently
          // truncating (issue #8).
          if (err instanceof WebmotorsBlockError) {
            recordBlock(summary, pageUrl, err.message, options.summaryOut);
            throw err;
          }
          bumpSkip(summary, "fetch_error");
          summary.errors.push({
            url: pageUrl,
            error: err instanceof Error ? err.message : String(err),
          });
          break;
        }

        rawResultsTotal += results.length;
        rawThisKeyword += results.length;
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
            stoppedEarly = true;
            break outer;
          }

          if (hasReachedCeiling(summary, ceiling)) {
            bumpSkip(summary, "ceiling");
            stoppedEarly = true;
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

        await throttleFetch(options.pacing);
      }
      if (rawThisKeyword > 0) queriesWithResults++;
    }
  } finally {
    if (browser) await browser.close();
  }

  // Plausibility guard (issue #8): the mid-run block above catches a session
  // that degrades partway through with a hard block signal. These heuristics
  // catch the softer cases, and only for the default query set (custom queries
  // may legitimately return little or nothing). Skipped when we stopped early
  // on limit/ceiling, since a truncated run tells us nothing about yield.
  if (usingDefaultQueries && !stoppedEarly) {
    if (rawResultsTotal === 0) {
      // Nothing at all came back — almost certainly a block at warm-up.
      const reason = `no results across ${queriesAttempted} default queries — probable silent block`;
      recordBlock(summary, WM_API_BASE, reason, options.summaryOut);
      throw new WebmotorsBlockError(reason);
    }
    if (queriesWithResults < queriesAttempted) {
      // Some default queries returned listings and others returned none — a
      // healthy session returns results for all three, so this smells like a
      // partial block. Non-fatal: flag for review rather than abort.
      bumpSkip(summary, "low_yield");
      console.error(
        `[webmotors] low yield: only ${queriesWithResults}/${queriesAttempted} default queries returned results — possible partial block`,
      );
    }
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
    pacing: WM_PACING,
    rotateEveryPages: WM_ROTATE_EVERY_PAGES,
  });
  console.log(JSON.stringify(summary, null, 2));
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
