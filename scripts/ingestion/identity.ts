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
