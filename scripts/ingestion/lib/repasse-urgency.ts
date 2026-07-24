// Heuristic urgency for pre-repossession (repasse) leads. The CONTRAN 1.018
// notification date is unobservable, so no day-countdowns — only observable
// signals, ranked here in one place:
//
//   high   — a judicial/RENAJUD restriction was found (the clock is provably
//            running), or the ad admits distress (busca e apreensão, parcelas
//            atrasadas, entrega amigável, "banco vai tomar").
//   medium — soft urgency wording ("urgente", "preciso vender rápido") or a
//            deep discount (asking ≤ 75% of FIPE, both values known).
//   low    — everything else.

import type { RepasseUrgency } from "../../../src/lib/types";

const STRONG_MARKERS =
  /busca\s+e\s+apreens|banco\s+(?:vai|j[áa])\s+tomar|entrega\s+amig[áa]vel|parcelas?\s+atrasad|atrase[im]\s+(?:a|as)\s+parcel/i;

const SOFT_MARKERS =
  /urgente|urg[êe]ncia|preciso\s+vender\s+(?:r[áa]pido|logo|hoje)|repasse\s+r[áa]pido/i;

const DEEP_DISCOUNT_RATIO = 0.75;

export interface RepasseUrgencyInput {
  /** True when a judicial/RENAJUD restriction was confirmed by risk checks. */
  restrictionFound?: boolean;
  adText?: string;
  askingPriceBRL?: number | null;
  fipeValueBRL?: number | null;
}

export function computeRepasseUrgency(input: RepasseUrgencyInput): RepasseUrgency {
  const text = input.adText ?? "";

  if (input.restrictionFound || STRONG_MARKERS.test(text)) return "high";

  // Intentionally compares the raw ask (not landed cost): this is a distress
  // signal, and FIPE is not yet synced at parse time (the only caller passes
  // adText only). Landed cost governs the cost/ranking surfaces, not this flag.
  const deepDiscount =
    input.askingPriceBRL != null &&
    input.fipeValueBRL != null &&
    input.fipeValueBRL > 0 &&
    input.askingPriceBRL <= input.fipeValueBRL * DEEP_DISCOUNT_RATIO;

  if (SOFT_MARKERS.test(text) || deepDiscount) return "medium";

  return "low";
}
