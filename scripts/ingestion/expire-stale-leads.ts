import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client";
import { isFullyExpired } from "../../src/lib/auction";

export interface ExpireStaleLeadsSummary {
  evaluated: number;
  expired: number;
}

function buildStageReason(sources: { sourcePlatform: string; auctionDate: Date | null }[]): string {
  const dates = sources
    .filter((s): s is { sourcePlatform: string; auctionDate: Date } => s.auctionDate !== null)
    .map((s) => `${s.sourcePlatform} ${s.auctionDate.toISOString().slice(0, 10)}`);
  return `Auction date(s) passed: ${dates.join(", ")}.`;
}

export async function expireStaleLeads(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<ExpireStaleLeadsSummary> {
  const cars = await prisma.car.findMany({
    where: { pipelineStage: { in: ["new_lead", "parked"] } },
    include: { sources: true },
  });

  const summary: ExpireStaleLeadsSummary = { evaluated: cars.length, expired: 0 };

  for (const car of cars) {
    if (!isFullyExpired(car.sources, now)) continue;

    await prisma.car.update({
      where: { id: car.id },
      data: {
        pipelineStage: "expired",
        stageReason: buildStageReason(car.sources),
      },
    });
    summary.expired += 1;
  }

  return summary;
}

async function main() {
  const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
  const prisma = new PrismaClient({ adapter });
  try {
    const summary = await expireStaleLeads(prisma);
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
