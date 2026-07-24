/**
 * Hyundai Creta (BR) trim gate for CarPlay / modern multimedia.
 *
 * Action (and blank/unknown trim) often ships with a basic non-touch radio —
 * not Comfort+ blueMedia 8" / blueNav 10.25" with Apple CarPlay.
 * Allowlist is code-maintained (market equipment map), not goal-UI editable.
 */

export type CretaTechVerdict =
  | { status: "allowed"; trim: string }
  | { status: "blocked"; trim: string; reason: string }
  | { status: "unknown"; reason: string };

/** Trims with Apple CarPlay (Comfort+ blueMedia 8" or blueNav 10.25"). */
export const CRETA_CARPLAY_TRIMS = [
  "comfort plus",
  "comfort",
  "limited",
  "platinum safety",
  "platinum",
  "n line",
  "nline",
  "ultimate",
] as const;

const BLOCKED_TRIMS: { match: string; reason: string }[] = [
  {
    match: "action",
    reason:
      "Creta Action keeps the older low-tech panel / basic radio — no reliable Apple CarPlay",
  },
];

function normalizeBlob(brand: string, model: string, trim: string, notes?: string | null): string {
  return `${brand} ${model} ${trim} ${notes ?? ""}`.toLowerCase().replace(/\s+/g, " ").trim();
}

function isCreta(brand: string, model: string): boolean {
  return brand.toLowerCase().includes("hyundai") && model.toLowerCase().includes("creta");
}

/** Longest-first so "comfort plus" / "platinum safety" beat shorter tokens. */
function findListedTrim(blob: string): string | null {
  const allowed = [...CRETA_CARPLAY_TRIMS].sort((a, b) => b.length - a.length);
  for (const trim of allowed) {
    if (blob.includes(trim)) return trim;
  }
  for (const blocked of BLOCKED_TRIMS) {
    if (blob.includes(blocked.match)) return blocked.match;
  }
  return null;
}

/**
 * Classify a Creta's tech-trim eligibility from brand/model/trim/notes.
 * Non-Creta cars return null (gate does not apply).
 */
export function classifyCretaTechTrim(
  brand: string,
  model: string,
  trim: string,
  notes?: string | null,
): CretaTechVerdict | null {
  if (!isCreta(brand, model)) return null;

  const blob = normalizeBlob(brand, model, trim, notes);
  const found = findListedTrim(blob);

  if (found) {
    const blocked = BLOCKED_TRIMS.find((b) => b.match === found);
    if (blocked) {
      return { status: "blocked", trim: found, reason: blocked.reason };
    }
    return { status: "allowed", trim: found };
  }

  return {
    status: "unknown",
    reason:
      "Creta trim unknown — verify Comfort+ (8\"+/CarPlay) before treating as a pick; Action/base panel has no CarPlay",
  };
}
