import { formatBRL } from "@/lib/format";
import {
  DEAL_PHASE_LABEL,
  type Car,
  type DealPhase,
  type RepasseUrgency,
} from "@/lib/types";

/** Repasse economics are never guessed: null/undefined means "not disclosed". */
const NOT_DISCLOSED = "não informado";

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

/** BRL value or "não informado" — an undisclosed value never renders as R$ 0. */
export function formatRepasseBRL(value: number | null | undefined): string {
  if (value == null) return NOT_DISCLOSED;
  return formatBRL(value);
}

/** "48× de R$ 1.250", or the best partial phrasing, or "não informado". */
export function formatInstallmentPlan(
  installmentBRL: number | null | undefined,
  installmentsRemaining: number | null | undefined,
): string {
  const hasValue = installmentBRL != null;
  const hasCount = installmentsRemaining != null;
  if (hasValue && hasCount) return `${installmentsRemaining}× de ${formatBRL(installmentBRL)}`;
  if (hasCount) return `${installmentsRemaining} parcelas restantes`;
  if (hasValue) return `${formatBRL(installmentBRL)} por parcela`;
  return NOT_DISCLOSED;
}

/** Seller contact handle, trimmed; blank/undisclosed → "não informado". */
export function formatContact(contact: string | null | undefined): string {
  const trimmed = contact?.trim();
  return trimmed ? trimmed : NOT_DISCLOSED;
}
