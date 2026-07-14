import { prisma } from "@/lib/db";
import { computeDecision } from "@/lib/scoring/decision";
import { computeGoalFit } from "@/lib/scoring/goalFit";
import { computeMarketAssessment } from "@/lib/scoring/market";
import { computeRiskScore } from "@/lib/scoring/risk";
import { computeConditionScore } from "@/lib/scoring/condition";
import type {
  BuyingGoal,
  Car,
  ConditionReview,
  DecisionResult,
  GoalMatch,
  MarketAssessment,
  RiskCheck,
  RiskCheckItem,
  ConditionField,
} from "@/lib/types";
import type {
  Car as DbCar,
  Attachment as DbAttachment,
  RiskCheck as DbRiskCheck,
  ConditionReview as DbConditionReview,
  BuyingGoal as DbBuyingGoal,
  CarSource as DbCarSource,
} from "@/generated/prisma/client";
import { displaySources } from "@/lib/sources";

export interface CarBundle {
  car: Car;
  decision: DecisionResult;
  goalMatch: GoalMatch;
  market: MarketAssessment;
  risk: RiskCheck;
  condition: ConditionReview;
}

type DbCarWithRelations = DbCar & {
  attachments: DbAttachment[];
  riskCheck: DbRiskCheck | null;
  conditionReview: DbConditionReview | null;
  sources: DbCarSource[];
};

const CAR_INCLUDE = {
  attachments: true,
  riskCheck: true,
  conditionReview: true,
  sources: true,
} as const;

function toCar(row: DbCarWithRelations): Car {
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
    sellerType: row.sellerType as Car["sellerType"],
    fuel: row.fuel as Car["fuel"],
    transmission: row.transmission as Car["transmission"],
    bodyType: row.bodyType as Car["bodyType"],
    color: row.color,
    sourceUrl: row.sourceUrl,
    sourcePlatform: row.sourcePlatform,
    sources: displaySources(row.sourceUrl, row.sourcePlatform, row.sources),
    notes: row.notes,
    plate: row.plate ?? undefined,
    chassis: row.chassis ?? undefined,
    attachments: row.attachments.map((a) => ({
      id: a.id,
      label: a.label,
      kind: a.kind as "photo" | "document" | "evidence_link",
      url: a.url,
      addedAt: a.addedAt.toISOString(),
    })),
    photos: JSON.parse(row.photos) as string[],
    pipelineStage: row.pipelineStage as Car["pipelineStage"],
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    manualVerdictOverride: (row.manualVerdictOverride as Car["manualVerdictOverride"]) ?? undefined,
    overrideReason: row.overrideReason ?? undefined,
    stageReason: row.stageReason ?? undefined,
    fipeValueBRL: row.fipeValueBRL,
  };
}

function toRiskCheck(row: DbRiskCheck): RiskCheck {
  const items = JSON.parse(row.items) as RiskCheckItem[];
  return {
    carId: row.carId,
    items,
    caixaReview: {
      applicable: row.caixaApplicable,
      editalReviewed: row.caixaEditalReviewed,
      hiddenTransferCostsBRL: row.caixaHiddenTransferCosts,
      resaleStigmaNote: row.caixaResaleStigmaNote,
      historyClarity: row.caixaHistoryClarity as "clear" | "partial" | "unclear",
      legalTransferRiskNote: row.caixaLegalTransferRisk,
    },
    score: computeRiskScore(items),
  };
}

function toConditionReview(row: DbConditionReview): ConditionReview {
  const fields = JSON.parse(row.fields) as ConditionField[];
  return {
    carId: row.carId,
    fields,
    mechanicNotes: row.mechanicNotes,
    score: computeConditionScore(fields),
  };
}

function toBuyingGoal(row: DbBuyingGoal): BuyingGoal {
  return {
    id: row.id,
    name: row.name,
    active: row.active,
    budgetMinBRL: row.budgetMinBRL,
    budgetMaxBRL: row.budgetMaxBRL,
    minYear: row.minYear,
    maxMileageKm: row.maxMileageKm,
    requiredFeatures: JSON.parse(row.requiredFeatures) as string[],
    preferredBodyTypes: JSON.parse(row.preferredBodyTypes) as Car["bodyType"][],
    preferredBrands: JSON.parse(row.preferredBrands) as string[],
    excludedBrandsModels: JSON.parse(row.excludedBrandsModels) as string[],
    fuelEconomyThresholdKmL: row.fuelEconomyThresholdKmL,
    minResaleLiquidityScore: row.minResaleLiquidityScore,
    familySpaceRequired: row.familySpaceRequired,
  };
}

export async function getActiveGoal(): Promise<BuyingGoal> {
  const row = await prisma.buyingGoal.findFirst({ where: { active: true } });
  if (!row) throw new Error("No active buying goal configured.");
  return toBuyingGoal(row);
}

function buildBundle(row: DbCarWithRelations, goal: BuyingGoal): CarBundle {
  const car = toCar(row);
  const risk = row.riskCheck ? toRiskCheck(row.riskCheck) : { carId: car.id, items: [], caixaReview: {
    applicable: false, editalReviewed: false, hiddenTransferCostsBRL: 0, resaleStigmaNote: "", historyClarity: "clear" as const, legalTransferRiskNote: "",
  }, score: 100 };
  const condition = row.conditionReview
    ? toConditionReview(row.conditionReview)
    : { carId: car.id, fields: [], mechanicNotes: "Not inspected yet.", score: 50 };

  const decision = computeDecision(car, goal, risk, condition);
  const goalMatch = computeGoalFit(car, goal);
  const market = computeMarketAssessment(car, car.fipeValueBRL);

  return { car, decision, goalMatch, market, risk, condition };
}

export async function getAllBundles(): Promise<CarBundle[]> {
  const [rows, goal] = await Promise.all([
    prisma.car.findMany({ include: CAR_INCLUDE, orderBy: { createdAt: "asc" } }),
    getActiveGoal(),
  ]);
  return rows.map((row) => buildBundle(row, goal));
}

export async function getBundle(carId: string): Promise<CarBundle | undefined> {
  const [row, goal] = await Promise.all([
    prisma.car.findUnique({ where: { id: carId }, include: CAR_INCLUDE }),
    getActiveGoal(),
  ]);
  if (!row) return undefined;
  return buildBundle(row, goal);
}
