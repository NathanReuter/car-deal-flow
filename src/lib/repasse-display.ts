import {
  DEAL_PHASE_LABEL,
  type Car,
  type DealPhase,
  type RepasseUrgency,
} from "@/lib/types";

/** Badge variants exposed by the UI `Badge` primitive. */
export type BadgeVariant = "neutral" | "success" | "warning" | "danger" | "outline";

export interface BadgeSpec {
  label: string;
  variant: BadgeVariant;
}

/** Legacy rows (and in-memory fixtures) have no dealPhase — treat as auction. */
export function resolveDealPhase(dealPhase: DealPhase | undefined): DealPhase {
  return dealPhase ?? "auction";
}

/** Calm label distinguishing Leilão vs Pré-apreensão; carries no urgency color. */
export function phaseBadge(dealPhase: DealPhase | undefined): BadgeSpec {
  const phase = resolveDealPhase(dealPhase);
  return {
    label: DEAL_PHASE_LABEL[phase],
    variant: phase === "pre_repossession" ? "outline" : "neutral",
  };
}

const URGENCY_BADGE: Record<RepasseUrgency, BadgeSpec> = {
  high: { label: "Urgência alta", variant: "danger" },
  medium: { label: "Urgência média", variant: "warning" },
  low: { label: "Urgência baixa", variant: "neutral" },
};

/** Null/undefined urgency → nothing to show (never guessed). */
export function urgencyBadge(
  urgency: RepasseUrgency | null | undefined,
): BadgeSpec | null {
  if (urgency == null) return null;
  return URGENCY_BADGE[urgency];
}

export type PhaseFilter = "all" | DealPhase;

/** Filter predicate; legacy undefined phase counts as auction. */
export function matchesPhase(car: Pick<Car, "dealPhase">, filter: PhaseFilter): boolean {
  if (filter === "all") return true;
  return resolveDealPhase(car.dealPhase) === filter;
}
