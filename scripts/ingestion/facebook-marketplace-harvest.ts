// Facebook Marketplace validation harvest via RapidAPI (PullAPI).
// Intent-first queries × south cities; fail-closed parse; pre_repossession leads.
//
//   ./node_modules/.bin/tsx scripts/ingestion/facebook-marketplace-harvest.ts
//     [--dry-run] [--limit 30] [--no-goal-filter]
//     [--summary-out /tmp/facebook-marketplace-harvest/write-summary.json]

import { spawnSync } from "node:child_process";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client";
import { assertSafeOutPath, isCliEntry } from "./fetch-guards";
import { loadScriptEnv, requireDatabaseUrl } from "../lib/database-url";
import {
  facebookToWriteLead,
  type FacebookApiListing,
} from "./facebook-marketplace-parse";
import { loadGoalHint } from "./goal-hint";
import type { WriteLeadInput } from "./write-lead";
import {
  bumpSkip,
  createHarvestSummary,
  hasReachedCeiling,
  recordWriteResult,
  spawnWriteLead,
  writeSummary,
  type HarvestSummary,
} from "./lib/harvest-runner";

const HOST = "facebook-scraper-api9.p.rapidapi.com";
const BASE = `https://${HOST}/facebook/marketplace`;

/** Spike-proven allowlist — ASCII city names only. */
export const FB_LOCATIONS = ["Florianopolis", "Curitiba", "Joinville"] as const;

/** Default write ceiling when --limit is omitted (40 was too small for goal runs). */
export const DEFAULT_FACEBOOK_WRITE_LIMIT = 200;

/** Intent-first default; override with --query for model-targeted runs. */
export const FB_QUERIES = [
  "financiado",
  "financiamento",
  "assumo financiamento",
  "passo financiamento",
  "repasse",
  "Veiculos",
] as const;

/** Compact SUV / EV focus set for sample runs. */
export const FB_TARGET_QUERIES = [
  "BYD Song",
  "Song Plus",
  "BYD",
  "T-Cross",
  "TCross",
  "HR-V",
  "HRV",
  "Creta",
  "Nivus",
  "Pulse",
  "Fastback",
  "Kicks",
  "Tracker",
  "T-Cross financiamento",
  "HRV financiamento",
  "BYD financiamento",
  "Song repasse",
] as const;

/** Preferred brand → goal-biased SUV/crossover search terms (ASCII).
 * Ordered with budget-plausible models first (goal ~60–100k). */
const GOAL_SUV_BY_BRAND: Record<string, string[]> = {
  toyota: ["Corolla Cross", "Toyota"],
  honda: ["HR-V", "HRV", "Honda HRV"],
  volkswagen: ["T-Cross", "TCross", "Nivus", "Taos"],
  hyundai: ["Creta", "Hyundai Creta"],
  chevrolet: ["Tracker", "Chevrolet Tracker"],
  byd: ["BYD Song", "Song Plus", "BYD Yuan"],
};

export type GoalPrefer = {
  budgetBRL: { min: number; max: number };
  minYear: number;
  maxMileageKm: number;
  preferredBrands: string[];
  preferredBodyTypes: string[];
  excludedBrandsModels: string[];
};

export function buildQueriesFromGoal(prefer: GoalPrefer): string[] {
  const queries: string[] = [];
  const seen = new Set<string>();
  const add = (q: string) => {
    const key = q.trim();
    if (!key || seen.has(key.toLowerCase())) return;
    seen.add(key.toLowerCase());
    queries.push(key);
  };

  // Round 1: model-only (highest recall for market stock in budget band)
  for (const brand of prefer.preferredBrands) {
    const key = brand.trim().toLowerCase();
    for (const m of GOAL_SUV_BY_BRAND[key] ?? [brand]) add(m);
  }
  // Round 2: financing variants (pre_repossession)
  for (const brand of prefer.preferredBrands) {
    const key = brand.trim().toLowerCase();
    for (const m of GOAL_SUV_BY_BRAND[key] ?? [brand]) {
      add(`${m} financiamento`);
      add(`${m} repasse`);
    }
  }
  add("SUV financiamento");
  return queries;
}

/** Soft pre-write gate aligned with computeGoalFit hard/soft rules (fail-closed skip). */
export function goalSkipReason(input: WriteLeadInput, prefer: GoalPrefer): string | null {
  const brand = input.brand.trim().toLowerCase();
  const model = input.model.trim().toLowerCase();
  const identity = `${brand} ${model}`;

  for (const excl of prefer.excludedBrandsModels) {
    const e = excl.trim().toLowerCase();
    if (e && identity.includes(e)) return "goal_excluded";
  }

  if (prefer.preferredBodyTypes.length > 0) {
    const bodies = new Set(prefer.preferredBodyTypes.map((b) => b.toLowerCase()));
    if (!bodies.has(input.bodyType.toLowerCase())) return "goal_body_mismatch";
  }

  if (prefer.preferredBrands.length > 0) {
    const brands = prefer.preferredBrands.map((b) => b.toLowerCase());
    if (!brands.some((b) => brand === b || brand.includes(b) || b.includes(brand))) {
      return "goal_brand_mismatch";
    }
  }

  if (input.year < prefer.minYear) return "goal_year_low";

  const price =
    input.dealPhase === "pre_repossession"
      ? (input.entryAskBRL ?? null)
      : (input.askingPriceBRL ?? null);
  if (price != null) {
    const maxSoft = prefer.budgetBRL.max * 1.05;
    const minSoft = prefer.budgetBRL.min * 0.9;
    if (price > maxSoft) return "goal_over_budget";
    if (price < minSoft) return "goal_under_budget";
  }

  if (
    input.mileageKm != null &&
    Number.isFinite(input.mileageKm) &&
    input.mileageKm > prefer.maxMileageKm
  ) {
    return "goal_mileage_high";
  }

  return null;
}

type ApiResponse = {
  success?: boolean;
  data?: { listings?: FacebookApiListing[] };
  message?: string;
  error?: string;
};

async function fetchMarketplacePage(
  query: string,
  location: string,
  limit: number,
  apiKey: string,
): Promise<FacebookApiListing[]> {
  const params = new URLSearchParams({
    query,
    location,
    country: "br",
    limit: String(Math.min(50, Math.max(1, limit))),
  });
  const res = await fetch(`${BASE}?${params}`, {
    headers: {
      "x-rapidapi-host": HOST,
      "x-rapidapi-key": apiKey,
    },
  });
  const body = (await res.json()) as ApiResponse;
  if (!res.ok) {
    throw new Error(`RapidAPI HTTP ${res.status}: ${body.message ?? body.error ?? res.statusText}`);
  }
  if (!body.success) {
    throw new Error(`RapidAPI unsuccessful: ${body.message ?? body.error ?? "unknown"}`);
  }
  return body.data?.listings ?? [];
}

export async function harvestFacebookMarketplace(options: {
  dryRun?: boolean;
  limit?: number;
  ceiling?: number;
  summaryOut?: string;
  applyGoalFilter?: boolean;
  pageSize?: number;
  queries?: string[];
  locations?: string[];
  allowMarketFallback?: boolean;
  goalPrefer?: GoalPrefer | null;
  /** Load active BuyingGoal and bias queries + pre-write gate. */
  fromGoal?: boolean;
}): Promise<HarvestSummary> {
  loadScriptEnv();
  const apiKey = process.env.RAPIDAPI_KEY?.trim();
  if (!apiKey) {
    throw new Error("RAPIDAPI_KEY is not set in .env");
  }

  let goalPrefer = options.goalPrefer ?? null;
  let queries = options.queries;

  if (options.fromGoal && !goalPrefer) {
    const adapter = new PrismaBetterSqlite3({ url: requireDatabaseUrl() });
    const prisma = new PrismaClient({ adapter });
    try {
      const hint = await loadGoalHint(prisma);
      if (!hint.ok) {
        throw new Error(hint.message);
      }
      goalPrefer = hint.prefer;
      if (!queries?.length) queries = buildQueriesFromGoal(hint.prefer);
      console.error(
        `[facebook] active goal "${hint.goalName}" → ${queries.length} queries; ` +
          `budget ${hint.prefer.budgetBRL.min}-${hint.prefer.budgetBRL.max}; minYear ${hint.prefer.minYear}`,
      );
    } finally {
      await prisma.$disconnect();
    }
  }

  const summary = createHarvestSummary("Facebook Marketplace");
  const writeTarget = options.limit ?? DEFAULT_FACEBOOK_WRITE_LIMIT;
  const ceiling = Math.min(options.ceiling ?? writeTarget, writeTarget);
  const pageSize = options.pageSize ?? 20;
  const resolvedQueries = queries?.length ? queries : [...FB_QUERIES];
  const locations = options.locations?.length ? options.locations : [...FB_LOCATIONS];
  const allowMarketFallback =
    options.allowMarketFallback ?? Boolean(options.fromGoal || goalPrefer);
  const seen = new Set<string>();

  console.error(
    `[facebook] queries=${resolvedQueries.length} locations=${locations.join(",")} ` +
      `goal=${goalPrefer ? "on" : "off"} marketFallback=${allowMarketFallback} ceiling=${ceiling}`,
  );

  outer: for (const query of resolvedQueries) {
    for (const location of locations) {
      if (hasReachedCeiling(summary, ceiling)) break outer;

      let listings: FacebookApiListing[];
      try {
        console.error(`[facebook] fetch "${query}" @ ${location}`);
        listings = await fetchMarketplacePage(query, location, pageSize, apiKey);
      } catch (error) {
        summary.errors.push({
          url: `${query}@${location}`,
          error: error instanceof Error ? error.message : String(error),
        });
        continue;
      }

      for (const raw of listings) {
        if (hasReachedCeiling(summary, ceiling)) break outer;
        summary.scanned++;

        const { input, skipReason } = facebookToWriteLead(raw, { allowMarketFallback });
        if (!input) {
          bumpSkip(summary, skipReason ?? "skipped");
          continue;
        }

        if (goalPrefer) {
          const gSkip = goalSkipReason(input, goalPrefer);
          if (gSkip) {
            bumpSkip(summary, gSkip);
            continue;
          }
        }

        const dedupeKey = input.sourceUrl;
        if (seen.has(dedupeKey)) {
          bumpSkip(summary, "duplicate_url");
          continue;
        }
        seen.add(dedupeKey);

        if (options.dryRun) {
          recordWriteResult(summary, { created: true });
          if (summary.sampleUrls.length < 10) summary.sampleUrls.push(input.sourceUrl);
          continue;
        }

        const writeResult = spawnWriteLead(input);
        if (!writeResult.ok) {
          bumpSkip(summary, "write_error");
          summary.errors.push({
            url: input.sourceUrl,
            error: writeResult.error ?? "write-lead failed",
          });
          continue;
        }
        recordWriteResult(summary, writeResult.result ?? { created: true });
        if (summary.sampleUrls.length < 10) summary.sampleUrls.push(input.sourceUrl);
      }

      await new Promise((r) => setTimeout(r, 1200));
    }
  }

  if (options.summaryOut) {
    writeSummary(options.summaryOut, summary);
  }

  if (options.applyGoalFilter !== false && !options.dryRun) {
    const filter = spawnSync(
      "./node_modules/.bin/tsx",
      ["scripts/ingestion/apply-goal-filter.ts"],
      { encoding: "utf8", cwd: process.cwd() },
    );
    if (filter.status !== 0) {
      summary.errors.push({
        url: "apply-goal-filter",
        error: (filter.stderr || filter.stdout || "goal filter failed").trim().slice(0, 400),
      });
    }
  }

  return summary;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };
  const getAll = (flag: string): string[] => {
    const out: string[] = [];
    for (let i = 0; i < argv.length; i++) {
      if (argv[i] === flag && argv[i + 1]) out.push(argv[++i]!);
    }
    return out;
  };

  const dryRun = argv.includes("--dry-run");
  const fromGoal = argv.includes("--from-goal");
  const limitRaw = get("--limit");
  const limit = limitRaw !== undefined ? Number(limitRaw) : DEFAULT_FACEBOOK_WRITE_LIMIT;
  const summaryOut =
    get("--summary-out") ?? "/tmp/facebook-marketplace-harvest/write-summary.json";
  assertSafeOutPath(summaryOut);

  let queries: string[] | undefined;
  const queryArgs = getAll("--query");
  const useTargets = argv.includes("--targets");

  if (queryArgs.length) {
    queries = queryArgs;
  } else if (useTargets) {
    queries = [...FB_TARGET_QUERIES];
  }

  const summary = await harvestFacebookMarketplace({
    dryRun,
    limit: Number.isFinite(limit) ? limit : DEFAULT_FACEBOOK_WRITE_LIMIT,
    summaryOut,
    applyGoalFilter: !argv.includes("--no-goal-filter"),
    queries,
    fromGoal: fromGoal || (!queryArgs.length && !useTargets),
    allowMarketFallback:
      argv.includes("--allow-market") || useTargets || fromGoal || (!queryArgs.length && !useTargets),
  });

  console.log(JSON.stringify(summary, null, 2));
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
