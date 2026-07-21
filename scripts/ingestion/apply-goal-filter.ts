import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient, Prisma } from "../../src/generated/prisma/client";
import {
  toBuyingGoal,
  buildBundle,
  CAR_INCLUDE,
} from "../../src/lib/aggregate";

export class ApplyGoalFilterError extends Error {}

export interface ApplyGoalFilterOptions {
  minGoalFit?: number;
}

export interface ApplyGoalFilterSummary {
  evaluated: number;
  keptNewLead: number;
  parked: number;
  rejected: number;
}

export async function applyGoalFilter(
  prisma: PrismaClient,
  options: ApplyGoalFilterOptions = {},
): Promise<ApplyGoalFilterSummary> {
  const minGoalFit = options.minGoalFit ?? 50;

  const goalRow = await prisma.buyingGoal.findFirst({ where: { active: true } });
  if (!goalRow) {
    throw new ApplyGoalFilterError("No active buying goal configured.");
  }
  const goal = toBuyingGoal(goalRow);

  const cars = await prisma.car.findMany({
    where: { pipelineStage: { in: ["new_lead", "parked"] } },
    include: CAR_INCLUDE,
  });

  const summary: ApplyGoalFilterSummary = {
    evaluated: cars.length,
    keptNewLead: 0,
    parked: 0,
    rejected: 0,
  };

  // Build each per-car update upfront, accumulate counts, then run all inside
  // a single transaction so SQLite only fsyncs once.
  const updates: Prisma.PrismaPromise<unknown>[] = [];

  for (const row of cars) {
    const bundle = buildBundle(row, goal);
    const { goalMatch, decision } = bundle;

    if (goalMatch.score === 0) {
      updates.push(
        prisma.car.update({
          where: { id: row.id },
          data: {
            pipelineStage: "rejected",
            stageReason: goalMatch.failedCriteria.join("; ") || goalMatch.explanation,
            finalScore: decision.finalScore,
            verdict: decision.verdict,
          },
        }),
      );
      summary.rejected += 1;
      continue;
    }

    if (goalMatch.score < minGoalFit) {
      updates.push(
        prisma.car.update({
          where: { id: row.id },
          data: {
            pipelineStage: "parked",
            stageReason: goalMatch.failedCriteria.join("; "),
            finalScore: decision.finalScore,
            verdict: decision.verdict,
          },
        }),
      );
      summary.parked += 1;
      continue;
    }

    updates.push(
      prisma.car.update({
        where: { id: row.id },
        data: {
          pipelineStage: "new_lead",
          stageReason: null,
          finalScore: decision.finalScore,
          verdict: decision.verdict,
        },
      }),
    );
    summary.keptNewLead += 1;
  }

  if (updates.length > 0) {
    await prisma.$transaction(updates);
  }

  return summary;
}

function parseArgs(argv: string[]): ApplyGoalFilterOptions {
  const i = argv.indexOf("--min-goal-fit");
  if (i === -1) return {};
  const raw = argv[i + 1];
  const n = Number(raw);
  if (!Number.isFinite(n)) {
    throw new ApplyGoalFilterError(`Invalid --min-goal-fit value: ${raw}`);
  }
  return { minGoalFit: n };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" });
  const prisma = new PrismaClient({ adapter });
  try {
    const summary = await applyGoalFilter(prisma, options);
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
