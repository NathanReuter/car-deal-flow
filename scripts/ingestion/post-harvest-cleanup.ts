import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client";
import { requireDatabaseUrl } from "../lib/database-url";
import { isFullyExpired } from "../../src/lib/auction";
import { expireStaleLeads, type ExpireStaleLeadsSummary } from "./expire-stale-leads";
import {
  checkBrokenLinks,
  type CheckBrokenLinksSummary,
  type UrlChecker,
} from "./check-broken-links";

/**
 * Post-harvest cleanup: the single entrypoint that soft-expires dead inventory
 * after a harvest or a goal change. Order matters — cheap, offline date-based
 * expiry runs first so the network-bound broken-link sweep has fewer cars left
 * to fetch. Both steps only touch `new_lead`/`parked` cars and only ever set
 * `pipelineStage: "expired"`; nothing is hard-deleted. See
 * docs/superpowers/specs/2026-07-15-auction-expiry-design.md.
 */

export interface PostHarvestCleanupOptions {
  skipStaleDates?: boolean;
  skipBrokenLinks?: boolean;
  delayMs?: number;
  /** Injectable URL checker for the broken-link sweep (defaults to a live fetch). */
  checkUrl?: UrlChecker;
  /** Report what would be expired without writing anything. */
  dryRun?: boolean;
}

export interface PostHarvestCleanupSummary {
  expireStale: ExpireStaleLeadsSummary | null;
  brokenLinks: CheckBrokenLinksSummary | null;
  totalExpired: number;
  dryRun?: boolean;
}

/** Read-only count of cars every one of whose sources has a past auction date. */
async function countStaleCandidates(prisma: PrismaClient, now: Date): Promise<ExpireStaleLeadsSummary> {
  const cars = await prisma.car.findMany({
    where: { pipelineStage: { in: ["new_lead", "parked"] } },
    include: { sources: true },
  });
  const expired = cars.filter((c) => isFullyExpired(c.sources, now)).length;
  return { evaluated: cars.length, expired };
}

export async function runPostHarvestCleanup(
  prisma: PrismaClient,
  options: PostHarvestCleanupOptions = {},
): Promise<PostHarvestCleanupSummary> {
  const summary: PostHarvestCleanupSummary = {
    expireStale: null,
    brokenLinks: null,
    totalExpired: 0,
  };

  if (options.dryRun) {
    summary.dryRun = true;
    // Dry run stays offline: report stale-date candidates from the DB and skip
    // the network-bound broken-link sweep entirely.
    if (!options.skipStaleDates) {
      summary.expireStale = await countStaleCandidates(prisma, new Date());
    }
    return summary;
  }

  if (!options.skipStaleDates) {
    summary.expireStale = await expireStaleLeads(prisma);
    summary.totalExpired += summary.expireStale.expired;
  }

  if (!options.skipBrokenLinks) {
    summary.brokenLinks = await checkBrokenLinks(prisma, {
      delayMs: options.delayMs,
      checkUrl: options.checkUrl,
    });
    summary.totalExpired += summary.brokenLinks.expired;
  }

  return summary;
}

function parseArgs(argv: string[]): PostHarvestCleanupOptions {
  const options: PostHarvestCleanupOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--skip-broken-links") options.skipBrokenLinks = true;
    else if (arg === "--skip-stale-dates") options.skipStaleDates = true;
    else if (arg === "--dry-run") options.dryRun = true;
    else if (arg === "--delay-ms" && argv[i + 1]) {
      const n = Number(argv[++i]);
      if (Number.isFinite(n)) options.delayMs = n;
    }
  }
  return options;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const adapter = new PrismaBetterSqlite3({ url: requireDatabaseUrl() });
  const prisma = new PrismaClient({ adapter });
  try {
    const summary = await runPostHarvestCleanup(prisma, options);
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
