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
  RepasseUrgency,
  DealPhase,
  SourceChannel,
  LeadConfidence,
  Verdict,
} from "@/lib/types";
import type {
  Car as DbCar,
  Attachment as DbAttachment,
  RiskCheck as DbRiskCheck,
  ConditionReview as DbConditionReview,
  BuyingGoal as DbBuyingGoal,
  CarSource as DbCarSource,
  Prisma,
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

export type DbCarWithRelations = DbCar & {
  attachments: DbAttachment[];
  riskCheck: DbRiskCheck | null;
  conditionReview: DbConditionReview | null;
  sources: DbCarSource[];
};

export const CAR_INCLUDE = {
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
    sources: displaySources(
      row.sourceUrl,
      row.sourcePlatform,
      row.sources.map((s) => ({
        sourceUrl: s.sourceUrl,
        sourcePlatform: s.sourcePlatform,
        firstSeenAt: s.firstSeenAt,
        auctionDate: s.auctionDate,
      })),
    ),
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
    dealPhase: row.dealPhase as Car["dealPhase"],
    sourceChannel: (row.sourceChannel as Car["sourceChannel"]) ?? undefined,
    confidence: (row.confidence as Car["confidence"]) ?? undefined,
    repasse:
      row.dealPhase === "pre_repossession"
        ? {
            entryAskBRL: row.entryAskBRL,
            outstandingDebtBRL: row.outstandingDebtBRL,
            installmentBRL: row.installmentBRL,
            installmentsRemaining: row.installmentsRemaining,
            sellerContact: row.sellerContact,
            urgency: row.repasseUrgency as RepasseUrgency | null,
          }
        : undefined,
  };
}

export function toRiskCheck(row: DbRiskCheck): RiskCheck {
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

export function toConditionReview(row: DbConditionReview): ConditionReview {
  const fields = JSON.parse(row.fields) as ConditionField[];
  return {
    carId: row.carId,
    fields,
    mechanicNotes: row.mechanicNotes,
    score: computeConditionScore(fields),
  };
}

export function toBuyingGoal(row: DbBuyingGoal): BuyingGoal {
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

export function buildBundle(row: DbCarWithRelations, goal: BuyingGoal): CarBundle {
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

export async function getAllBundles(opts?: { limit?: number }): Promise<CarBundle[]> {
  const [rows, goal] = await Promise.all([
    prisma.car.findMany({
      include: CAR_INCLUDE,
      orderBy: { createdAt: opts?.limit !== undefined ? "desc" : "asc" },
      ...(opts?.limit !== undefined ? { take: opts.limit } : {}),
    }),
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

// ---------------------------------------------------------------------------
// getBundlesPage — server-side filter / sort / paginate (FW-2 Slice 2)

export interface BundlesPageParams {
  page?: number;         // 1-based, default 1
  pageSize?: number;     // default 50
  q?: string;            // text search: brand / model / trim / city
  brand?: string;
  stage?: string;        // pipelineStage
  phase?: DealPhase;
  sourceChannel?: SourceChannel;
  confidence?: LeadConfidence;
  state?: string;
  verdict?: Verdict;
  priceMin?: number;
  priceMax?: number;
  belowFipePctMin?: number; // only rows where askingPrice <= fipeValue * (1 - pct/100)
  sort?: "score" | "price" | "year" | "mileage" | "recent";
}

export interface BundlesPage {
  rows: CarBundle[];
  total: number;
  page: number;
  pageSize: number;
  facets: {
    phase: Record<string, number>;
    sourceChannel: Record<string, number>;
    verdict: Record<string, number>;
    confidence: Record<string, number>;
  };
}

export async function getBundlesPage(
  params: BundlesPageParams,
  db: typeof prisma = prisma,
): Promise<BundlesPage> {
  const MAX_PAGE_SIZE = 200;
  const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, params.pageSize ?? 50));
  const page = Math.min(100_000, Math.max(1, params.page ?? 1));
  const skip = (page - 1) * pageSize;

  // Build the Prisma where clause
  const where: Prisma.CarWhereInput = {};

  // Default: hide expired unless stage is explicitly chosen
  if (!params.stage) {
    where.pipelineStage = { not: "expired" };
  } else {
    where.pipelineStage = params.stage;
  }

  if (params.brand !== undefined) where.brand = { contains: params.brand };
  if (params.phase !== undefined) where.dealPhase = params.phase;
  if (params.sourceChannel !== undefined) where.sourceChannel = params.sourceChannel;
  if (params.confidence !== undefined) where.confidence = params.confidence;
  if (params.state !== undefined) where.state = params.state;
  if (params.verdict !== undefined) where.verdict = params.verdict;

  if (params.priceMin !== undefined || params.priceMax !== undefined) {
    where.askingPriceBRL = {};
    if (params.priceMin !== undefined) where.askingPriceBRL.gte = params.priceMin;
    if (params.priceMax !== undefined) where.askingPriceBRL.lte = params.priceMax;
  }

  if (params.q) {
    const q = params.q;
    where.OR = [
      { brand: { contains: q } },
      { model: { contains: q } },
      { trim: { contains: q } },
      { city: { contains: q } },
    ];
  }

  // belowFipePctMin: raw SQL to find IDs satisfying the cross-column constraint.
  // SQLite does not support computed WHERE via Prisma, so we collect eligible IDs
  // with $queryRaw and add them as an id-in filter.
  if (params.belowFipePctMin !== undefined) {
    const threshold = params.belowFipePctMin;
    // Apply the same stage constraint as the main where clause so the raw
    // query scans only the relevant subset of rows (not the entire table).
    let rows: { id: string }[];
    if (params.stage) {
      const stage = params.stage;
      rows = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM Car
        WHERE fipeValueBRL IS NOT NULL
          AND fipeValueBRL > 0
          AND askingPriceBRL <= fipeValueBRL * (1.0 - ${threshold} / 100.0)
          AND pipelineStage = ${stage}
      `;
    } else {
      rows = await db.$queryRaw<{ id: string }[]>`
        SELECT id FROM Car
        WHERE fipeValueBRL IS NOT NULL
          AND fipeValueBRL > 0
          AND askingPriceBRL <= fipeValueBRL * (1.0 - ${threshold} / 100.0)
          AND pipelineStage != 'expired'
      `;
    }
    const eligibleIds = rows.map((r) => r.id);
    // Intersect with any existing id filter (none in base path)
    where.id = { in: eligibleIds };
  }

  // Sort order
  const orderBy: Prisma.CarOrderByWithRelationInput[] = [];
  switch (params.sort) {
    case "score":
      orderBy.push({ finalScore: "desc" });
      break;
    case "price":
      orderBy.push({ askingPriceBRL: "asc" });
      break;
    case "year":
      orderBy.push({ year: "desc" });
      break;
    case "mileage":
      // nulls: "last" pushes rows with no odometer data to the bottom (Prisma 7+ / SQLite).
      orderBy.push({ mileageKm: { sort: "asc", nulls: "last" } });
      break;
    case "recent":
    default:
      orderBy.push({ createdAt: "desc" });
      break;
  }
  // Stable secondary sort
  orderBy.push({ id: "asc" });

  // Run queries in parallel: page rows, total count, facets, active goal.
  // Goal is loaded via `db` so tests can inject a test client with seeded data.
  const [pageRows, total, phaseGroups, channelGroups, verdictGroups, confidenceGroups, goalRow] =
    await Promise.all([
      db.car.findMany({
        where,
        include: CAR_INCLUDE,
        orderBy,
        skip,
        take: pageSize,
      }),
      db.car.count({ where }),
      db.car.groupBy({ by: ["dealPhase"], where, _count: true }),
      db.car.groupBy({ by: ["sourceChannel"], where, _count: true }),
      db.car.groupBy({ by: ["verdict"], where, _count: true }),
      db.car.groupBy({ by: ["confidence"], where, _count: true }),
      db.buyingGoal.findFirst({ where: { active: true } }),
    ]);

  if (!goalRow) throw new Error("No active buying goal configured.");
  const goal = toBuyingGoal(goalRow);

  const toRecord = (
    groups: { _count: number; [key: string]: unknown }[],
    key: string,
  ): Record<string, number> => {
    const rec: Record<string, number> = {};
    for (const g of groups) {
      const val = g[key];
      if (val !== null && val !== undefined) {
        rec[String(val)] = g._count;
      }
    }
    return rec;
  };

  return {
    rows: pageRows.map((row) => buildBundle(row, goal)),
    total,
    page,
    pageSize,
    facets: {
      phase: toRecord(phaseGroups, "dealPhase"),
      sourceChannel: toRecord(channelGroups, "sourceChannel"),
      verdict: toRecord(verdictGroups, "verdict"),
      confidence: toRecord(confidenceGroups, "confidence"),
    },
  };
}
