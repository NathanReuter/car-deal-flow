import type { ConditionField, ConditionRating } from "@/lib/types";

const RATING_POINTS: Record<Exclude<ConditionRating, "not_inspected">, number> = { good: 100, fair: 60, poor: 20 };

/** 0-100 average over inspected fields. All-uninspected/empty → 50 (unknown). */
export function computeConditionScore(fields: ConditionField[]): number {
  const rated = fields.filter((f) => f.rating !== "not_inspected");
  if (rated.length === 0) return 50;
  const total = rated.reduce((s, f) => s + RATING_POINTS[f.rating as keyof typeof RATING_POINTS], 0);
  return Math.round(total / rated.length);
}
