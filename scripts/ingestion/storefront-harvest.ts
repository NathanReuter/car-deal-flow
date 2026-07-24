/**
 * Config-driven storefront harvester.
 *
 * Loops STOREFRONT_SITES from storefront-sites.ts.
 *   mode "html" → plain-fetch each paginated listing page, parse cards with
 *                  parseClubeRepasseCards, spawn write-lead per card.
 *   mode "json" → plain-fetch the single REST endpoint, parse with
 *                  parseCompracertaItems, spawn write-lead per item.
 *
 * Per-site try/catch: one failing site never aborts the whole run.
 * Fail-closed: cards/items missing brand/model/year/price are skipped by
 *              the parser before this file ever sees them.
 * Auto-runs apply-goal-filter at the end (unless --no-goal-filter).
 *
 *   ./node_modules/.bin/tsx scripts/ingestion/storefront-harvest.ts
 *     [--dry-run] [--limit-pages <n>] [--site <id>] [--no-goal-filter]
 *     [--summary-out <file>]
 */

import { spawnSync } from "node:child_process";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { detectDamageSignals } from "../../src/lib/filters/damageSignals";
import { assertAllowedUrl, isCliEntry } from "./fetch-guards";
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
import { guessBodyTypeByModel } from "./lib/parse-common";
import {
  parseClubeRepasseCards,
  parseCompracertaItems,
} from "./storefront-parse";
import { STOREFRONT_SITES, type StorefrontSite } from "./storefront-sites";
import type { WriteLeadInput } from "./write-lead";

// ---------------------------------------------------------------------------
// Allowed fetch hosts (security guard)
// ---------------------------------------------------------------------------

const ALLOWED_HOSTS = new Set([
  "cluberepasse.com.br",
  "www.cluberepasse.com.br",
  "compracertarepasse.com.br",
  "www.compracertarepasse.com.br",
]);

async function fetchText(url: string): Promise<string> {
  assertAllowedUrl(url, ALLOWED_HOSTS, "storefront");
  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; car-deal-flow-bot/1.0; +https://github.com/NathanReuter/car-deal-flow)",
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.text();
}

// ---------------------------------------------------------------------------
// Per-site harvest helpers
// ---------------------------------------------------------------------------

async function harvestHtmlSite(
  site: StorefrontSite,
  opts: HarvestOpts,
  summary: HarvestSummary,
): Promise<void> {
  const ceiling = opts.ceiling ?? DEFAULT_CEILING;
  const maxPages = opts.limitPages ?? site.totalPages;

  for (let page = 1; page <= maxPages; page++) {
    if (hasReachedCeiling(summary, ceiling)) {
      bumpSkip(summary, "ceiling");
      break;
    }

    const url = site.listUrl(page);
    let html: string;
    try {
      html = await fetchText(url);
      await throttleFetch();
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push({ url, error: msg });
      bumpSkip(summary, "fetch_error");
      // Non-fatal for the page; continue to next page
      continue;
    }

    const cards = parseClubeRepasseCards(html);
    // If page 1 returns 0 cards the site is down or has no inventory — stop
    // immediately rather than crawling all 183+ pages in vain.
    if (cards.length === 0 && page === 1) {
      console.warn(`[storefront] ${site.id}: page 1 returned 0 cards — site may be down; aborting.`);
      break;
    }
    // Past page 1: 0 cards means we've passed the last real page.
    if (cards.length === 0 && page > 1) {
      break;
    }

    for (const card of cards) {
      summary.scanned++;

      // Damage gate — skip sinistro/batido/salvage cars at harvest time,
      // consistent with napista-parse.ts:81 and webmotors-parse.ts:185.
      const damageBlob = [card.brand, card.model, card.description].filter(Boolean).join(" ");
      if (detectDamageSignals(damageBlob).blocked) {
        bumpSkip(summary, "damaged");
        continue;
      }

      if (hasReachedCeiling(summary, ceiling)) {
        bumpSkip(summary, "ceiling");
        break;
      }

      const bodyType = guessBodyTypeByModel(card.model);
      if (!bodyType) {
        bumpSkip(summary, "no_body_type");
        continue;
      }
      const input: WriteLeadInput = {
        brand: card.brand,
        model: card.model,
        year: card.year,
        askingPriceBRL: card.askingPriceBRL,
        dealPhase: "market",
        sellerType: "repasse",
        sourceChannel: "storefront",
        confidence: "medium",
        bodyType,
        sourceUrl: `${site.baseUrl}${card.detailPath}`,
        sourcePlatform: site.sourcePlatform,
        city: site.city,
        state: site.state,
      };

      if (opts.dryRun) {
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
  }
}

async function harvestJsonSite(
  site: StorefrontSite,
  opts: HarvestOpts,
  summary: HarvestSummary,
): Promise<void> {
  const ceiling = opts.ceiling ?? DEFAULT_CEILING;
  const url = site.listUrl(1);

  let raw: string;
  try {
    raw = await fetchText(url);
    await throttleFetch();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    summary.errors.push({ url, error: msg });
    bumpSkip(summary, "fetch_error");
    return;
  }

  const items = parseCompracertaItems(raw);

  for (const item of items) {
    summary.scanned++;

    // Damage gate — skip sinistro/batido/salvage cars at harvest time,
    // consistent with napista-parse.ts:81 and webmotors-parse.ts:185.
    // Gate on descricao + versao + modelo (all available text fields).
    const damageBlob = [item.descricao, item.versao, item.model].filter(Boolean).join(" ");
    if (detectDamageSignals(damageBlob).blocked) {
      bumpSkip(summary, "damaged");
      continue;
    }

    if (hasReachedCeiling(summary, ceiling)) {
      bumpSkip(summary, "ceiling");
      break;
    }

    const bodyType = guessBodyTypeByModel(item.model);
    if (!bodyType) {
      bumpSkip(summary, "no_body_type");
      continue;
    }
    const input: WriteLeadInput = {
      brand: item.brand,
      model: item.model,
      year: item.year,
      askingPriceBRL: item.askingPriceBRL,
      dealPhase: "market",
      sellerType: "repasse",
      sourceChannel: "storefront",
      confidence: "medium",
      bodyType,
      mileageKm: item.mileageKm,
      fipeValueBRL: item.fipeBRL,
      // Dedupe key: id-only path. The brand/model/year slug was previously
      // included but drifts if the site renames fields → re-inserts existing
      // cars. safeId is already sanitized in parseCompracertaItems (S3 guard).
      sourceUrl: `${site.baseUrl}/veiculo/${item.id}`,
      sourcePlatform: site.sourcePlatform,
      city: site.city,
      state: site.state,
    };

    if (opts.dryRun) {
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
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface HarvestOpts {
  dryRun?: boolean;
  limitPages?: number;
  ceiling?: number;
  siteFilter?: string;
  summaryOut?: string;
  applyGoalFilter?: boolean;
}

export async function harvestStorefronts(opts: HarvestOpts = {}): Promise<HarvestSummary[]> {
  const sites = opts.siteFilter
    ? STOREFRONT_SITES.filter((s) => s.id === opts.siteFilter)
    : STOREFRONT_SITES;

  const summaries: HarvestSummary[] = [];

  for (const site of sites) {
    const summary = createHarvestSummary(site.name);
    const started = Date.now();

    try {
      if (site.mode === "html") {
        await harvestHtmlSite(site, opts, summary);
      } else {
        await harvestJsonSite(site, opts, summary);
      }
    } catch (err) {
      // Per-site isolation: catch any uncaught error and log it, continue
      const msg = err instanceof Error ? err.message : String(err);
      summary.errors.push({ url: site.baseUrl, error: `site-level: ${msg}` });
    }

    summary.durationMs = Date.now() - started;
    summaries.push(summary);

    if (opts.summaryOut) {
      const outPath = opts.summaryOut.replace(/\.json$/, `-${site.id}.json`);
      try {
        mkdirSync(resolve(outPath, ".."), { recursive: true });
        writeSummary(outPath, summary);
      } catch {
        // Non-fatal
      }
    }
  }

  // Auto-run apply-goal-filter (unless dry-run or explicitly disabled)
  if (opts.applyGoalFilter !== false && !opts.dryRun) {
    spawnSync(
      "./node_modules/.bin/tsx",
      ["scripts/ingestion/apply-goal-filter.ts", "--min-goal-fit", "50"],
      { encoding: "utf8", cwd: process.cwd(), stdio: "inherit" },
    );
  }

  return summaries;
}

// ---------------------------------------------------------------------------
// CLI entry point
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): HarvestOpts & { summaryOut?: string } {
  const opts: HarvestOpts & { summaryOut?: string } = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--dry-run") opts.dryRun = true;
    else if (arg === "--limit-pages" && argv[i + 1]) opts.limitPages = Number(argv[++i]);
    else if (arg === "--site" && argv[i + 1]) opts.siteFilter = argv[++i];
    else if (arg === "--no-goal-filter") opts.applyGoalFilter = false;
    else if (arg === "--summary-out" && argv[i + 1]) opts.summaryOut = argv[++i];
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const summaries = await harvestStorefronts(opts);
  console.log(JSON.stringify(summaries, null, 2));
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  });
}
