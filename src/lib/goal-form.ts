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
  // May arrive as a string from a crafted POST; never use Boolean() on it.
  familySpaceRequired: boolean | string;
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
// Tolerates non-array input (e.g. a hand-crafted POST) by treating it as empty.
function cleanList(values: unknown): string[] {
  if (!Array.isArray(values)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of values) {
    if (typeof raw !== "string") continue;
    const value = raw.trim();
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

// Parses a form value into a number using pt-BR conventions: "." is a thousands
// separator (stripped) and "," is the decimal mark. All goal fields are integers,
// so a decimal result is left as-is and rejected by the Number.isInteger checks.
function toNumber(value: number | string): number {
  if (typeof value === "number") return value;
  if (typeof value !== "string") return NaN;
  const trimmed = value.trim();
  if (trimmed === "") return NaN;
  const normalized = trimmed.replace(/[.\s]/g, "").replace(",", ".");
  return Number(normalized);
}

// Every numeric goal field maps to a prisma Int column, so all must be whole
// numbers within their bounds — otherwise prisma.update rejects the write.
function integerError(value: number, min: number, max: number, message: string): string | undefined {
  if (!Number.isInteger(value) || value < min || value > max) return message;
  return undefined;
}

/** Checkbox / form boolean that must not treat the string "false" as truthy. */
function toBooleanFlag(value: unknown): boolean {
  if (value === true || value === "true" || value === 1 || value === "1") return true;
  return false;
}

export function validateGoalInput(input: GoalFormInput): GoalValidationResult {
  const errors: GoalFieldErrors = {};

  const name = typeof input.name === "string" ? input.name.trim() : "";
  if (!name) errors.name = "Name is required.";

  const budgetMinBRL = toNumber(input.budgetMinBRL);
  const budgetMaxBRL = toNumber(input.budgetMaxBRL);
  const minYear = toNumber(input.minYear);
  const maxMileageKm = toNumber(input.maxMileageKm);
  const fuelEconomyThresholdKmL = toNumber(input.fuelEconomyThresholdKmL);
  const minResaleLiquidityScore = toNumber(input.minResaleLiquidityScore);

  errors.budgetMinBRL = integerError(
    budgetMinBRL, 1, Number.MAX_SAFE_INTEGER, "Enter a whole budget minimum above zero.",
  );
  errors.budgetMaxBRL = integerError(
    budgetMaxBRL, 1, Number.MAX_SAFE_INTEGER, "Enter a whole budget maximum above zero.",
  );
  if (!errors.budgetMinBRL && !errors.budgetMaxBRL && budgetMaxBRL < budgetMinBRL) {
    errors.budgetMaxBRL = "Max budget must be at least the min budget.";
  }

  errors.minYear = integerError(
    minYear, MIN_ALLOWED_YEAR, MAX_ALLOWED_YEAR,
    `Enter a whole year between ${MIN_ALLOWED_YEAR} and ${MAX_ALLOWED_YEAR}.`,
  );
  errors.maxMileageKm = integerError(
    maxMileageKm, 0, Number.MAX_SAFE_INTEGER, "Enter a whole mileage of zero or more.",
  );
  errors.fuelEconomyThresholdKmL = integerError(
    fuelEconomyThresholdKmL, 0, Number.MAX_SAFE_INTEGER, "Enter a whole number of zero or more.",
  );
  errors.minResaleLiquidityScore = integerError(
    minResaleLiquidityScore, 0, 100, "Enter a whole score between 0 and 100.",
  );

  const preferredBodyTypes = cleanList(input.preferredBodyTypes);
  const invalidBodyTypes = preferredBodyTypes.filter(
    (t) => !(BODY_TYPE_OPTIONS as string[]).includes(t),
  );
  if (invalidBodyTypes.length > 0) {
    errors.preferredBodyTypes = `Unknown body type(s): ${invalidBodyTypes.join(", ")}.`;
  }

  // integerError writes undefined for valid fields; keep only real messages.
  const realErrors: GoalFieldErrors = {};
  for (const [key, message] of Object.entries(errors)) {
    if (message) realErrors[key as keyof GoalFieldErrors] = message;
  }
  if (Object.keys(realErrors).length > 0) {
    return { ok: false, errors: realErrors };
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
      familySpaceRequired: toBooleanFlag(input.familySpaceRequired),
      requiredFeatures: cleanList(input.requiredFeatures),
      preferredBodyTypes: preferredBodyTypes as BodyType[],
      preferredBrands: cleanList(input.preferredBrands),
      excludedBrandsModels: cleanList(input.excludedBrandsModels),
    },
  };
}
