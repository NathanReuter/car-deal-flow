import type { BodyType } from "./types";
import { BODY_TYPE_OPTIONS } from "./goal-options";

// Raw shape submitted by the goal editor. Numbers may arrive as strings from
// form inputs; array fields carry the selector chips verbatim.
export interface GoalFormInput {
  name: string;
  budgetMinBRL: number | string;
  budgetMaxBRL: number | string;
  minYear: number | string;
  maxMileageKm: number | string;
  fuelEconomyThresholdKmL: number | string;
  minResaleLiquidityScore: number | string;
  familySpaceRequired: boolean;
  requiredFeatures: string[];
  preferredBodyTypes: string[];
  preferredBrands: string[];
  excludedBrandsModels: string[];
}

// Validated, persistence-ready goal fields (everything but id/active).
export interface NormalizedGoal {
  name: string;
  budgetMinBRL: number;
  budgetMaxBRL: number;
  minYear: number;
  maxMileageKm: number;
  fuelEconomyThresholdKmL: number;
  minResaleLiquidityScore: number;
  familySpaceRequired: boolean;
  requiredFeatures: string[];
  preferredBodyTypes: BodyType[];
  preferredBrands: string[];
  excludedBrandsModels: string[];
}

export type GoalFieldErrors = Partial<Record<keyof GoalFormInput, string>>;

export type GoalValidationResult =
  | { ok: true; value: NormalizedGoal }
  | { ok: false; errors: GoalFieldErrors };

// Persistence shape for prisma.buyingGoal.update — array fields are JSON strings,
// mirroring how aggregate.ts's toBuyingGoal parses them back out.
export interface GoalDbData {
  name: string;
  budgetMinBRL: number;
  budgetMaxBRL: number;
  minYear: number;
  maxMileageKm: number;
  fuelEconomyThresholdKmL: number;
  minResaleLiquidityScore: number;
  familySpaceRequired: boolean;
  requiredFeatures: string;
  preferredBodyTypes: string;
  preferredBrands: string;
  excludedBrandsModels: string;
}

export function serializeGoalForDb(goal: NormalizedGoal): GoalDbData {
  return {
    name: goal.name,
    budgetMinBRL: goal.budgetMinBRL,
    budgetMaxBRL: goal.budgetMaxBRL,
    minYear: goal.minYear,
    maxMileageKm: goal.maxMileageKm,
    fuelEconomyThresholdKmL: goal.fuelEconomyThresholdKmL,
    minResaleLiquidityScore: goal.minResaleLiquidityScore,
    familySpaceRequired: goal.familySpaceRequired,
    requiredFeatures: JSON.stringify(goal.requiredFeatures),
    preferredBodyTypes: JSON.stringify(goal.preferredBodyTypes),
    preferredBrands: JSON.stringify(goal.preferredBrands),
    excludedBrandsModels: JSON.stringify(goal.excludedBrandsModels),
  };
}

const MIN_ALLOWED_YEAR = 1980;
const MAX_ALLOWED_YEAR = 2100;

// Trim, drop empties, and de-duplicate (first occurrence wins) while preserving order.
function cleanList(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function toNumber(value: number | string): number {
  if (typeof value === "number") return value;
  const trimmed = value.trim();
  if (trimmed === "") return NaN;
  return Number(trimmed);
}

export function validateGoalInput(input: GoalFormInput): GoalValidationResult {
  const errors: GoalFieldErrors = {};

  const name = input.name.trim();
  if (!name) errors.name = "Name is required.";

  const budgetMinBRL = toNumber(input.budgetMinBRL);
  const budgetMaxBRL = toNumber(input.budgetMaxBRL);
  const minYear = toNumber(input.minYear);
  const maxMileageKm = toNumber(input.maxMileageKm);
  const fuelEconomyThresholdKmL = toNumber(input.fuelEconomyThresholdKmL);
  const minResaleLiquidityScore = toNumber(input.minResaleLiquidityScore);

  if (!Number.isFinite(budgetMinBRL) || budgetMinBRL <= 0) {
    errors.budgetMinBRL = "Enter a budget minimum above zero.";
  }
  if (!Number.isFinite(budgetMaxBRL) || budgetMaxBRL <= 0) {
    errors.budgetMaxBRL = "Enter a budget maximum above zero.";
  }
  if (
    !errors.budgetMinBRL &&
    !errors.budgetMaxBRL &&
    budgetMaxBRL < budgetMinBRL
  ) {
    errors.budgetMaxBRL = "Max budget must be at least the min budget.";
  }

  if (!Number.isInteger(minYear) || minYear < MIN_ALLOWED_YEAR || minYear > MAX_ALLOWED_YEAR) {
    errors.minYear = `Enter a year between ${MIN_ALLOWED_YEAR} and ${MAX_ALLOWED_YEAR}.`;
  }
  if (!Number.isFinite(maxMileageKm) || maxMileageKm < 0) {
    errors.maxMileageKm = "Enter a mileage of zero or more.";
  }
  if (!Number.isFinite(fuelEconomyThresholdKmL) || fuelEconomyThresholdKmL < 0) {
    errors.fuelEconomyThresholdKmL = "Enter a value of zero or more.";
  }
  if (
    !Number.isFinite(minResaleLiquidityScore) ||
    minResaleLiquidityScore < 0 ||
    minResaleLiquidityScore > 100
  ) {
    errors.minResaleLiquidityScore = "Enter a score between 0 and 100.";
  }

  const preferredBodyTypes = cleanList(input.preferredBodyTypes);
  const invalidBodyTypes = preferredBodyTypes.filter(
    (t) => !(BODY_TYPE_OPTIONS as string[]).includes(t),
  );
  if (invalidBodyTypes.length > 0) {
    errors.preferredBodyTypes = `Unknown body type(s): ${invalidBodyTypes.join(", ")}.`;
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    value: {
      name,
      budgetMinBRL,
      budgetMaxBRL,
      minYear,
      maxMileageKm,
      fuelEconomyThresholdKmL,
      minResaleLiquidityScore,
      familySpaceRequired: Boolean(input.familySpaceRequired),
      requiredFeatures: cleanList(input.requiredFeatures),
      preferredBodyTypes: preferredBodyTypes as BodyType[],
      preferredBrands: cleanList(input.preferredBrands),
      excludedBrandsModels: cleanList(input.excludedBrandsModels),
    },
  };
}
