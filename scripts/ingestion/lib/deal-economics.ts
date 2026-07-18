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
}

export const TARGET_MODEL_RE =
  /\b(nivus|t-?cross|taos|hr-?v|song(?:\s*(?:pro|plus))?|kicks|creta|tracker|compass|corolla[\s-]*cross|pulse|fastback)\b/i;

const SPECIAL_DEAL_MAX_PCT_OF_FIPE = 0.6;
const MIN_YEAR = 2021;

export function totalCostBRL(car: DealCar): number | null {
  if (car.dealPhase !== "pre_repossession") return car.askingPriceBRL;
  if (car.installmentBRL && car.installmentsRemaining) {
    return car.askingPriceBRL + car.installmentBRL * car.installmentsRemaining;
  }
  if (car.outstandingDebtBRL) return car.askingPriceBRL + car.outstandingDebtBRL;
  return null; // repasse with unknown debt cannot be priced honestly
}

export function isSpecialDeal(car: DealCar): boolean {
  const blob = `${car.model} ${car.trim} ${car.sourceUrl}`;
  if (!TARGET_MODEL_RE.test(blob)) return false;
  if (car.year < MIN_YEAR) return false;
  if (!car.fipeValueBRL) return false;
  const total = totalCostBRL(car);
  if (total === null) return false;
  return total <= car.fipeValueBRL * SPECIAL_DEAL_MAX_PCT_OF_FIPE;
}
