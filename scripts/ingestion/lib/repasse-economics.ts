// Conservative extraction of repasse deal economics from Portuguese ad text.
// Fail-closed contract: any ambiguity (conflicting values, "a combinar",
// out-of-range garbage) yields null for that field — never a guess. Never throws.

export interface RepasseEconomics {
  entryAskBRL: number | null;
  outstandingDebtBRL: number | null;
  installmentBRL: number | null;
  installmentsRemaining: number | null;
  sellerContact: string | null;
}

// Sanity bands: values outside these are parse garbage, not real deals.
const ENTRY_RANGE = { min: 500, max: 500_000 };
const DEBT_RANGE = { min: 1_000, max: 1_000_000 };
const INSTALLMENT_RANGE = { min: 100, max: 20_000 };
const REMAINING_RANGE = { min: 1, max: 96 };

// "15.000", "15000", "15 mil", "1.250,50"
const AMOUNT = String.raw`(\d{1,3}(?:\.\d{3})+(?:,\d{2})?|\d+(?:,\d{2})?)(\s*mil\b)?`;

function parseAmount(num: string, milSuffix: string | undefined): number | null {
  const base = Number(num.replace(/\./g, "").replace(",", "."));
  if (!Number.isFinite(base)) return null;
  return Math.round(milSuffix ? base * 1000 : base);
}

function inRange(n: number, range: { min: number; max: number }): boolean {
  return n >= range.min && n <= range.max;
}

/** All in-range values for a keyworded amount pattern. Distinct conflicting
 * values → ambiguous → null. "a combinar"/"consulte" after the keyword → null. */
function extractKeyedAmount(
  text: string,
  keyword: RegExp,
  range: { min: number; max: number },
): number | null {
  const re = new RegExp(
    keyword.source + String.raw`[\s:]*(?:de\s+)?(?:no valor de\s+)?(?:R?\$\s*)?` + AMOUNT,
    "gi",
  );
  const negotiable = new RegExp(keyword.source + String.raw`[\s:]*(?:a combinar|consulte)`, "i");
  if (negotiable.test(text)) return null;

  const values = new Set<number>();
  for (const m of text.matchAll(re)) {
    const value = parseAmount(m[m.length - 2] as string, m[m.length - 1] as string | undefined);
    if (value !== null && inRange(value, range)) values.add(value);
  }
  return values.size === 1 ? [...values][0] : null;
}

const ENTRY_KEY = /(?:entrada|[áa]gio)/;
const DEBT_KEY = /(?:saldo(?:\s+devedor)?|devendo|d[íi]vida(?:\s+de)?)/;

// "48x de R$ 1.100" / "restam 30 parcelas de R$ 1.250" / "parcelas de R$ 899"
const COUNT_X = new RegExp(String.raw`(\d{1,2})\s*x\s*(?:de\s*)?(?:R?\$\s*)?` + AMOUNT, "gi");
const RESTAM = /restam\s+(\d{1,2})\s+parcelas/gi;
const PARCELA_VALUE = new RegExp(
  String.raw`parcelas?\s*(?:de|:)\s*(?:R?\$\s*)?` + AMOUNT,
  "gi",
);

// Phones only next to explicit contact wording — a bare number could be anything.
const CONTACT = new RegExp(
  String.raw`(?:whats(?:app)?|zap|contato|fone|telefone|tel|chamar|ligar?)\D{0,15}` +
    String.raw`((?:\+?55\s*)?\(?\d{2}\)?\s*9?\s?\d{4}[-.\s]?\d{4})`,
  "i",
);

function single<T>(values: Set<T>): T | null {
  return values.size === 1 ? [...values][0] : null;
}

export function extractRepasseEconomics(text: string): RepasseEconomics {
  const entryAskBRL = extractKeyedAmount(text, ENTRY_KEY, ENTRY_RANGE);
  const outstandingDebtBRL = extractKeyedAmount(text, DEBT_KEY, DEBT_RANGE);

  const counts = new Set<number>();
  const installments = new Set<number>();

  for (const m of text.matchAll(COUNT_X)) {
    const count = Number(m[1]);
    if (inRange(count, REMAINING_RANGE)) counts.add(count);
    const value = parseAmount(m[2], m[3]);
    if (value !== null && inRange(value, INSTALLMENT_RANGE)) installments.add(value);
  }
  for (const m of text.matchAll(RESTAM)) {
    const count = Number(m[1]);
    if (inRange(count, REMAINING_RANGE)) counts.add(count);
  }
  for (const m of text.matchAll(PARCELA_VALUE)) {
    const value = parseAmount(m[1], m[2]);
    if (value !== null && inRange(value, INSTALLMENT_RANGE)) installments.add(value);
  }

  const contact = text.match(CONTACT);

  return {
    entryAskBRL,
    outstandingDebtBRL,
    installmentBRL: single(installments),
    installmentsRemaining: single(counts),
    sellerContact: contact ? contact[1].trim() : null,
  };
}
