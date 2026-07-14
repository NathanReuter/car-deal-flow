/**
 * Print a harvest filter hint from the active BuyingGoal.
 * Does not skip lots — operators/agents still decide; never invent fields.
 *
 *   ./node_modules/.bin/tsx scripts/ingestion/goal-hint.ts
 */
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client";

function parseJsonArray(raw: string): string[] {
  try {
    const v = JSON.parse(raw) as unknown;
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export async function loadGoalHint(prisma: PrismaClient) {
  const goal = await prisma.buyingGoal.findFirst({ where: { active: true } });
  if (!goal) {
    return {
      ok: false as const,
      message: "No active BuyingGoal — harvest without goal prefilter; still fail-closed on fields.",
    };
  }
  return {
    ok: true as const,
    goalName: goal.name,
    prefer: {
      budgetBRL: { min: goal.budgetMinBRL, max: goal.budgetMaxBRL },
      minYear: goal.minYear,
      maxMileageKm: goal.maxMileageKm,
      preferredBrands: parseJsonArray(goal.preferredBrands),
      preferredBodyTypes: parseJsonArray(goal.preferredBodyTypes),
      excludedBrandsModels: parseJsonArray(goal.excludedBrandsModels),
    },
    guidance: [
      "When listing year/price/brand clearly miss this goal, skip the write and log why (goal-aware).",
      "Never invent brand/model/year/price/bodyType to force a fit.",
      "Safety ceiling: 1000 writes per source per run.",
      "After the run: apply-goal-filter.ts --min-goal-fit 50",
    ],
  };
}

async function main() {
  const adapter = new PrismaBetterSqlite3({
    url: process.env.DATABASE_URL ?? "file:./dev.db",
  });
  const prisma = new PrismaClient({ adapter });
  try {
    const hint = await loadGoalHint(prisma);
    console.log(JSON.stringify(hint, null, 2));
  } finally {
    await prisma.$disconnect();
  }
}

const isMain =
  process.argv[1]?.includes("goal-hint") ||
  process.argv[1]?.endsWith("goal-hint.ts");

if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
