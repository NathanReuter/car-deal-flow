import type { BuyingGoal, Car, ConditionReview, DecisionResult, RiskCheck, ScoreWeights, Verdict } from "@/lib/types";
import { DEFAULT_WEIGHTS } from "@/lib/types";
import { computeGoalFit } from "@/lib/scoring/goalFit";
import { computeMarketAssessment } from "@/lib/scoring/market";

const RESALE_SCORE = { high: 85, medium: 60, low: 35 } as const;

function verdictFromScore(score: number): Verdict {
  if (score >= 80) return "safe_buy";
  if (score >= 65) return "good_deal_verify";
  if (score >= 45) return "only_if_negotiated";
  return "avoid";
}

export function computeDecision(car: Car, goal: BuyingGoal, risk: RiskCheck, condition: ConditionReview): DecisionResult {
  const goalMatch = computeGoalFit(car, goal);
  const market = computeMarketAssessment(car, car.fipeValueBRL);

  const goalFitScore = goalMatch.score;
  const documentationRiskScore = risk.score;
  const conditionScore = condition.score;
  const resaleLiquidityScore = RESALE_SCORE[market.resaleEase];
  const valueScore =
    market.premiumOverFairPct === null
      ? null
      : Math.max(0, Math.min(100, Math.round(50 - market.premiumOverFairPct * 2)));

  // Weight set: drop value and renormalize the rest when FIPE is unknown.
  let weights: ScoreWeights = { ...DEFAULT_WEIGHTS };
  if (valueScore === null) {
    const kept = DEFAULT_WEIGHTS.goalFit + DEFAULT_WEIGHTS.documentationRisk + DEFAULT_WEIGHTS.condition + DEFAULT_WEIGHTS.resaleLiquidity;
    weights = {
      goalFit: DEFAULT_WEIGHTS.goalFit / kept,
      documentationRisk: DEFAULT_WEIGHTS.documentationRisk / kept,
      condition: DEFAULT_WEIGHTS.condition / kept,
      value: 0,
      resaleLiquidity: DEFAULT_WEIGHTS.resaleLiquidity / kept,
    };
  }

  const finalScore = Math.round(
    goalFitScore * weights.goalFit +
      documentationRiskScore * weights.documentationRisk +
      conditionScore * weights.condition +
      (valueScore ?? 0) * weights.value +
      resaleLiquidityScore * weights.resaleLiquidity,
  );

  const severeRiskGate = risk.items.some((i) => i.status === "failed" && i.severity === "severe");
  const manualOverrideApplied = Boolean(car.manualVerdictOverride);

  let verdict: Verdict;
  if (manualOverrideApplied) verdict = car.manualVerdictOverride!;
  else if (severeRiskGate) verdict = "avoid";
  else verdict = verdictFromScore(finalScore);

  const reasoning: string[] = [];
  if (manualOverrideApplied) reasoning.push(`Manual override: ${car.overrideReason ?? "set by owner"}.`);
  if (severeRiskGate) reasoning.push("Severe documentation risk gates this to Avoid regardless of score.");
  reasoning.push(`Goal fit ${goalFitScore}, risk ${documentationRiskScore}, condition ${conditionScore}, resale ${resaleLiquidityScore}.`);
  reasoning.push(valueScore === null ? "FIPE not synced — value excluded from the blend." : `Value score ${valueScore} (${market.verdict.replaceAll("_", " ")}).`);

  return {
    carId: car.id,
    goalFitScore,
    documentationRiskScore,
    conditionScore,
    valueScore,
    resaleLiquidityScore,
    finalScore,
    verdict,
    severeRiskGate,
    manualOverrideApplied,
    weights,
    reasoning,
  };
}
