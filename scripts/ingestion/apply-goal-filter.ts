import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client";
import { computeGoalFit } from "../../src/lib/scoring/goalFit";
import type {
  BodyType,
  BuyingGoal,
  Car,
  PipelineStage,
  SellerType,
} from "../../src/lib/types";

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

function toCar(row: {
  id: string;
  brand: string;
  model: string;
  trim: string;
  year: number;
  modelYear: number;
  mileageKm: number | null;
  askingPriceBRL: number;
  city: string;
  state: string;
  sellerType: string;
  fuel: string;
  transmission: string;
  bodyType: string;
  color: string;
  sourceUrl: string;
  sourcePlatform: string;
  notes: string;
  plate: string | null;
  chassis: string | null;
  photos: string;
  pipelineStage: string;
  createdAt: Date;
  updatedAt: Date;
  manualVerdictOverride: string | null;
  overrideReason: string | null;
  stageReason: string | null;
  fipeValueBRL: number | null;
}): Car {
  return {
    id: row.id,
    brand: row.brand,
    model: row.model,
    trim: row.trim,
    year: row.year,
    modelYear: row.modelYear,
    mileageKm: row.mileageKm,
    askingPriceBRL: row.askingPriceBRL,
    city: row.city,
    state: row.state,
    sellerType: row.sellerType as SellerType,
    fuel: row.fuel as Car["fuel"],
    transmission: row.transmission as Car["transmission"],
    bodyType: row.bodyType as BodyType,
    color: row.color,
    sourceUrl: row.sourceUrl,
    sourcePlatform: row.sourcePlatform,
    notes: row.notes,
    plate: row.plate ?? undefined,
    chassis: row.chassis ?? undefined,
    attachments: [],
    photos: JSON.parse(row.photos) as string[],
    pipelineStage: row.pipelineStage as PipelineStage,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    manualVerdictOverride: (row.manualVerdictOverride as Car["manualVerdictOverride"]) ?? undefined,
    overrideReason: row.overrideReason ?? undefined,
    stageReason: row.stageReason ?? undefined,
    fipeValueBRL: row.fipeValueBRL,
  };
}

function toGoal(row: {
  id: string;
  name: string;
  active: boolean;
  budgetMinBRL: number;
  budgetMaxBRL: number;
  minYear: number;
  maxMileageKm: number;
  requiredFeatures: string;
  preferredBodyTypes: string;
  preferredBrands: string;
  excludedBrandsModels: string;
  fuelEconomyThresholdKmL: number;
  minResaleLiquidityScore: number;
  familySpaceRequired: boolean;
}): BuyingGoal {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    budgetMinBRL: row.budgetMinBRL,
    budgetMaxBRL: row.budgetMaxBRL,
    minYear: row.minYear,
    maxMileageKm: row.maxMileageKm,
    requiredFeatures: JSON.parse(row.requiredFeatures) as string[],
    preferredBodyTypes: JSON.parse(row.preferredBodyTypes) as BodyType[],
    preferredBrands: JSON.parse(row.preferredBrands) as string[],
    excludedBrandsModels: JSON.parse(row.excludedBrandsModels) as string[],
    fuelEconomyThresholdKmL: row.fuelEconomyThresholdKmL,
    minResaleLiquidityScore: row.minResaleLiquidityScore,
    familySpaceRequired: row.familySpaceRequired,
  };
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
  const goal = toGoal(goalRow);

  const cars = await prisma.car.findMany({
    where: { pipelineStage: { in: ["new_lead", "parked"] } },
  });

  const summary: ApplyGoalFilterSummary = {
    evaluated: cars.length,
    keptNewLead: 0,
    parked: 0,
    rejected: 0,
  };

  for (const row of cars) {
    const match = computeGoalFit(toCar(row), goal);

    if (match.score === 0) {
      await prisma.car.update({
        where: { id: row.id },
        data: {
          pipelineStage: "rejected",
          stageReason: match.failedCriteria.join("; ") || match.explanation,
        },
      });
      summary.rejected += 1;
      continue;
    }

    if (match.score < minGoalFit) {
      await prisma.car.update({
        where: { id: row.id },
        data: {
          pipelineStage: "parked",
          stageReason: match.failedCriteria.join("; "),
        },
      });
      summary.parked += 1;
      continue;
    }

    await prisma.car.update({
      where: { id: row.id },
      data: {
        pipelineStage: "new_lead",
        stageReason: null,
      },
    });
    summary.keptNewLead += 1;
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
