import {
  classifyTargetModel,
  totalCostBRL,
  type DealCar,
  type TargetTier,
} from "./deal-economics";
import { classifyCretaTechTrim } from "../../../src/lib/filters/cretaTechTrim";

/** Stages already moved into the working pipeline — never appear in top picks. */
export const PIPELINE_MOVED_STAGES = [
  "researching",
  "waiting_docs",
  "inspected",
  "negotiating",
  "approved",
  "parked",
  "rejected",
  "expired",
  "bought",
] as const;

export interface TopPicksGoal {
  budgetMinBRL: number;
  budgetMaxBRL: number;
  minYear: number;
  maxMileageKm: number;
  preferredBodyTypes: string[];
  preferredBrands: string[];
  excludedBrandsModels: string[];
}

export interface TopPicksCar extends DealCar {
  id: string;
  brand: string;
  bodyType: string;
  mileageKm: number | null;
  pipelineStage: string;
  sourcePlatform: string;
  stageReason: string | null;
  notes: string | null;
}

export interface TopPick {
  id: string;
  label: string;
  year: number;
  mileageKm: number;
  bodyType: string;
  dealPhase: string;
  sourcePlatform: string;
  targetModel: string | null;
  tier: TargetTier;
  cashCostBRL: number;
  fipeValueBRL: number | null;
  pctOfFipe: number | null;
  inBudget: boolean;
  sourceUrl: string;
  caveats: string[];
}

export interface TopPicksReport {
  goalName?: string;
  limit: number;
  scanned: number;
  eligible: number;
  picks: TopPick[];
}

function parseJsonArray(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map(String) : [];
  } catch {
    return [];
  }
}

export function goalFromRow(row: {
  name?: string;
  budgetMinBRL: number;
  budgetMaxBRL: number;
  minYear: number;
  maxMileageKm: number;
  preferredBodyTypes: string;
  preferredBrands: string;
  excludedBrandsModels: string;
}): TopPicksGoal & { name?: string } {
  return {
    name: row.name,
    budgetMinBRL: row.budgetMinBRL,
    budgetMaxBRL: row.budgetMaxBRL,
    minYear: row.minYear,
    maxMileageKm: row.maxMileageKm,
    preferredBodyTypes: parseJsonArray(row.preferredBodyTypes).map((s) => s.toLowerCase()),
    preferredBrands: parseJsonArray(row.preferredBrands),
    excludedBrandsModels: parseJsonArray(row.excludedBrandsModels),
  };
}

function targetBlob(
  car: Pick<TopPicksCar, "brand" | "model" | "trim" | "sourceUrl" | "notes">,
): string {
  return `${car.brand} ${car.model} ${car.trim} ${car.sourceUrl} ${car.notes ?? ""}`;
}

export function detectTargetModel(
  car: Pick<TopPicksCar, "brand" | "model" | "trim" | "sourceUrl" | "notes">,
): string | null {
  return classifyTargetModel(targetBlob(car))?.key ?? null;
}

export function detectTargetTier(
  car: Pick<TopPicksCar, "brand" | "model" | "trim" | "sourceUrl" | "notes">,
): TargetTier | null {
  return classifyTargetModel(targetBlob(car))?.tier ?? null;
}

function rankBucket(p: TopPick): number {
  if (p.tier === "core" && p.inBudget) return 0;
  if (p.inBudget) return 1;
  if (p.tier === "lottery" && p.pctOfFipe != null && p.pctOfFipe <= 70) return 2;
  return 3;
}

function brandPreferred(brand: string, preferred: string[]): boolean {
  if (preferred.length === 0) return true;
  const b = brand.toLowerCase();
  return preferred.some((p) => {
    const x = p.toLowerCase();
    return x === b || (x === "vw" && b === "volkswagen") || (x === "volkswagen" && b === "vw");
  });
}

function isExcluded(car: TopPicksCar, excluded: string[]): boolean {
  const brand = car.brand.toLowerCase();
  const model = car.model.toLowerCase();
  const full = `${brand} ${model}`;
  return excluded.some((e) => {
    const n = e.toLowerCase().trim();
    return (
      n === brand ||
      n === full ||
      full.startsWith(`${n} `) ||
      model === n ||
      model.startsWith(`${n} `)
    );
  });
}

function isFalsePositiveFlagged(car: TopPicksCar): boolean {
  const blob = `${car.stageReason ?? ""}\n${car.notes ?? ""}`.toUpperCase();
  return blob.includes("FALSE POSITIVE");
}

function repasseCaveats(car: TopPicksCar): string[] {
  if (car.dealPhase !== "pre_repossession") return [];
  const caveats: string[] = [];
  const notes = (car.notes ?? "").toLowerCase();
  if (
    notes.includes("trocar o carro") ||
    notes.includes("aceito veículo") ||
    notes.includes("aceito veiculo") ||
    notes.includes("transfiro a dívida") ||
    notes.includes("transfiro a divida")
  ) {
    caveats.push(
      "Repasse may require a trade-in car — do not treat quitação alone as all-in cost until seller confirms.",
    );
  }
  if (car.outstandingDebtBRL == null && (car.installmentBRL == null || car.installmentsRemaining == null)) {
    caveats.push("Repasse debt undisclosed — cash cost may be incomplete.");
  }
  return caveats;
}

export function isTopPickEligible(car: TopPicksCar, goal: TopPicksGoal): boolean {
  if (car.pipelineStage !== "new_lead") return false;
  if (isFalsePositiveFlagged(car)) return false;
  if (isExcluded(car, goal.excludedBrandsModels)) return false;
  if (car.year < goal.minYear) return false;
  if (car.mileageKm == null || car.mileageKm > goal.maxMileageKm) return false;
  if (goal.preferredBodyTypes.length > 0 && !goal.preferredBodyTypes.includes(car.bodyType.toLowerCase())) {
    return false;
  }
  if (!brandPreferred(car.brand, goal.preferredBrands)) return false;
  if (detectTargetModel(car) == null) return false;
  const cretaTech = classifyCretaTechTrim(car.brand, car.model, car.trim, car.notes);
  if (cretaTech && cretaTech.status !== "allowed") return false;
  const cash = totalCostBRL(car);
  if (cash == null || cash <= 0) return false;
  return true;
}

export function toTopPick(car: TopPicksCar, goal: TopPicksGoal): TopPick | null {
  if (!isTopPickEligible(car, goal)) return null;
  const hit = classifyTargetModel(targetBlob(car));
  if (hit == null) return null;
  const cash = totalCostBRL(car)!;
  const fipe = car.fipeValueBRL != null && car.fipeValueBRL > 0 ? car.fipeValueBRL : null;
  const pct = fipe != null ? Math.round((1000 * cash) / fipe) / 10 : null;
  const softMax = goal.budgetMaxBRL * 1.05;
  return {
    id: car.id,
    label: `${car.brand} ${car.model}${car.trim ? ` ${car.trim}` : ""} ${car.year}`.replace(/\s+/g, " ").trim(),
    year: car.year,
    mileageKm: car.mileageKm!,
    bodyType: car.bodyType,
    dealPhase: car.dealPhase,
    sourcePlatform: car.sourcePlatform,
    targetModel: hit.key,
    tier: hit.tier,
    cashCostBRL: cash,
    fipeValueBRL: fipe,
    pctOfFipe: pct,
    inBudget: cash >= goal.budgetMinBRL && cash <= softMax,
    sourceUrl: car.sourceUrl,
    caveats: repasseCaveats(car),
  };
}

export function buildTopPicksReport(cars: TopPicksCar[], goal: TopPicksGoal, limit = 10): TopPicksReport {
  const all = cars
    .map((c) => toTopPick(c, goal))
    .filter((p): p is TopPick => p != null)
    .sort((a, b) => {
      const bucket = rankBucket(a) - rankBucket(b);
      if (bucket !== 0) return bucket;
      const ap = a.pctOfFipe ?? 150;
      const bp = b.pctOfFipe ?? 150;
      if (ap !== bp) return ap - bp;
      if (a.cashCostBRL !== b.cashCostBRL) return a.cashCostBRL - b.cashCostBRL;
      return a.mileageKm - b.mileageKm;
    });

  return {
    limit,
    scanned: cars.length,
    eligible: all.length,
    picks: all.slice(0, limit),
  };
}
