import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client";
import { requireDatabaseUrl } from "../lib/database-url";

/** HTTP statuses trusted as "the listing is genuinely gone." Everything else
 * (403 from Cloudflare, timeouts, redirects to a generic homepage, etc.) is
 * inconclusive and must never expire a car — see design decision in
 * docs/superpowers/specs/2026-07-15-auction-expiry-design.md. */
const BROKEN_STATUS_CODES = new Set([404, 410]);

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_DELAY_MS = 300;

export interface LinkCheckResult {
  ok: boolean;
  status?: number;
  error?: string;
}

export type UrlChecker = (url: string) => Promise<LinkCheckResult>;

export async function defaultCheckUrl(url: string): Promise<LinkCheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
  try {
    const res = await fetch(url, { method: "GET", redirect: "follow", signal: controller.signal });
    res.body?.cancel().catch(() => {});
    return { ok: true, status: res.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timeout);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface CheckBrokenLinksOptions {
  checkUrl?: UrlChecker;
  delayMs?: number;
}

export interface CheckBrokenLinksSummary {
  evaluated: number;
  checked: number;
  expired: number;
  inconclusive: number;
}

export async function checkBrokenLinks(
  prisma: PrismaClient,
  options: CheckBrokenLinksOptions = {},
): Promise<CheckBrokenLinksSummary> {
  const checkUrl = options.checkUrl ?? defaultCheckUrl;
  const delayMs = options.delayMs ?? DEFAULT_DELAY_MS;

  const cars = await prisma.car.findMany({
    where: { pipelineStage: { in: ["new_lead", "parked"] } },
    select: { id: true, sourceUrl: true, sourcePlatform: true },
  });

  const summary: CheckBrokenLinksSummary = {
    evaluated: cars.length,
    checked: 0,
    expired: 0,
    inconclusive: 0,
  };

  for (const car of cars) {
    const result = await checkUrl(car.sourceUrl);
    summary.checked += 1;

    if (result.ok && result.status !== undefined && BROKEN_STATUS_CODES.has(result.status)) {
      await prisma.car.update({
        where: { id: car.id },
        data: {
          pipelineStage: "expired",
          stageReason: `Source link broken (HTTP ${result.status}): ${car.sourcePlatform}.`,
        },
      });
      summary.expired += 1;
    } else {
      summary.inconclusive += 1;
    }

    if (delayMs > 0) await sleep(delayMs);
  }

  return summary;
}

function parseArgs(argv: string[]): CheckBrokenLinksOptions {
  const i = argv.indexOf("--delay-ms");
  if (i === -1) return {};
  const n = Number(argv[i + 1]);
  return Number.isFinite(n) ? { delayMs: n } : {};
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const adapter = new PrismaBetterSqlite3({ url: requireDatabaseUrl() });
  const prisma = new PrismaClient({ adapter });
  try {
    const summary = await checkBrokenLinks(prisma, options);
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
