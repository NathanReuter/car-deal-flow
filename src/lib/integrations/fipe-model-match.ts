import type { Car } from "@/lib/types";
import { FipeError } from "@/lib/integrations/fipe-error";

export interface FipeModel {
  code: string;
  name: string;
}

function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Auction listings glue displacement + gearbox ("10MT", "10TAT", "1.0MT").
// Split those before tokenizing so "1.0" / "mt" can score against FIPE names.
function preprocessAuctionText(s: string): string {
  return s
    .replace(/\bcd\s*4\s*x\s*4\b/gi, "cd 4x4")
    .replace(/\bcd4x4\b/gi, "cd 4x4")
    // "1.0L" is liters, not a Gol "L" trim letter.
    .replace(/\b(\d+\.\d+)l\b/gi, "$1")
    .replace(/\b(\d)\.0(t)?(mt|at)\b/gi, "$1.0 $2 $3")
    .replace(/\b(\d)0(t)?(mt|at)\b/gi, "$1.0 $2 $3")
    .replace(/\b(\d)0m\b/gi, "$1.0");
}

// Preserves decimals ("2.8", "1.0") as single tokens instead of splitting
// them into separate digits — FIPE model names repeat displacement numbers
// often enough (e.g. "2.8/Sert. 2.8") that naive word-splitting inflates
// matches on unrelated trims.
function tokenize(s: string): Set<string> {
  const lowered = preprocessAuctionText(s)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  const tokens = lowered.match(/[a-z0-9]+(?:\.[0-9]+)?/g) ?? [];
  return new Set(tokens);
}

// Trim names ("LTZ", "Intense", "Comfortline") disambiguate far better than
// shared powertrain jargon ("flex", "aut", "16v", "tb"). Ignore the latter
// when deciding whether a match is confident enough to trust.
const GENERIC_TOKENS = new Set([
  "flex", "aut", "mec", "cvt", "tb", "turbo", "16v", "8v", "12v", "5p", "4p",
  "3p", "cd", "cs", "4x2", "4x4", "tdi", "tsi", "dies", "diesel", "gasolina",
  "automatic", "automatico", "manual",
  // Auction gearbox / body shorthand after preprocessAuctionText splits compounds.
  "mt", "at", "m", "t", "hb", "sed", "sedan", "hatch", "mpi", "msi", "sce",
  "fpower", "econoflex", "activeflex", "active",
]);

// Auction / classified abbreviations → FIPE catalog tokens. FIPE truncates
// several VW trim names ("Highline" → "Hig.", "Comfortline" → "Comfor.").
const TRIM_TOKEN_ALIASES: Record<string, string> = {
  hl: "hig",
  highline: "hig",
  hig: "hig",
  ae: "aut", // common BR listing shorthand for automático
  cl: "comfor",
  comfortline: "comfor",
  comfor: "comfor",
  extreme: "ext",
  ext: "ext",
  lgtd: "limited",
  ltd: "limited",
  limited: "limited",
  joye: "joy",
  attract: "attractive",
  attractiv: "attractive",
  evoluti: "evolution",
  evolution: "evolution",
  auth: "authentique",
  authentique: "authentique",
  expr: "expression",
  expression: "expression",
  dyn: "dynamique",
  dyna: "dynamique",
  dynamique: "dynamique",
  prec: "precision",
  precision: "precision",
  rrover: "range",
  furgaopk: "furgao",
  furgao: "furgao",
};

function expandQueryTokens(raw: Set<string>): Set<string> {
  const out = new Set<string>();
  for (const t of raw) {
    out.add(TRIM_TOKEN_ALIASES[t] ?? t);
  }
  return out;
}

function transmissionTokens(transmission: Car["transmission"] | undefined): Set<string> {
  if (transmission === "automatic") return new Set(["aut"]);
  if (transmission === "manual") return new Set(["mec"]);
  return new Set();
}

/**
 * Exact or prefix match so auction truncations hit FIPE names ("attract" →
 * "attractive"). Require 4+ chars on the shorter side so "gol" cannot latch
 * onto "golf".
 */
function tokensLooselyMatch(a: string, b: string): boolean {
  if (a === b) return true;
  const shorter = a.length <= b.length ? a : b;
  const longer = a.length <= b.length ? b : a;
  if (shorter.length < 4) return false;
  return longer.startsWith(shorter);
}

function candidateHasToken(candidateTokens: Set<string>, queryToken: string): boolean {
  if (candidateTokens.has(queryToken)) return true;
  for (const c of candidateTokens) {
    if (tokensLooselyMatch(queryToken, c)) return true;
  }
  return false;
}

/**
 * Family anchors are exact for letter-only names ("gol" must not hit "golf"),
 * but alphanumeric codes allow a prefix so "320i" hits "320ia".
 */
function candidateHasFamilyToken(candidateTokens: Set<string>, queryToken: string): boolean {
  if (candidateTokens.has(queryToken)) return true;
  if (!/\d/.test(queryToken)) return false;
  for (const c of candidateTokens) {
    if (c.startsWith(queryToken) || queryToken.startsWith(c)) return true;
  }
  return false;
}

function isDisplacementToken(t: string): boolean {
  return /^\d+\.\d+$/.test(t);
}

function isDistinctiveToken(t: string): boolean {
  return !GENERIC_TOKENS.has(t) && !/^\d+$/.test(t) && !isDisplacementToken(t) && !/^[a-z]$/.test(t);
}

/**
 * Leading model-name tokens only. Auction rows stuff trim into `model`
 * ("Tiggo Fl 2.0 Mt"); using every distinctive token as "family" would let a
 * Chery QQ "FL" trim poison Tiggo matching.
 */
function extractModelFamilyTokens(model: string): string[] {
  const tokens = [...expandQueryTokens(tokenize(model))];
  const family: string[] = [];
  for (const t of tokens) {
    if (isDisplacementToken(t) || GENERIC_TOKENS.has(t)) break;
    // Keep "t" from "T-Cross"; skip other short prefixes like "lr" / "fl".
    if (/^[a-z]$/.test(t)) {
      family.push(t);
      continue;
    }
    if (t.length < 3) continue;
    if (!isDistinctiveToken(t)) continue;
    family.push(t);
    break;
  }
  return family;
}

/**
 * Auction junk that never appears on the model-family rows can be ignored.
 * Digit-bearing codes ("10mt", "p5d") and short letter crumbs ("ma", "fl",
 * single letters) are noise; longer letter tokens ("rline") stay required so
 * we refuse overconfident mismatches.
 *
 * Catalog presence is scoped to the model family on purpose: Chery "FL" on QQ
 * must not force a Tiggo listing to require "fl".
 */
function isIgnorableNoise(token: string, catalogHas: boolean): boolean {
  if (/^[a-z]$/.test(token)) return true;
  if (catalogHas) return false;
  if (/\d/.test(token)) return true;
  return token.length <= 3;
}

function tokenScore(queryTokens: Set<string>, candidateTokens: Set<string>): number {
  let score = 0;
  for (const t of queryTokens) {
    if (!candidateHasToken(candidateTokens, t)) continue;
    if (GENERIC_TOKENS.has(t)) score += 1;
    else if (isDisplacementToken(t)) score += 2;
    else score += 3;
  }
  // Prefer candidates that share the listing displacement when FIPE has it.
  const queryDisp = [...queryTokens].filter(isDisplacementToken);
  if (queryDisp.length > 0) {
    const hit = queryDisp.some((d) => candidateTokens.has(d));
    score += hit ? 4 : -4;
  }
  return score;
}

export interface SelectFipeModelOptions {
  transmission?: Car["transmission"];
}

interface RankedFipeModel {
  model: FipeModel;
  score: number;
}

/** Rank catalog rows; drop those missing required distinctive trim tokens. */
export function rankFipeModels(
  models: FipeModel[],
  model: string,
  trim: string,
  options: SelectFipeModelOptions = {},
): RankedFipeModel[] {
  const queryTokens = expandQueryTokens(
    new Set([...tokenize(`${model} ${trim}`), ...transmissionTokens(options.transmission)]),
  );
  const modelFamilyTokens = extractModelFamilyTokens(model);
  const catalogTokenSets = models.map((m) => tokenize(m.name));
  const familyIndexes = models
    .map((_, i) => i)
    .filter((i) =>
      modelFamilyTokens.length === 0
        ? true
        : modelFamilyTokens.some((t) => candidateHasFamilyToken(catalogTokenSets[i], t)),
    );
  const familyTokenSets = (familyIndexes.length > 0 ? familyIndexes : models.map((_, i) => i)).map(
    (i) => catalogTokenSets[i],
  );

  const distinctiveTokens = [...queryTokens].filter((t) => {
    if (!isDistinctiveToken(t)) return false;
    const catalogHas = familyTokenSets.some((set) => candidateHasToken(set, t));
    return !isIgnorableNoise(t, catalogHas);
  });

  const ranked: RankedFipeModel[] = [];
  for (let i = 0; i < models.length; i++) {
    const m = models[i];
    const tokens = catalogTokenSets[i];
    let score = tokenScore(queryTokens, tokens);
    // Anchor on the listing's model family so a shared body token ("hb")
    // cannot let CRUZE beat ONIX — and so "gol" cannot beat "golf".
    const familyHits = modelFamilyTokens.filter((t) => candidateHasFamilyToken(tokens, t)).length;
    if (familyHits === 0 && modelFamilyTokens.length > 0) score -= 10;
    else score += familyHits * 4;

    const missing = distinctiveTokens.filter((t) => !candidateHasToken(tokens, t));
    if (missing.length > 0) continue;
    if (score <= 0) continue;
    ranked.push({ model: m, score });
  }

  ranked.sort((a, b) => b.score - a.score);
  return ranked;
}

/** Pure model picker — exported for unit tests; used by findFipeValue. */
export function selectFipeModel(
  models: FipeModel[],
  model: string,
  trim: string,
  options: SelectFipeModelOptions = {},
): FipeModel {
  const ranked = rankFipeModels(models, model, trim, options);
  if (ranked.length === 0) {
    // Preserve the previous error shape for empty / trim-mismatch cases.
    const queryTokens = expandQueryTokens(
      new Set([...tokenize(`${model} ${trim}`), ...transmissionTokens(options.transmission)]),
    );
    const modelFamilyTokens = extractModelFamilyTokens(model);
    const catalogTokenSets = models.map((m) => tokenize(m.name));
    const familySets = catalogTokenSets.filter((set) =>
      modelFamilyTokens.length === 0
        ? true
        : modelFamilyTokens.some((t) => candidateHasFamilyToken(set, t)),
    );
    const noiseScope = familySets.length > 0 ? familySets : catalogTokenSets;
    const distinctiveTokens = [...queryTokens].filter((t) => {
      if (!isDistinctiveToken(t)) return false;
      const catalogHas = noiseScope.some((set) => candidateHasToken(set, t));
      return !isIgnorableNoise(t, catalogHas);
    });

    let best: FipeModel | undefined;
    let bestScore = -1;
    for (let i = 0; i < models.length; i++) {
      let score = tokenScore(queryTokens, catalogTokenSets[i]);
      const familyHits = modelFamilyTokens.filter((t) =>
        candidateHasFamilyToken(catalogTokenSets[i], t),
      ).length;
      if (familyHits === 0 && modelFamilyTokens.length > 0) score -= 10;
      if (score > bestScore) {
        bestScore = score;
        best = models[i];
      }
    }
    if (!best || bestScore <= 0) {
      throw new FipeError(`No FIPE model match for "${model} ${trim}".`);
    }
    const missing = distinctiveTokens.filter((t) => !candidateHasToken(tokenize(best.name), t));
    throw new FipeError(
      `Best FIPE match for "${model} ${trim}" ("${best.name}") is missing distinctive trim token(s): ${missing.join(", ")}. Refusing to auto-apply — resolve manually.`,
    );
  }
  return ranked[0].model;
}
