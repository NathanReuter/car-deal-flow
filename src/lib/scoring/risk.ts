import type { RiskCheckItem, CheckSeverity, CheckStatus } from "@/lib/types";

const SEVERITY_WEIGHT: Record<CheckSeverity, number> = { low: 5, medium: 12, high: 25, severe: 45 };
const STATUS_MULTIPLIER: Record<CheckStatus, number> = { verified: 0, pending: 0.4, warning: 0.6, failed: 1 };

/** 0-100. Starts at 100; each unresolved item subtracts severity×status. A
 *  failed+severe item floors the score near zero. Empty checklist → 100. */
export function computeRiskScore(items: RiskCheckItem[]): number {
  let penalty = 0;
  let severeFailure = false;
  for (const it of items) {
    penalty += SEVERITY_WEIGHT[it.severity] * STATUS_MULTIPLIER[it.status];
    if (it.status === "failed" && it.severity === "severe") severeFailure = true;
  }
  let score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  if (severeFailure) score = Math.min(score, 10);
  return score;
}
