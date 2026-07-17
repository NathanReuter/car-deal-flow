import { isFullyExpired } from "@/lib/auction";
import { parseAuctionDateStamp, resolveAuctionSources } from "@/lib/auction-display";
import type { PipelineStage, Verdict } from "@/lib/types";

/** Stages where the owner is already engaged — keep on shortlist even after auction dates pass. */
export const SHORTLIST_ADVANCED_STAGES: PipelineStage[] = [
  "waiting_docs",
  "inspected",
  "negotiating",
  "approved",
];

const ADVANCED = new Set<string>(SHORTLIST_ADVANCED_STAGES);

const EXCLUDED: ReadonlySet<string> = new Set(["rejected", "parked", "bought", "expired"]);

export interface ShortlistCarLike {
  pipelineStage: PipelineStage | string;
  notes?: string | null;
  sources?: { auctionDate: string | Date | null }[] | null;
}

export interface ShortlistBundleLike {
  car: ShortlistCarLike;
  decision: { verdict: Verdict };
}

/**
 * Shortlist eligibility: drop terminal stages, and drop date-expired lots unless
 * they are already in an advanced pipeline stage (waiting docs / inspected / …).
 *
 * Call-site variants:
 * - `/shortlist` page — all eligible cars (including Avoid, for triage)
 * - Dashboard "Shortlisted" stat — {@link isShortlistHighlight}
 * - Shortlist email report — {@link isShortlistReportCandidate}
 */
export function isShortlistEligible(car: ShortlistCarLike, now: Date = new Date()): boolean {
  if (EXCLUDED.has(car.pipelineStage)) return false;

  const sources = auctionSourcesForExpiry(car);
  if (!isFullyExpired(sources, now)) return true;
  return ADVANCED.has(car.pipelineStage);
}

/** Dashboard highlight count: eligible + safe_buy / good_deal_verify. */
export function isShortlistHighlight(bundle: ShortlistBundleLike, now: Date = new Date()): boolean {
  const v = bundle.decision.verdict;
  return isShortlistEligible(bundle.car, now) && (v === "safe_buy" || v === "good_deal_verify");
}

/** Email shortlist: eligible and not scored Avoid. */
export function isShortlistReportCandidate(bundle: ShortlistBundleLike, now: Date = new Date()): boolean {
  return isShortlistEligible(bundle.car, now) && bundle.decision.verdict !== "avoid";
}

/**
 * Prefer CarSource dates via shared auction-display resolution; if there are no
 * source rows at all, still honor a harvest notes stamp so notes-only leads expire.
 */
function auctionSourcesForExpiry(car: ShortlistCarLike): { auctionDate: Date | null }[] {
  const raw = (car.sources ?? []).map((s) => ({ auctionDate: toDateOrNull(s.auctionDate) }));
  if (raw.length === 0) {
    const stamped = parseAuctionDateStamp(car.notes);
    return stamped ? [{ auctionDate: stamped }] : [];
  }
  return resolveAuctionSources(raw, car.notes).sources;
}

function toDateOrNull(value: string | Date | null | undefined): Date | null {
  if (value == null) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
