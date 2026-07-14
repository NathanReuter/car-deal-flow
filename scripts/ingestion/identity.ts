/** Normalize Brazilian plate for cross-source identity matching. */
export function normalizePlate(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.replace(/[\s\-]/g, "").toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

/** Normalize chassis / VIN for cross-source identity matching. */
export function normalizeChassis(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.replace(/[\s\-]/g, "").toUpperCase();
  return normalized.length > 0 ? normalized : null;
}

/**
 * True for full old (AAA9999) or Mercosul (AAA9A99) plates after normalization.
 * Partial fragments must not drive cross-source merges.
 */
export function isMergeablePlate(normalized: string | null | undefined): boolean {
  if (!normalized) return false;
  return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(normalized);
}
