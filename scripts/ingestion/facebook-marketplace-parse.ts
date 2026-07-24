/**
 * Facebook Marketplace (RapidAPI) parse helpers — pure, fail-closed.
 * Remaps the API's swapped title/location fields, gates non-vehicles, and
 * builds WriteLeadInput for pre_repossession leads.
 */

import { detectDamageSignals } from "../../src/lib/filters/damageSignals";
import type { WriteLeadInput } from "./write-lead";
import {
  BRAND_ALIASES,
  inferBodyType,
  normalizeBrand,
  normalizeBrandModel,
  parseBrl,
  parseYearFromText,
} from "./lib/parse-common";
import { extractRepasseEconomics } from "./lib/repasse-economics";
import { computeRepasseUrgency } from "./lib/repasse-urgency";

export type FacebookApiListing = {
  listing_id?: string | null;
  title?: string | null;
  price?: string | null;
  location?: string | null;
  listing_url?: string | null;
  image_url?: string | null;
  seller_name?: string | null;
};

export type RemappedFacebookListing = {
  listingId: string;
  sourceUrl: string;
  priceRaw: string | null;
  description: string;
  imageUrl: string | null;
  sellerName: string | null;
  blob: string;
};

const NON_VEHICLE =
  /\b(apartamento|apto\b|kitnet|cobertura|casa\b|sobrado|terreno|im[oó]vel|aluguel|moto\b|motocicleta|scooter|iphone|notebook|playstation|camiseta|camisa|ralph\s*lauren|carta\s+contemplada|cons[oó]rcio|pedidos?\b)\b/i;

const FINANCING_SIGNAL =
  /repasse|financiad[oa]|financiamento|assum[oa]\s+(?:o\s+)?financiamento|assumir\s+(?:o\s+)?financiamento|passo\s+(?:o\s+)?financiamento|transfer[êe]r(?:\s+o)?\s+financiamento|quitar\s+e\s+transferir/i;

/** Known brands, longest first, for free-text identity extraction. */
const KNOWN_BRANDS = Object.keys(BRAND_ALIASES)
  .concat(Object.values(BRAND_ALIASES))
  .filter((v, i, a) => a.findIndex((x) => x.toLowerCase() === v.toLowerCase()) === i)
  .sort((a, b) => b.length - a.length);

const MODEL_TO_BRAND: Record<string, string> = {
  GOL: "Volkswagen",
  POLO: "Volkswagen",
  FOX: "Volkswagen",
  VOYAGE: "Volkswagen",
  VIRTUS: "Volkswagen",
  JETTA: "Volkswagen",
  TIGUAN: "Volkswagen",
  TAOS: "Volkswagen",
  NIVUS: "Volkswagen",
  SAVEIRO: "Volkswagen",
  AMAROK: "Volkswagen",
  ONIX: "Chevrolet",
  PRISMA: "Chevrolet",
  CRUZE: "Chevrolet",
  TRACKER: "Chevrolet",
  SPIN: "Chevrolet",
  S10: "Chevrolet",
  UNO: "Fiat",
  PALIO: "Fiat",
  STRADA: "Fiat",
  TORO: "Fiat",
  ARGO: "Fiat",
  CRONOS: "Fiat",
  MOBI: "Fiat",
  PULSE: "Fiat",
  FASTBACK: "Fiat",
  FIESTA: "Ford",
  KA: "Ford",
  ECOSPORT: "Ford",
  RANGER: "Ford",
  FOCUS: "Ford",
  HB20: "Hyundai",
  CRETA: "Hyundai",
  TUCSON: "Hyundai",
  CIVIC: "Honda",
  CITY: "Honda",
  FIT: "Honda",
  HRV: "Honda",
  "HR-V": "Honda",
  COROLLA: "Toyota",
  HILUX: "Toyota",
  YARIS: "Toyota",
  ETIOS: "Toyota",
  SANDERO: "Renault",
  LOGAN: "Renault",
  DUSTER: "Renault",
  KWID: "Renault",
  KICKS: "Nissan",
  VERSA: "Nissan",
  COMPASS: "Jeep",
  RENEGADE: "Jeep",
  "T-CROSS": "Volkswagen",
  TCROSS: "Volkswagen",
  SONG: "BYD",
  YUAN: "BYD",
  DOLPHIN: "BYD",
  SEAL: "BYD",
};

/** Prefer compound model matches before generic token scrape. */
const COMPOUND_MODELS: Array<{ re: RegExp; brand: string; model: string }> = [
  { re: /\bBYD\s+SONG\s+PLUS\b/i, brand: "BYD", model: "Song Plus" },
  { re: /\bSONG\s+PLUS\b/i, brand: "BYD", model: "Song Plus" },
  { re: /\bBYD\s+SONG\b/i, brand: "BYD", model: "Song" },
  { re: /\bSONG\b/i, brand: "BYD", model: "Song" },
  { re: /\bBYD\s+YUAN\b/i, brand: "BYD", model: "Yuan" },
  { re: /\bBYD\s+DOLPHIN\b/i, brand: "BYD", model: "Dolphin" },
  { re: /\bT[-\s]?CROSS\b/i, brand: "Volkswagen", model: "T-Cross" },
  { re: /\bHR[-\s]?V\b/i, brand: "Honda", model: "HR-V" },
  { re: /\bCR[-\s]?V\b/i, brand: "Honda", model: "CR-V" },
  { re: /\bCOROLLA\s+CROSS\b/i, brand: "Toyota", model: "Corolla Cross" },
];

const JUNK_MODEL_TOKEN =
  /^(financiamento|financiado|financiada|financia|repasse|promiss[oó]ria|assumir|assumo|passo|para|com|sem|entrada|quitado|🚨|✅|❌)$/i;

const KNOWN_SUV =
  /\b(song|yuan|dolphin|seal|t[-\s]?cross|hr[-\s]?v|cr[-\s]?v|creta|nivus|pulse|fastback|kicks|tracker|compass|renegade|taos|tiguan)\b/i;

const BADGE_ONLY = /^(acabou de ser anunciado|just listed|gratuito|free)$/i;

export function hasFinancingSignal(text: string): boolean {
  return FINANCING_SIGNAL.test(text);
}

export function isNonVehicle(text: string): boolean {
  return NON_VEHICLE.test(text);
}

/** Remap RapidAPI's swapped title/location; reject US$ / missing URL. */
export function remapFacebookListing(raw: FacebookApiListing): RemappedFacebookListing | null {
  const sourceUrl = (raw.listing_url ?? "").trim();
  if (!/^https?:\/\/(www\.)?facebook\.com\//i.test(sourceUrl)) return null;

  const listingId =
    (raw.listing_id ?? "").trim() ||
    sourceUrl.match(/\/marketplace\/item\/(\d+)/i)?.[1] ||
    "";
  if (!listingId) return null;

  const title = (raw.title ?? "").trim();
  const loc = (raw.location ?? "").trim();
  const apiPrice = (raw.price ?? "").trim();

  // Price usually lives in `title`; sometimes in `location` when title is a badge.
  let priceRaw: string | null = null;
  let description = "";

  if (/^R\$/i.test(title) || /^US\$/i.test(title) || title.startsWith("$")) {
    priceRaw = title;
    description = loc;
  } else if (BADGE_ONLY.test(title) && (/^R\$/i.test(loc) || parseBrl(loc))) {
    priceRaw = loc.match(/R\$\s*[\d.,]+/i)?.[0] ?? loc;
    description = loc;
  } else if (apiPrice) {
    priceRaw = apiPrice;
    description = [title, loc].filter(Boolean).join(" ");
  } else {
    // Last resort: hunt R$ in either field
    const fromTitle = title.match(/R\$\s*[\d.,]+/i)?.[0];
    const fromLoc = loc.match(/R\$\s*[\d.,]+/i)?.[0];
    priceRaw = fromTitle ?? fromLoc ?? null;
    description = [title, loc].filter(Boolean).join(" ");
  }

  if (priceRaw && (/^US\$/i.test(priceRaw) || /^\$/.test(priceRaw.trim()))) {
    return null;
  }

  const blob = [title, loc, apiPrice, raw.seller_name].filter(Boolean).join("\n");
  return {
    listingId,
    sourceUrl,
    priceRaw,
    description,
    imageUrl: raw.image_url?.trim() || null,
    sellerName: raw.seller_name?.trim() || null,
    blob,
  };
}

function scrubModelTokens(tokens: string[]): string[] {
  const out: string[] = [];
  for (const t of tokens) {
    if (!t || /^\d{4}$/.test(t) || /^\d+\/\d+$/.test(t)) continue;
    if (JUNK_MODEL_TOKEN.test(t)) break;
    if (/^[\d.,]+$/.test(t)) break; // engine size / price fragment
    out.push(t.replace(/[,.]+$/g, ""));
    if (out.length >= 3) break;
  }
  return out.filter(Boolean);
}

export function extractBrandModel(description: string): { brand: string; model: string } | null {
  const cleaned = description
    .replace(/\bREPASSE\b/gi, " ")
    .replace(/[🚨✅❌]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;

  for (const hit of COMPOUND_MODELS) {
    if (hit.re.test(cleaned)) {
      return normalizeBrandModel(hit.brand, hit.model);
    }
  }

  for (const brandRaw of KNOWN_BRANDS) {
    const re = new RegExp(
      `\\b${brandRaw.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}\\b`,
      "i",
    );
    const m = cleaned.match(re);
    if (!m || m.index === undefined) continue;
    const after = cleaned.slice(m.index + m[0].length).trim();
    const modelTokens = scrubModelTokens(after.split(/\s+/));
    if (modelTokens.length === 0) continue;
    const modelRaw = modelTokens.join(" ").trim();
    if (modelRaw.length < 2) continue;
    return normalizeBrandModel(normalizeBrand(brandRaw), modelRaw);
  }

  // Model→brand fallback (e.g. "2019 Onix …")
  const tokens = cleaned.split(/\s+/);
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i]!;
    const key = tok.replace(/[^a-zA-Z0-9-]/g, "").toUpperCase();
    if (!key || key.length < 2) continue;
    const brand = MODEL_TO_BRAND[key];
    if (!brand) continue;
    const modelTokens = scrubModelTokens(tokens.slice(i));
    if (modelTokens.length === 0) continue;
    return normalizeBrandModel(brand, modelTokens.join(" "));
  }

  return null;
}

function resolveBodyType(brand: string, model: string, blob: string) {
  return (
    inferBodyType(brand, model, blob) ??
    (KNOWN_SUV.test(`${brand} ${model} ${blob}`) ? ("suv" as const) : null)
  );
}

/** Reject year-glued / nonsense prices (e.g. 20192019). */
export function isPlausibleAskBRL(n: number, year?: number): boolean {
  if (!Number.isFinite(n) || n < 3_000 || n > 800_000) return false;
  if (year && n >= 1980 && n <= 2030) return false;
  if (n >= 19000000 && n <= 20999999) return false;
  return true;
}

export type FacebookToWriteLeadResult =
  | { input: WriteLeadInput; skipReason?: undefined }
  | { input?: undefined; skipReason: string };

export function facebookToWriteLead(
  raw: FacebookApiListing,
  options?: { allowMarketFallback?: boolean },
): FacebookToWriteLeadResult {
  const remapped = remapFacebookListing(raw);
  if (!remapped) return { skipReason: "remap_failed" };

  if (isNonVehicle(remapped.blob)) return { skipReason: "non_vehicle" };

  const financing = hasFinancingSignal(remapped.blob);
  if (!financing && !options?.allowMarketFallback) {
    return { skipReason: "no_financing_signal" };
  }

  const damage = detectDamageSignals(remapped.blob);
  if (damage.blocked) return { skipReason: "damage_signals" };

  const years = parseYearFromText(remapped.description) ?? parseYearFromText(remapped.blob);
  if (!years) return { skipReason: "missing_year" };

  const identity = extractBrandModel(remapped.description) ?? extractBrandModel(remapped.blob);
  if (!identity) return { skipReason: "missing_brand_model" };

  const { brand, model } = identity;
  const bodyType = resolveBodyType(brand, model, remapped.blob);
  if (!bodyType) return { skipReason: "no_body_type" };

  const listedPrice = remapped.priceRaw ? parseBrl(remapped.priceRaw) : null;
  if (listedPrice !== null && !isPlausibleAskBRL(listedPrice, years.year)) {
    return { skipReason: "implausible_price" };
  }

  const notesBase = [
    remapped.description.slice(0, 240),
    "Fonte: Facebook Marketplace via RapidAPI (confidence low).",
  ];

  if (financing) {
    const economics = extractRepasseEconomics(remapped.blob);
    const entryAskBRL = economics.entryAskBRL ?? listedPrice;
    if (entryAskBRL === null || !isPlausibleAskBRL(entryAskBRL, years.year)) {
      return { skipReason: "no_entry_price" };
    }
    const urgency = computeRepasseUrgency({ adText: remapped.blob });
    return {
      input: {
        brand,
        model,
        year: years.year,
        modelYear: years.modelYear,
        dealPhase: "pre_repossession",
        sellerType: "repasse",
        bodyType,
        entryAskBRL,
        outstandingDebtBRL: economics.outstandingDebtBRL,
        installmentBRL: economics.installmentBRL,
        installmentsRemaining: economics.installmentsRemaining,
        sellerContact: economics.sellerContact,
        repasseUrgency: urgency,
        photos: remapped.imageUrl ? [remapped.imageUrl] : undefined,
        sourceUrl: remapped.sourceUrl,
        sourcePlatform: "Facebook Marketplace",
        sourceChannel: "classifieds",
        confidence: "low",
        notes: [
          ...notesBase,
          economics.entryAskBRL === null
            ? "entrada = preço anunciado no Facebook (não declarada no texto)."
            : null,
        ]
          .filter((n): n is string => Boolean(n))
          .join(" "),
      },
    };
  }

  // Market fallback for model-targeted discovery (no financing text).
  if (listedPrice === null || !isPlausibleAskBRL(listedPrice, years.year)) {
    return { skipReason: "no_asking_price" };
  }
  return {
    input: {
      brand,
      model,
      year: years.year,
      modelYear: years.modelYear,
      dealPhase: "market",
      sellerType: "owner",
      bodyType,
      askingPriceBRL: listedPrice,
      photos: remapped.imageUrl ? [remapped.imageUrl] : undefined,
      sourceUrl: remapped.sourceUrl,
      sourcePlatform: "Facebook Marketplace",
      sourceChannel: "classifieds",
      confidence: "low",
      notes: [...notesBase, "market fallback (sem sinal de financiamento no texto)."].join(" "),
    },
  };
}
