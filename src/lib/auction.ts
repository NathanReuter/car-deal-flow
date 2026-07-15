export interface AuctionSourceLike {
  auctionDate: Date | null;
}

/** Soonest known future auction date across a car's sources, or null if none/all unknown/all past. */
export function getNextAuctionDate(sources: AuctionSourceLike[], now: Date = new Date()): Date | null {
  const future = sources
    .map((s) => s.auctionDate)
    .filter((d): d is Date => d !== null && d.getTime() > now.getTime());
  if (future.length === 0) return null;
  return future.reduce((soonest, d) => (d.getTime() < soonest.getTime() ? d : soonest));
}

/** True only if every source has a non-null auctionDate in the past. Unknown dates block expiry. */
export function isFullyExpired(sources: AuctionSourceLike[], now: Date = new Date()): boolean {
  if (sources.length === 0) return false;
  return sources.every((s) => s.auctionDate !== null && s.auctionDate.getTime() <= now.getTime());
}
