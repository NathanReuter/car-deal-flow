import { getNextAuctionDate, isFullyExpired, type AuctionSourceLike } from "@/lib/auction";

export type AuctionUrgency = "live" | "soon" | "ended" | "unknown" | "expired_stage";

export interface AuctionDisplayStatus {
  urgency: AuctionUrgency;
  /** Best date to show (next upcoming, else latest known past). */
  highlightDate: Date | null;
  nextAuctionDate: Date | null;
  latestKnownDate: Date | null;
  fullyExpiredByDates: boolean;
  /** True when highlight came from notes stamp, not CarSource.auctionDate. */
  fromNotesFallback: boolean;
  unknownSourceCount: number;
  knownSourceCount: number;
}

/** Reads the structured stamp harvest scripts append: `Auction date=<ISO>`. Not a guess. */
export function parseAuctionDateStamp(notes: string | null | undefined): Date | null {
  if (!notes) return null;
  const match = notes.match(/\bAuction date=(\d{4}-\d{2}-\d{2}T[0-9:.]+Z)\b/i);
  if (!match) return null;
  const parsed = new Date(match[1]);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

export function getLatestKnownAuctionDate(sources: AuctionSourceLike[]): Date | null {
  const known = sources
    .map((s) => s.auctionDate)
    .filter((d): d is Date => d !== null);
  if (known.length === 0) return null;
  return known.reduce((latest, d) => (d.getTime() > latest.getTime() ? d : latest));
}

/**
 * Resolve auction dates for UI. Prefers CarSource.auctionDate; if every source
 * is null, falls back to the harvest notes stamp (provenance we wrote ourselves).
 */
export function resolveAuctionSources(
  sources: AuctionSourceLike[],
  notes?: string | null,
): { sources: AuctionSourceLike[]; fromNotesFallback: boolean } {
  const hasAny = sources.some((s) => s.auctionDate !== null);
  if (hasAny || sources.length === 0) {
    return { sources, fromNotesFallback: false };
  }
  const stamped = parseAuctionDateStamp(notes);
  if (!stamped) return { sources, fromNotesFallback: false };
  return {
    sources: sources.map((s, i) => (i === 0 ? { auctionDate: stamped } : s)),
    fromNotesFallback: true,
  };
}

export function getAuctionDisplayStatus(
  sources: AuctionSourceLike[],
  opts?: {
    notes?: string | null;
    pipelineStage?: string;
    now?: Date;
  },
): AuctionDisplayStatus {
  const now = opts?.now ?? new Date();
  const resolved = resolveAuctionSources(sources, opts?.notes);
  const nextAuctionDate = getNextAuctionDate(resolved.sources, now);
  const latestKnownDate = getLatestKnownAuctionDate(resolved.sources);
  const fullyExpiredByDates = isFullyExpired(resolved.sources, now);
  const knownSourceCount = resolved.sources.filter((s) => s.auctionDate !== null).length;
  const unknownSourceCount = resolved.sources.length - knownSourceCount;
  const highlightDate = nextAuctionDate ?? latestKnownDate;

  let urgency: AuctionUrgency;
  if (opts?.pipelineStage === "expired") {
    urgency = "expired_stage";
  } else if (!highlightDate) {
    urgency = "unknown";
  } else if (nextAuctionDate) {
    const hours = (nextAuctionDate.getTime() - now.getTime()) / (1000 * 60 * 60);
    urgency = hours <= 48 ? "soon" : "live";
  } else {
    urgency = "ended";
  }

  return {
    urgency,
    highlightDate,
    nextAuctionDate,
    latestKnownDate,
    fullyExpiredByDates,
    fromNotesFallback: resolved.fromNotesFallback,
    unknownSourceCount,
    knownSourceCount,
  };
}
