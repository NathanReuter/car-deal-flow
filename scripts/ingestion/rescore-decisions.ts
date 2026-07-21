import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client";
import {
  buildBundle,
  CAR_INCLUDE,
  toBuyingGoal,
} from "../../src/lib/aggregate";

export class RescoreDecisionsError extends Error {}

export interface RescoreDecisionsSummary {
  scored: number;
}

export async function rescoreDecisions(
  prisma: PrismaClient,
): Promise<RescoreDecisionsSummary> {
  const goalRow = await prisma.buyingGoal.findFirst({ where: { active: true } });
  if (!goalRow) throw new RescoreDecisionsError("No active buying goal configured.");
  const goal = toBuyingGoal(goalRow);

  const cars = await prisma.car.findMany({ include: CAR_INCLUDE });

  // Group car IDs by their computed (finalScore, verdict) pair so we can issue
  // one updateMany per distinct pair instead of one update per car.
  // This removes the N sequential write-locks on SQLite.
  const groups = new Map<string, { finalScore: number; verdict: string; ids: string[] }>();
  for (const row of cars) {
    const { decision } = buildBundle(row, goal);
    const key = `${decision.finalScore}|${decision.verdict}`;
    const existing = groups.get(key);
    if (existing) {
      existing.ids.push(row.id);
    } else {
      groups.set(key, { finalScore: decision.finalScore, verdict: decision.verdict, ids: [row.id] });
    }
  }

  // Execute all updateMany calls inside a single transaction (one fsync).
  if (groups.size > 0) {
    await prisma.$transaction(
      [...groups.values()].map(({ finalScore, verdict, ids }) =>
        prisma.car.updateMany({
          where: { id: { in: ids } },
          data: { finalScore, verdict },
        }),
      ),
    );
  }

  console.log(`Scored ${cars.length} cars.`);
  return { scored: cars.length };
}

async function main() {
  const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" });
  const prisma = new PrismaClient({ adapter });
  try {
    const summary = await rescoreDecisions(prisma);
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
