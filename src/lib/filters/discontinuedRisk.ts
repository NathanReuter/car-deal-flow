/**
 * Curated, code-maintained list of brands/models with elevated resale-support
 * risk in Brazil as of 2026-07-21: brands with paralyzed/exited BR operations
 * (thin or no dealer/parts network), or models discontinued outright by
 * Proconve L8 non-compliance with no confirmed successor. This is distinct
 * from BuyingGoal.excludedBrandsModels (user-editable, goal-specific) — this
 * list reflects market research, not a personal preference, so it applies
 * regardless of which goal is active.
 *
 * Entries use the same "Brand" or "Brand Model" convention as
 * excludedBrandsModels. Re-review periodically — this is a snapshot, not an
 * evergreen fact (successors get confirmed, brands re-enter the market).
 */
export interface DiscontinuedRiskEntry {
  match: string;
  reason: string;
}

export const DISCONTINUED_RISK_LIST: DiscontinuedRiskEntry[] = [
  { match: "Neta", reason: "Brand's Brazil operations are paralyzed — parts/service support at risk" },
  { match: "Seres", reason: "Brand exited Brazil after a thin dealer network" },
  { match: "Jaguar", reason: "Entire lineup discontinued in Brazil in 2025" },
  { match: "Subaru", reason: "Brand ended commercial operations in Brazil" },
  { match: "Mitsubishi Pajero Sport", reason: "Discontinued in Brazil (Proconve L8 non-compliance), no confirmed successor" },
  { match: "Citroën C4 Cactus", reason: "Discontinued Dec/2024 — low sales volume and thin Brazil parts network" },
  { match: "Suzuki Jimny", reason: "Import discontinued (Jimny Sierra); current engine non-compliant with Proconve L8" },
];

/** Returns the risk reason if brand or "brand model" matches the curated list, else null. */
export function findDiscontinuedRisk(brand: string, model: string): string | null {
  const brandOnly = brand.trim().toLowerCase();
  const brandModel = `${brand} ${model}`.trim().toLowerCase();
  const hit = DISCONTINUED_RISK_LIST.find((entry) => {
    const normalized = entry.match.toLowerCase();
    return normalized === brandOnly || normalized === brandModel;
  });
  return hit?.reason ?? null;
}
