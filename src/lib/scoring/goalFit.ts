import type { BuyingGoal, Car, GoalMatch } from "@/lib/types";
import {
  detectDamageSignals,
  formatDamageRejection,
} from "@/lib/filters/damageSignals";
import { findDiscontinuedRisk } from "@/lib/filters/discontinuedRisk";
import { classifyCretaTechTrim } from "@/lib/filters/cretaTechTrim";
import { computeLandedCost } from "@/lib/cost/landedCost";

// Each criterion contributes equal weight to the fit score; a hard-excluded
// brand/model always drives the score to 0 regardless of other matches.
export function computeGoalFit(car: Car, goal: BuyingGoal): GoalMatch {
  const matched: string[] = [];
  const failed: string[] = [];

  const excluded = goal.excludedBrandsModels.some((entry) => {
    const normalized = entry.toLowerCase().trim();
    const brand = car.brand.toLowerCase();
    const model = car.model.toLowerCase();
    const full = `${brand} ${model}`;
    // "Jeep Renegade" matches "jeep renegade" and "jeep renegade longitude";
    // bare "Tracker" matches model "tracker" / "tracker lt".
    return (
      normalized === brand ||
      normalized === full ||
      full === normalized ||
      full.startsWith(`${normalized} `) ||
      model === normalized ||
      model.startsWith(`${normalized} `)
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

  const discontinuedRisk = findDiscontinuedRisk(car.brand, car.model);
  if (discontinuedRisk) {
    failed.push(`${car.brand} ${car.model}: ${discontinuedRisk}`);
    return {
      carId: car.id,
      goalId: goal.id,
      score: 0,
      matchedCriteria: [],
      failedCriteria: failed,
      explanation: `${car.brand} ${car.model} carries elevated resale/support risk: ${discontinuedRisk}.`,
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

  // Creta Action = hard reject (no CarPlay). Unknown Creta trim = soft park
  // (score 40) until Comfort+/Limited+/Platinum+ is confirmed from listing.
  const cretaTech = classifyCretaTechTrim(car.brand, car.model, car.trim, car.notes);
  if (cretaTech?.status === "blocked") {
    failed.push(cretaTech.reason);
    return {
      carId: car.id,
      goalId: goal.id,
      score: 0,
      matchedCriteria: [],
      failedCriteria: failed,
      explanation: cretaTech.reason,
    };
  }
  if (cretaTech?.status === "unknown") {
    failed.push(cretaTech.reason);
    return {
      carId: car.id,
      goalId: goal.id,
      score: 40,
      matchedCriteria: [],
      failedCriteria: failed,
      explanation: cretaTech.reason,
    };
  }

  // A body type outside the goal's preferred list is a segment mismatch (e.g. an
  // entry hatch when the goal wants compact SUVs), not a partial-credit gap — it
  // hard-rejects like the excluded-model and damage gates above.
  if (
    goal.preferredBodyTypes.length > 0 &&
    !goal.preferredBodyTypes.includes(car.bodyType)
  ) {
    failed.push(
      `${car.bodyType} is outside the preferred body types (${goal.preferredBodyTypes.join(", ")})`,
    );
    return {
      carId: car.id,
      goalId: goal.id,
      score: 0,
      matchedCriteria: [],
      failedCriteria: failed,
      explanation: `${car.brand} ${car.model} is a ${car.bodyType}, outside the goal's preferred body types (${goal.preferredBodyTypes.join(", ")}).`,
    };
  }

  const landed = computeLandedCost({
    askingPriceBRL: car.askingPriceBRL,
    dealPhase: car.dealPhase,
    city: car.city,
    state: car.state,
  }).landedCostBRL;

  const criteria: { label: string; ok: boolean }[] = [
    {
      label: `Budget ${formatRange(goal.budgetMinBRL, goal.budgetMaxBRL)}`,
      ok:
        landed != null &&
        landed >= goal.budgetMinBRL &&
        landed <= goal.budgetMaxBRL * 1.05,
    },
    { label: `Model year ${goal.minYear}+`, ok: car.year >= goal.minYear },
    {
      label: `Mileage under ${goal.maxMileageKm.toLocaleString("pt-BR")} km`,
      // Undisclosed mileage is a goal-fit gap, not an exemption.
      ok: car.mileageKm !== null && car.mileageKm <= goal.maxMileageKm,
    },
    {
      label: `Preferred brand (${goal.preferredBrands.join(", ")})`,
      ok: goal.preferredBrands.length === 0 || goal.preferredBrands.includes(car.brand),
    },
    {
      // Note: once preferredBodyTypes is gated above to a family-space-eligible
      // set (e.g. ["suv"]), every car reaching this point already satisfies this
      // check — it only still discriminates when preferredBodyTypes is empty or
      // includes hatch/coupe alongside family-capable body types.
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
