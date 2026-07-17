export interface SourceLink {
  url: string;
  platform: string;
  isPrimary: boolean;
  auctionDate: string | null;
}

/** Primary first (first-wins), then additional CarSource rows by firstSeenAt. */
export function displaySources(
  primaryUrl: string,
  primaryPlatform: string,
  sources: {
    sourceUrl: string;
    sourcePlatform: string;
    firstSeenAt?: Date | string;
    auctionDate?: Date | string | null;
  }[],
): SourceLink[] {
  const toIso = (d: Date | string | null | undefined): string | null =>
    d == null ? null : typeof d === "string" ? d : d.toISOString();

  const primary = sources.find((s) => s.sourceUrl === primaryUrl);
  const links: SourceLink[] = [
    { url: primaryUrl, platform: primaryPlatform, isPrimary: true, auctionDate: toIso(primary?.auctionDate) },
  ];
  const secondaries = sources
    .filter((s) => s.sourceUrl !== primaryUrl)
    .slice()
    .sort((a, b) => {
      const ta = a.firstSeenAt ? new Date(a.firstSeenAt).getTime() : 0;
      const tb = b.firstSeenAt ? new Date(b.firstSeenAt).getTime() : 0;
      return ta - tb;
    });
  for (const s of secondaries) {
    links.push({
      url: s.sourceUrl,
      platform: s.sourcePlatform,
      isPrimary: false,
      auctionDate: toIso(s.auctionDate),
    });
  }
  return links;
}
