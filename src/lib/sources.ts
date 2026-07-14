export interface SourceLink {
  url: string;
  platform: string;
  isPrimary: boolean;
}

/** Primary first (first-wins), then additional CarSource rows by firstSeenAt. */
export function displaySources(
  primaryUrl: string,
  primaryPlatform: string,
  sources: { sourceUrl: string; sourcePlatform: string; firstSeenAt?: Date | string }[],
): SourceLink[] {
  const links: SourceLink[] = [
    { url: primaryUrl, platform: primaryPlatform, isPrimary: true },
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
    });
  }
  return links;
}
