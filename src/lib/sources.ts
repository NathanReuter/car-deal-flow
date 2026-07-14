export interface SourceLink {
  url: string;
  platform: string;
  isPrimary: boolean;
}

/** Primary first (first-wins), then additional CarSource rows. */
export function displaySources(
  primaryUrl: string,
  primaryPlatform: string,
  sources: { sourceUrl: string; sourcePlatform: string }[],
): SourceLink[] {
  const links: SourceLink[] = [
    { url: primaryUrl, platform: primaryPlatform, isPrimary: true },
  ];
  for (const s of sources) {
    if (s.sourceUrl === primaryUrl) continue;
    links.push({
      url: s.sourceUrl,
      platform: s.sourcePlatform,
      isPrimary: false,
    });
  }
  return links;
}
