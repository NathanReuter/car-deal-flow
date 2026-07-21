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

  for (const row of cars) {
    const { decision } = buildBundle(row, goal);
    await prisma.car.update({
      where: { id: row.id },
      data: { finalScore: decision.finalScore, verdict: decision.verdict },
    });
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
