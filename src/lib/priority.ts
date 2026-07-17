import type { CarBundle } from "@/lib/aggregate";
import { isShortlistEligible } from "@/lib/shortlist";

export interface PriorityItem {
  bundle: CarBundle;
  reason: string;
  urgency: number; // higher = more urgent
}

export function getPriorityReviewItems(bundles: CarBundle[], limit = 5): PriorityItem[] {
  const items: PriorityItem[] = [];

  for (const bundle of bundles) {
    if (!isShortlistEligible(bundle.car)) continue;

    if (bundle.decision.severeRiskGate) {
      items.push({ bundle, reason: "Severe documentation risk flagged — review before any offer.", urgency: 100 });
      continue;
    }

    const pendingOrWarning = bundle.risk.items.filter((i) => i.status === "pending" || i.status === "warning");
    if (pendingOrWarning.length > 0) {
      items.push({
        bundle,
        reason: `${pendingOrWarning.length} document check(s) need verification.`,
        urgency: 60 + pendingOrWarning.length,
      });
      continue;
    }

    if (bundle.car.pipelineStage === "negotiating") {
      items.push({ bundle, reason: "In active negotiation — confirm final terms.", urgency: 55 });
      continue;
    }

    if (bundle.decision.verdict === "avoid") {
      items.push({ bundle, reason: "Scored as Avoid — consider moving to Rejected.", urgency: 50 });
    }
  }

  return items.sort((a, b) => b.urgency - a.urgency).slice(0, limit);
}
