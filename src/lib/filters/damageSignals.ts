/**
 * Detect insurer/auction damage signals in listing text (notes, descriptions).
 * Used at harvest (skip), write-lead (block), and goal-fit (hard reject).
 *
 * Prefer integral / conservado / sem sinistro inventory. Fail closed on clear
 * salvage language; do not block mere presence of "monta" outside "X monta"
 * grades, or negated phrases like "sem colisão" / "sem histórico de sinistro".
 */
export interface DamageSignalResult {
  blocked: boolean;
  reasons: string[];
}

/** Strip accents and lower-case for stable matching. */
export function normalizeDamageText(text: string): string {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
}

type DamageRule = {
  label: string;
  test: (normalized: string) => boolean;
};

const RULES: DamageRule[] = [
  {
    label: "colisão",
    test: (t) => hasTokenWithoutNegation(t, "colisao", ["sem", "nao", "não"]),
  },
  {
    label: "média monta",
    test: (t) => /\b(media|medio)\s+monta\b/.test(t),
  },
  {
    label: "grande monta",
    test: (t) => /\bgrande\s+monta\b/.test(t),
  },
  {
    label: "pequena monta",
    test: (t) => /\bpequena\s+monta\b/.test(t),
  },
  {
    label: "sucata",
    test: (t) => hasTokenWithoutNegation(t, "sucata", ["non", "nao", "não"]),
  },
  {
    label: "batido",
    test: (t) => hasTokenWithoutNegation(t, "batido", ["nao", "não", "sem"]),
  },
  {
    label: "sinistro de porte",
    test: (t) =>
      /\bsinistro\s+(?:de\s+)?(?:medio|media|grande)\s+porte\b/.test(t),
  },
  {
    label: "sinistrado",
    // Bradesco recovery type and similar; avoid matching "sinistralidade".
    test: (t) => /\bsinistrado\b/.test(t),
  },
  {
    label: "sinistro",
    test: (t) => hasSinistroWithoutNegation(t),
  },
];

function hasSinistroWithoutNegation(normalized: string): boolean {
  return hasTokenWithoutNegation(normalized, "sinistro", ["sem", "nao", "não"]);
}

/**
 * Match `token` unless a negation prefix appears in the preceding window
 * (e.g. "sem sinistro", "sem historico de sinistro", "non-sucata", "nao batido").
 */
function hasTokenWithoutNegation(
  normalized: string,
  token: string,
  negationPrefixes: string[],
): boolean {
  const re = new RegExp(`\\b${token}\\b`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(normalized)) !== null) {
    const start = match.index;
    // Look back far enough for "sem historico de sinistro" / "nada consta de …"
    const before = normalized.slice(Math.max(0, start - 40), start);
    const negated = negationPrefixes.some((p) => {
      const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      // Immediate: "sem sinistro", "non-sucata", "nao batido"
      const immediate = new RegExp(`\\b${esc}[-\\s]?$`).test(before);
      // Nearby: "sem historico de sinistro", "nao ha registro de sinistro"
      const nearby = new RegExp(
        `\\b${esc}\\b(?:[\\s\\-/]+\\w+){1,4}\\s*$`,
      ).test(before);
      return immediate || nearby;
    });
    if (!negated) return true;
  }
  return false;
}

export function detectDamageSignals(text: string | null | undefined): DamageSignalResult {
  if (!text || !text.trim()) {
    return { blocked: false, reasons: [] };
  }

  const normalized = normalizeDamageText(text);
  const reasons: string[] = [];

  for (const rule of RULES) {
    if (rule.test(normalized)) {
      reasons.push(rule.label);
    }
  }

  const unique = [...new Set(reasons)];

  return {
    blocked: unique.length > 0,
    reasons: unique,
  };
}

export function formatDamageRejection(reasons: string[]): string {
  return `Damage/sinistro: ${reasons.join("; ")}`;
}
