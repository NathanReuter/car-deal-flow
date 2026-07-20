/**
 * Storefront parse helpers — pure functions, no network, no FS.
 * Used by storefront-harvest.ts and the test suite.
 *
 * Supported sites:
 *   - Clube Repasse (HTML SSR, plain regex — no DOM library)
 *   - Compra Certa (JSON REST API response)
 */

import { normalizeBrand, parseYearFromText } from "./lib/parse-common";

// ---------------------------------------------------------------------------
// Clube Repasse — HTML
// ---------------------------------------------------------------------------

export interface ClubeRepasseCard {
  brand: string;
  model: string;
  year: number;
  askingPriceBRL: number;
  belowFipePct?: number;
  detailPath: string;
  /** Raw description paragraph (useful for mileage extraction if needed later). */
  description?: string;
}

/**
 * Parse all vehicle cards from a Clube Repasse listing page HTML.
 * Fails closed: any card missing brand/model/year/price is dropped.
 *
 * Structure anchors (from fixture):
 *   <div class="bg-white rounded-2xl border ..."> — card wrapper
 *     <a href="/detalhe/...">                     — detail link
 *     <span ...>15,45% abaixo FIPE</span>         — below-FIPE badge
 *     <h2 ... title="MODEL">MODEL</h2>            — model name
 *     <p ...>BRAND MODEL YEAR/MODELYEAR, ...</p>  — description
 *     <div class="text-2xl font-black ...">R$ XX XX,00</div> — price
 */
export function parseClubeRepasseCards(html: string): ClubeRepasseCard[] {
  // Split into card blocks by the card wrapper class
  // Each card starts at "bg-white rounded-2xl border"
  const cardSections = html.split(
    /(?=<div[^>]*class="[^"]*bg-white[^"]*rounded-2xl[^"]*border[^"]*")/,
  );

  const cards: ClubeRepasseCard[] = [];

  for (const section of cardSections) {
    // Must have the card wrapper to be a valid card
    if (!/<div[^>]*class="[^"]*bg-white[^"]*rounded-2xl[^"]*border[^"]*"/.test(section)) {
      continue;
    }

    // --- Detail path ---
    const detailMatch = section.match(/<a\s+href="(\/detalhe\/[^"]+)"/);
    if (!detailMatch) continue;
    const detailPath = detailMatch[1]!;

    // --- Below-FIPE badge ---
    let belowFipePct: number | undefined;
    const fipeBadgeMatch = section.match(
      /(\d{1,2}[.,]\d{1,2})%\s+abaixo\s+FIPE/i,
    );
    if (fipeBadgeMatch) {
      const pctStr = fipeBadgeMatch[1]!.replace(",", ".");
      const pct = parseFloat(pctStr);
      if (Number.isFinite(pct) && pct > 0) belowFipePct = pct;
    }

    // --- Price (text-2xl font-black) ---
    const priceBlockMatch = section.match(
      /<div[^>]*class="[^"]*text-2xl[^"]*font-black[^"]*"[^>]*>\s*(R\$\s*[\d\s.,]+)\s*<\/div>/,
    );
    if (!priceBlockMatch) continue;
    const priceRaw = priceBlockMatch[1]!;
    const askingPriceBRL = parseBrlStorefront(priceRaw);
    if (!askingPriceBRL) continue;

    // --- Model (h2 title attribute, fallback to text content) ---
    const h2TitleMatch = section.match(/<h2[^>]*\btitle="([^"]+)"/);
    const modelRaw = h2TitleMatch ? h2TitleMatch[1]!.trim() : "";

    // --- Description paragraph — extract brand + year ---
    const descMatch = section.match(
      /<p[^>]*class="[^"]*text-sm[^"]*text-gray-600[^"]*"[^>]*>([\s\S]*?)<\/p>/,
    );
    const desc = descMatch ? descMatch[1]!.replace(/<[^>]+>/g, "").trim() : "";

    // Extract year from description (prefer pair like 2011/2012)
    const yearResult = parseYearFromText(desc);
    if (!yearResult) continue;
    const year = yearResult.year;

    // Extract brand from description: first all-caps or title-case word(s)
    // Heuristic: description starts with "BRAND MODEL year/modelyear, ..."
    const brand = extractBrandFromDesc(desc, modelRaw);
    if (!brand) continue;

    // Model can come from h2 title; if empty fall back to stripping brand from desc
    const model = modelRaw || extractModelFromDesc(desc, brand);
    if (!model) continue;

    cards.push({
      brand,
      model,
      year,
      askingPriceBRL,
      belowFipePct,
      detailPath,
      description: desc,
    });
  }

  return cards;
}

/**
 * Parse a Brazilian "R$ XX XXX,00" or "R$ XX 500,00" style price string.
 * Handles non-breaking spaces (U+00A0) and regular spaces as thousands separators.
 */
function parseBrlStorefront(raw: string): number | null {
  // Strip leading "R$" and whitespace
  const cleaned = raw.replace(/R\$\s*/i, "").trim();

  // Handle format like "40 500,00" or "40.500,00" or "40500,00"
  // Space (incl. NBSP) and period are thousands separators; comma is decimal
  const withoutThousands = cleaned.replace(/[\s .]/g, "");
  // Now it's like "40500,00"
  const normalized = withoutThousands.replace(",", ".");
  const n = parseFloat(normalized);
  if (Number.isFinite(n) && n > 0) return Math.round(n);

  // Fallback: just grab digits
  const digits = cleaned.replace(/\D/g, "");
  if (!digits) return null;
  const fromDigits = Number(digits) / 100;
  return Number.isFinite(fromDigits) && fromDigits > 0 ? Math.round(fromDigits) : null;
}

/** Known brands ordered longest-first to avoid "Ford" shadowing "Ford EcoSport" etc. */
const KNOWN_BRANDS_ORDERED = [
  "Volkswagen",
  "Chevrolet",
  "Mercedes-Benz",
  "Land Rover",
  "Caoa Chery",
  "Toyota",
  "Ford",
  "Fiat",
  "Honda",
  "Hyundai",
  "Renault",
  "Nissan",
  "Jeep",
  "Peugeot",
  "Citroën",
  "BMW",
  "Audi",
  "Kia",
  "Mitsubishi",
  "Chery",
  "BYD",
  "Ram",
  "Volvo",
  "Mini",
  "VW",
  "GM",
];

/**
 * Well-known model→brand mappings for cases where the description does not
 * begin with the brand name (e.g. "EcoSport 2.0 2010/2011, automático...").
 */
const MODEL_TO_BRAND: Record<string, string> = {
  ECOSPORT: "Ford",
  FIESTA: "Ford",
  KA: "Ford",
  FOCUS: "Ford",
  COURIER: "Ford",
  FUSION: "Ford",
  RANGER: "Ford",
  MAVERICK: "Ford",
  MUSTANG: "Ford",
  BRONCO: "Ford",
  ONIX: "Chevrolet",
  CELTA: "Chevrolet",
  COBALT: "Chevrolet",
  PRISMA: "Chevrolet",
  CRUZE: "Chevrolet",
  TRACKER: "Chevrolet",
  EQUINOX: "Chevrolet",
  TRAILBLAZER: "Chevrolet",
  S10: "Chevrolet",
  SPIN: "Chevrolet",
  CLASSIC: "Chevrolet",
  AGILE: "Chevrolet",
  UNO: "Fiat",
  PALIO: "Fiat",
  SIENA: "Fiat",
  STRADA: "Fiat",
  TORO: "Fiat",
  PULSE: "Fiat",
  FASTBACK: "Fiat",
  ARGO: "Fiat",
  CRONOS: "Fiat",
  DOBLO: "Fiat",
  BRAVO: "Fiat",
  PUNTO: "Fiat",
  STILO: "Fiat",
  FIORINO: "Fiat",
  LINEA: "Fiat",
  MOBI: "Fiat",
  GOL: "Volkswagen",
  FOX: "Volkswagen",
  POLO: "Volkswagen",
  GOLF: "Volkswagen",
  VOYAGE: "Volkswagen",
  VIRTUS: "Volkswagen",
  JETTA: "Volkswagen",
  PASSAT: "Volkswagen",
  TIGUAN: "Volkswagen",
  TAOS: "Volkswagen",
  NIVUS: "Volkswagen",
  TCROSS: "Volkswagen",
  SAVEIRO: "Volkswagen",
  AMAROK: "Volkswagen",
  TOUAREG: "Volkswagen",
  SPACEFOX: "Volkswagen",
  PARATI: "Volkswagen",
  KOMBI: "Volkswagen",
  CIVIC: "Honda",
  CITY: "Honda",
  FIT: "Honda",
  "HR-V": "Honda",
  HRV: "Honda",
  "WR-V": "Honda",
  WRV: "Honda",
  "CR-V": "Honda",
  CRV: "Honda",
  ACCORD: "Honda",
  COROLLA: "Toyota",
  YARIS: "Toyota",
  ETIOS: "Toyota",
  HILUX: "Toyota",
  SW4: "Toyota",
  RAV4: "Toyota",
  "COROLLA CROSS": "Toyota",
  PRIUS: "Toyota",
  I30: "Hyundai",
  HB20: "Hyundai",
  CRETA: "Hyundai",
  TUCSON: "Hyundai",
  IX35: "Hyundai",
  ELANTRA: "Hyundai",
  AZERA: "Hyundai",
  KWID: "Renault",
  SANDERO: "Renault",
  LOGAN: "Renault",
  DUSTER: "Renault",
  CAPTUR: "Renault",
  OROCH: "Renault",
  KICKS: "Nissan",
  VERSA: "Nissan",
  FRONTIER: "Nissan",
  LIVINA: "Nissan",
  MARCH: "Nissan",
  SENTRA: "Nissan",
  RENEGADE: "Jeep",
  COMPASS: "Jeep",
  COMMANDER: "Jeep",
  WRANGLER: "Jeep",
  "208": "Peugeot",
  "2008": "Peugeot",
  "3008": "Peugeot",
  "5008": "Peugeot",
  "307": "Peugeot",
  "408": "Peugeot",
  "C3": "Citroën",
  "C4": "Citroën",
  "DS3": "Citroën",
  AIRCROSS: "Citroën",
  PICASSO: "Citroën",
  "A3": "Audi",
  "A4": "Audi",
  "A6": "Audi",
  "A5": "Audi",
  "Q3": "Audi",
  "Q5": "Audi",
  "Q7": "Audi",
  TT: "Audi",
  "A3 SEDAN": "Audi",
  SPORTAGE: "Kia",
  SORENTO: "Kia",
  CERATO: "Kia",
  PICANTO: "Kia",
  RIO: "Kia",
  SOUL: "Kia",
  STINGER: "Kia",
  "320I": "BMW",
  "328I": "BMW",
  "330I": "BMW",
  "520I": "BMW",
  "530I": "BMW",
  "X1": "BMW",
  "X3": "BMW",
  "X5": "BMW",
  X6: "BMW",
  L200: "Mitsubishi",
  OUTLANDER: "Mitsubishi",
  ASX: "Mitsubishi",
  ECLIPSE: "Mitsubishi",
  LANCER: "Mitsubishi",
  PAJERO: "Mitsubishi",
  "C180": "Mercedes-Benz",
  "C200": "Mercedes-Benz",
  "C250": "Mercedes-Benz",
  "E250": "Mercedes-Benz",
  "GLA": "Mercedes-Benz",
  "GLC": "Mercedes-Benz",
};

/**
 * Extract the brand from a description string like
 * "HYUNDAI I30 2011/2012, ar, câmbio automático..." or
 * "Audi A3 Sedan 1.4 TFSI, 2018, 158 mil km..."
 * Falls back to model-to-brand lookup when the brand is not in the description.
 */
function extractBrandFromDesc(desc: string, modelHint: string): string | null {
  if (!desc.trim()) return null;

  const descUpper = desc.toUpperCase();

  // 1. Try brand prefix match (description starts with known brand)
  for (const b of KNOWN_BRANDS_ORDERED) {
    if (descUpper.startsWith(b.toUpperCase())) {
      return normalizeBrand(b);
    }
  }

  // 2. Try normalizeBrand on the first word of the description
  const firstWord = desc.trim().split(/\s+/)[0] ?? "";
  const normalized = normalizeBrand(firstWord.toUpperCase());
  if (
    normalized !== firstWord.toUpperCase() &&
    normalized &&
    KNOWN_BRANDS_ORDERED.some((b) => b.toLowerCase() === normalized.toLowerCase())
  ) {
    return normalized;
  }

  // 3. Try model-to-brand lookup using modelHint (h2 title)
  const modelKey = modelHint.trim().toUpperCase();
  if (MODEL_TO_BRAND[modelKey]) return MODEL_TO_BRAND[modelKey]!;

  // 4. Try prefix of modelHint (e.g. "A3 Sedan" → "A3")
  const modelFirstToken = modelKey.split(/\s+/)[0] ?? "";
  if (MODEL_TO_BRAND[modelFirstToken]) return MODEL_TO_BRAND[modelFirstToken]!;

  // 5. Try model-to-brand lookup using desc's first token (when desc starts with model)
  if (MODEL_TO_BRAND[firstWord.toUpperCase()]) return MODEL_TO_BRAND[firstWord.toUpperCase()]!;

  // 6. Last resort: scan the first ~60 chars of description for a known brand
  const head = desc.slice(0, 60);
  for (const b of KNOWN_BRANDS_ORDERED) {
    const re = new RegExp(`\\b${b.replace(/[-\s]/g, "[-\\s]?")}\\b`, "i");
    if (re.test(head)) return normalizeBrand(b);
  }

  return null;
}

function extractModelFromDesc(desc: string, brand: string): string | null {
  // Strip brand from front of desc
  const escaped = brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const stripped = desc.replace(new RegExp(`^${escaped}\\s+`, "i"), "").trim();
  // Take first token(s) before a year or comma
  const m = stripped.match(/^([^,\n]+?)(?:\s+\d{4}|\s*,)/);
  if (m) return m[1]!.trim();
  return stripped.split(/[\s,]/)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Compra Certa — JSON API
// ---------------------------------------------------------------------------

export interface CompracertaItem {
  id: string;
  brand: string;
  model: string;
  year: number;
  mileageKm: number;
  askingPriceBRL: number;
  fipeBRL?: number;
  belowFipePct?: number;
  imageUrl?: string;
}

interface RawCompracertaVehicle {
  id?: unknown;
  marca?: unknown;
  modelo?: unknown;
  ano?: unknown;
  km?: unknown;
  fipe?: unknown;
  preco?: unknown;
  imagem_url?: unknown;
  status?: unknown;
}

/**
 * Parse the JSON response from /wp-json/repasse/v1/veiculos?limite=999.
 * Fails closed: items missing marca/modelo/ano/preco are skipped.
 * The fixture file contains HTML comments before the JSON body; strip them first.
 */
export function parseCompracertaItems(raw: string): CompracertaItem[] {
  // Strip HTML comments (fixture wrapper) and surrounding whitespace
  const cleaned = raw.replace(/<!--[\s\S]*?-->/g, "").trim();
  let data: unknown;
  try {
    data = JSON.parse(cleaned);
  } catch {
    return [];
  }

  if (!Array.isArray(data)) return [];

  const items: CompracertaItem[] = [];

  for (const entry of data as RawCompracertaVehicle[]) {
    const brand = typeof entry.marca === "string" ? normalizeBrand(entry.marca.trim()) : null;
    const model = typeof entry.modelo === "string" ? entry.modelo.trim() : null;
    const year = typeof entry.ano === "number" ? entry.ano : null;
    const preco = typeof entry.preco === "number" ? entry.preco : null;
    const km = typeof entry.km === "number" ? entry.km : 0;

    // Fail closed
    if (!brand || !model || !year || !preco) continue;
    if (year < 1980 || year > 2030) continue;
    if (preco <= 0) continue;

    const id = String(entry.id ?? "");
    const fipeBRL = typeof entry.fipe === "number" && entry.fipe > 0 ? entry.fipe : undefined;
    const belowFipePct =
      fipeBRL !== undefined ? (1 - preco / fipeBRL) * 100 : undefined;

    items.push({
      id,
      brand,
      model,
      year,
      mileageKm: km,
      askingPriceBRL: preco,
      fipeBRL,
      belowFipePct,
      imageUrl: typeof entry.imagem_url === "string" ? entry.imagem_url : undefined,
    });
  }

  return items;
}
