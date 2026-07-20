export type CadenceSource =
  | "olx"
  | "vip"
  | "mgl"
  | "bradesco"
  | "napista"
  | "webmotors"
  | "storefronts";

// Weekday sets per source (0 = Sunday … 6 = Saturday). Santander, BIDchain and
// Leilões PB are deliberately absent — paused for near-zero yield under the
// 2021+ goal (see 2026-07-18 cadence spec).
const SCHEDULE: Record<CadenceSource, number[]> = {
  olx: [0, 1, 2, 3, 4, 5, 6],
  vip: [1, 3, 5],
  mgl: [2, 4],
  bradesco: [1],
  // Aggressive-ingestion sources (approved 2026-07-20):
  napista: [0, 1, 2, 3, 4, 5, 6], // daily — plain-fetch, low cost, high value
  webmotors: [1, 3, 5], // Mon/Wed/Fri — Playwright+stealth, moderate load
  storefronts: [2, 5], // Tue/Fri — config-driven storefront scrape
};

export function sourcesDueOn(date: Date): CadenceSource[] {
  const weekday = date.getDay();
  return (Object.keys(SCHEDULE) as CadenceSource[]).filter((s) =>
    SCHEDULE[s].includes(weekday),
  );
}
