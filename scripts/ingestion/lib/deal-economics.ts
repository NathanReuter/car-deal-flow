import { computeLandedCost } from "@/lib/cost/landedCost";

export interface DealCar {
  model: string;
  trim: string;
  sourceUrl: string;
  year: number;
  dealPhase: string;
  askingPriceBRL: number;
  installmentBRL: number | null;
  installmentsRemaining: number | null;
  outstandingDebtBRL: number | null;
  fipeValueBRL: number | null;
  city: string;
  state: string;
}

export type TargetTier = "core" | "lottery";

export interface TargetHit {
  key: string;
  tier: TargetTier;
}

const CORE_RULES: Array<{ re: RegExp; key: string }> = [
  { re: /\bcreta\b/i, key: "creta" },
  { re: /\bnivus\b/i, key: "nivus" },
  { re: /\bt-?cross\b/i, key: "t-cross" },
  { re: /\btaos\b/i, key: "taos" },
  { re: /\bhr-?v\b/i, key: "hr-v" },
  { re: /\bkicks\b/i, key: "kicks" },
  { re: /\bcompass\b/i, key: "compass" },
  { re: /\bcorolla[\s-]*cross\b/i, key: "corolla-cross" },
  { re: /\bpulse\b/i, key: "pulse" },
  { re: /\bfastback\b/i, key: "fastback" },
  { re: /\btiggo\s*5x\b/i, key: "tiggo-5x" },
];

const LOTTERY_RULES: Array<{ re: RegExp; key: string }> = [
  { re: /\bsong(?:\s*(?:pro|plus))?\b/i, key: "song" },
  { re: /\byuan\s*plus\b/i, key: "yuan-plus" },
  { re: /\bhaval\b/i, key: "haval" },
];

/** @deprecated Prefer classifyTargetModel — kept for any leftover callers. */
export const TARGET_MODEL_RE =
  /\b(nivus|t-?cross|taos|hr-?v|song(?:\s*(?:pro|plus))?|yuan\s*plus|haval|creta|compass|corolla[\s-]*cross|pulse|fastback|tiggo\s*5x|kicks)\b/i;

const SPECIAL_DEAL_MAX_PCT_OF_FIPE = 0.6;
const MIN_YEAR = 2021;

export function classifyTargetModel(text: string): TargetHit | null {
  if (/\btiggo\s*[78]\b/i.test(text)) return null;
  for (const rule of CORE_RULES) {
    if (rule.re.test(text)) return { key: rule.key, tier: "core" };
  }
  for (const rule of LOTTERY_RULES) {
    if (rule.re.test(text)) return { key: rule.key, tier: "lottery" };
  }
  return null;
}

export function isTargetModelText(text: string): boolean {
  return classifyTargetModel(text) != null;
}

export function totalCostBRL(car: DealCar): number | null {
  return computeLandedCost({
    askingPriceBRL: car.askingPriceBRL,
    dealPhase: car.dealPhase,
    city: car.city,
    state: car.state,
  }).landedCostBRL;
}

export function isSpecialDeal(car: DealCar): boolean {
  const blob = `${car.model} ${car.trim} ${car.sourceUrl}`;
  if (!isTargetModelText(blob)) return false;
  if (car.year < MIN_YEAR) return false;
  if (car.fipeValueBRL == null || car.fipeValueBRL <= 0) return false;
  const total = totalCostBRL(car);
  if (total === null) return false;
  return total <= car.fipeValueBRL * SPECIAL_DEAL_MAX_PCT_OF_FIPE;
}
