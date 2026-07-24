import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client";
import { requireDatabaseUrl } from "../lib/database-url";
import {
  buildTopPicksReport,
  goalFromRow,
  type TopPicksCar,
} from "./lib/top-picks";

function parseLimit(argv: string[]): number {
  const i = argv.indexOf("--limit");
  if (i === -1) return 10;
  const n = Number(argv[i + 1]);
  if (!Number.isFinite(n) || n < 1) throw new Error(`Invalid --limit: ${argv[i + 1]}`);
  return Math.floor(n);
}

async function main() {
  const limit = parseLimit(process.argv.slice(2));
  const adapter = new PrismaBetterSqlite3({ url: requireDatabaseUrl() });
  const prisma = new PrismaClient({ adapter });
  try {
    const goalRow = await prisma.buyingGoal.findFirst({ where: { active: true } });
    if (!goalRow) throw new Error("No active BuyingGoal");

    const goal = goalFromRow(goalRow);
    const cars = (await prisma.car.findMany({
      where: { pipelineStage: "new_lead" },
    })) as TopPicksCar[];

    const report = buildTopPicksReport(cars, goal, limit);
    console.log(
      JSON.stringify(
        {
          goalName: goalRow.name,
          goal: {
            budgetMinBRL: goal.budgetMinBRL,
            budgetMaxBRL: goal.budgetMaxBRL,
            minYear: goal.minYear,
            maxMileageKm: goal.maxMileageKm,
            preferredBodyTypes: goal.preferredBodyTypes,
            preferredBrands: goal.preferredBrands,
          },
          ...report,
        },
        null,
        2,
      ),
    );
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
