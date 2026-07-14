import type { BuyingGoal, Car, GoalMatch } from "@/lib/types";
import {
  detectDamageSignals,
  formatDamageRejection,
} from "@/lib/filters/damageSignals";

// Each criterion contributes equal weight to the fit score; a hard-excluded
// brand/model always drives the score to 0 regardless of other matches.
export function computeGoalFit(car: Car, goal: BuyingGoal): GoalMatch {
  const matched: string[] = [];
  const failed: string[] = [];

  const excluded = goal.excludedBrandsModels.some((entry) => {
    const normalized = entry.toLowerCase();
    return (
      normalized === car.brand.toLowerCase() ||
      normalized === `${car.brand} ${car.model}`.toLowerCase()
    );
  });

  if (excluded) {
    failed.push(`${car.brand} ${car.model} is on the excluded list`);
    return {
      carId: car.id,
      goalId: goal.id,
      score: 0,
      matchedCriteria: [],
      failedCriteria: failed,
      explanation: `${car.brand} ${car.model} is explicitly excluded from the active buying goal.`,
    };
  }

  const damage = detectDamageSignals(car.notes);
  if (damage.blocked) {
    const reason = formatDamageRejection(damage.reasons);
    failed.push(reason);
    return {
      carId: car.id,
      goalId: goal.id,
      score: 0,
      matchedCriteria: [],
      failedCriteria: failed,
      explanation: `Listing shows damage/sinistro signals (${damage.reasons.join(", ")}). Only integral/conservado inventory is wanted.`,
    };
  }

  const criteria: { label: string; ok: boolean }[] = [
    {
      label: `Budget ${formatRange(goal.budgetMinBRL, goal.budgetMaxBRL)}`,
      ok: car.askingPriceBRL >= goal.budgetMinBRL && car.askingPriceBRL <= goal.budgetMaxBRL * 1.05,
    },
    { label: `Model year ${goal.minYear}+`, ok: car.year >= goal.minYear },
    {
      label: `Mileage under ${goal.maxMileageKm.toLocaleString("pt-BR")} km`,
      // Undisclosed mileage is a goal-fit gap, not an exemption.
      ok: car.mileageKm !== null && car.mileageKm <= goal.maxMileageKm,
    },
    {
      label: `Preferred body type (${goal.preferredBodyTypes.join(", ")})`,
      ok: goal.preferredBodyTypes.includes(car.bodyType),
    },
    {
      label: `Preferred brand (${goal.preferredBrands.join(", ")})`,
      ok: goal.preferredBrands.length === 0 || goal.preferredBrands.includes(car.brand),
    },
    {
      label: "Family space requirement",
      ok: !goal.familySpaceRequired || ["suv", "minivan", "sedan", "pickup", "wagon"].includes(car.bodyType),
    },
  ];

  for (const c of criteria) {
    if (c.ok) matched.push(c.label);
    else failed.push(c.label);
  }

  const score = Math.round((matched.length / criteria.length) * 100);

  const explanation =
    failed.length === 0
      ? `Matches all ${criteria.length} active goal criteria.`
      : `Matches ${matched.length}/${criteria.length} criteria. Falls short on: ${failed.join("; ")}.`;

  return {
    carId: car.id,
    goalId: goal.id,
    score,
    matchedCriteria: matched,
    failedCriteria: failed,
    explanation,
  };
}

function formatRange(min: number, max: number) {
  const fmt = (v: number) => `R$${Math.round(v / 1000)}k`;
  return `${fmt(min)}–${fmt(max)}`;
}
