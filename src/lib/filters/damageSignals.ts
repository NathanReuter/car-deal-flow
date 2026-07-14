/**
 * Detect insurer/auction damage signals in listing text (notes, descriptions).
 * Used at harvest (skip), write-lead (block), and goal-fit (hard reject).
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
    test: (t) => /\bcolis[aã]o\b/.test(t),
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
    test: (t) => /\bbatido\b/.test(t) && !/\b(nao|não)\s+batido\b/.test(t),
  },
  {
    label: "sinistro de porte",
    test: (t) =>
      /\bsinistro\s+(?:de\s+)?(?:medio|media|grande)\s+porte\b/.test(t),
  },
  {
    label: "sinistro",
    test: (t) => hasSinistroWithoutNegation(t),
  },
];

function hasSinistroWithoutNegation(normalized: string): boolean {
  return hasTokenWithoutNegation(normalized, "sinistro", ["sem", "nao", "não"]);
}

/** Match `token` unless immediately preceded by a negation prefix (e.g. non-sucata, sem sinistro). */
function hasTokenWithoutNegation(
  normalized: string,
  token: string,
  negationPrefixes: string[],
): boolean {
  const re = new RegExp(`\\b${token}\\b`, "g");
  let match: RegExpExecArray | null;
  while ((match = re.exec(normalized)) !== null) {
    const start = match.index;
    const before = normalized.slice(Math.max(0, start - 12), start);
    const negated = negationPrefixes.some((p) => {
      const esc = p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      return new RegExp(`\\b${esc}[-\\s]?$`).test(before);
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

  // Deduplicate while preserving order (sinistro + colisão both may fire)
  const unique = [...new Set(reasons)];

  return {
    blocked: unique.length > 0,
    reasons: unique,
  };
}

export function formatDamageRejection(reasons: string[]): string {
  return `Damage/sinistro: ${reasons.join("; ")}`;
}
