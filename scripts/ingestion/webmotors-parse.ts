// Parses a Webmotors JSON API search result into a WriteLeadInput for
// pre-repossession leads. Deterministic, no network. Fail-closed: missing
// identity fields or no financing-transfer signal → skip with a reason.
//
// LGPD: the ad body (which may contain a phone) is never copied into notes;
// only the conservative contact extraction lands in sellerContact.

import type { Transmission } from "../../src/lib/types";
import { detectDamageSignals } from "../../src/lib/filters/damageSignals";
import type { WriteLeadInput } from "./write-lead";
import { extractRepasseEconomics } from "./lib/repasse-economics";
import { computeRepasseUrgency } from "./lib/repasse-urgency";
import {
  guessBodyTypeByModel,
  inferBodyType,
  normalizeBrandModel,
} from "./lib/parse-common";

// ─── Helpers ────────────────────────────────────────────────────────────────

/** Webmotors serves model names in ALL-CAPS. Convert to Title Case. */
function titleCaseModel(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

// ─── Webmotors API types ────────────────────────────────────────────────────

export interface WebmotorsSearchResult {
  UniqueId: number | string;
  Specification: {
    Title?: string;
    Make?: { id?: number; Value?: string };
    Model?: { id?: number; Value?: string };
    Version?: { id?: number; Value?: string };
    YearFabrication?: string;
    YearModel?: number;
    Odometer?: number;
    Transmission?: string;
    BodyType?: string;
    Color?: { Primary?: string };
    VehicleAttributes?: Array<{ Name?: string }>;
  };
  Seller: {
    Id?: number;
    SellerType?: string;
    City?: string;
    State?: string;
    AdType?: { Value?: string };
    Localization?: Array<{
      State?: string;
      City?: string;
      Country?: string;
      ZipCode?: string;
      AbbrState?: string;
    }>;
  };
  Prices: {
    Price?: number;
    SearchPrice?: number;
  };
  Media?: {
    Photos?: Array<{ PhotoPath?: string; Order?: number }>;
  };
  PhotoPath?: string;
  LongComment?: string;
  Channels?: Array<{ id?: number; Value?: string }>;
  FipePercent?: number;
  GoodDeal?: boolean;
  ListingType?: string;
  ProductCode?: string;
}

// ─── Photo URL helpers ──────────────────────────────────────────────────────

const WM_IMAGE_BASE = "https://imgwm.webmotors.com.br/wmphotos/";

function photoUrl(rawPath: string): string {
  // Webmotors paths use backslashes; normalise to forward-slashes.
  return WM_IMAGE_BASE + rawPath.replace(/\\/g, "/");
}

// ─── Financing-signal gate ──────────────────────────────────────────────────

const FINANCING_SIGNAL =
  /repasse|assum[oa]\s+(?:o\s+)?financiamento|assumir\s+(?:o\s+)?financiamento|passo\s+(?:o\s+)?financiamento|transfer[êe]ncia\s+de\s+financiamento|quitar\s+e\s+transferir/i;

export function hasFinancingSignal(text: string): boolean {
  return FINANCING_SIGNAL.test(text);
}

// ─── Transmission map ───────────────────────────────────────────────────────

const TRANSMISSION_MAP: Record<string, Transmission> = {
  manual: "manual",
  "automática": "automatic",
  automatica: "automatic",
  automático: "automatic",
  automatico: "automatic",
  cvt: "cvt",
  "semi-automática": "automated_manual",
  "semi-automatica": "automated_manual",
  "semi-automático": "automated_manual",
  "semi-automatico": "automated_manual",
  automatizado: "automated_manual",
};

// ─── Parsed intermediate ────────────────────────────────────────────────────

export interface WebmotorsParsed {
  uniqueId: string;
  brand: string;
  model: string;
  version: string | null;
  year: number;
  mileageKm: number | null;
  priceBRL: number | null;
  city: string;
  state: string;
  transmission: string | null;
  photos: string[];
  sourceUrl: string;
  longComment: string;
  fipePercent: number | null;
}

export function parseWebmotorsResult(r: WebmotorsSearchResult): WebmotorsParsed {
  const loc = r.Seller.Localization?.[0];
  const city = loc?.City ?? r.Seller.City ?? "";
  const abbrState = loc?.AbbrState ?? extractAbbrState(r.Seller.State ?? "");

  const photos = (r.Media?.Photos ?? [])
    .sort((a, b) => (a.Order ?? 0) - (b.Order ?? 0))
    .map((p) => photoUrl(p.PhotoPath ?? ""))
    .filter((u) => u !== WM_IMAGE_BASE);

  const price =
    typeof r.Prices.Price === "number" && r.Prices.Price > 0 ? r.Prices.Price : null;

  const rawTx = r.Specification.Transmission;
  const transmission = rawTx ?? null;

  const uniqueId = String(r.UniqueId);

  return {
    uniqueId,
    brand: r.Specification.Make?.Value ?? "",
    model: r.Specification.Model?.Value ?? "",
    version: r.Specification.Version?.Value ?? null,
    year: r.Specification.YearModel ?? 0,
    mileageKm: typeof r.Specification.Odometer === "number" ? r.Specification.Odometer : null,
    priceBRL: price,
    city,
    state: abbrState,
    transmission,
    photos,
    sourceUrl: `https://www.webmotors.com.br/carros/estoque?UniqueId=${uniqueId}`,
    longComment: r.LongComment ?? "",
    fipePercent: typeof r.FipePercent === "number" ? r.FipePercent : null,
  };
}

/** Extract two-letter state abbreviation from "Rio de Janeiro (RJ)" format. */
function extractAbbrState(raw: string): string {
  const m = raw.match(/\(([A-Z]{2})\)/);
  return m ? m[1] : raw;
}

// ─── Main conversion ─────────────────────────────────────────────────────────

export interface WebmotorsToWriteLeadResult {
  input?: WriteLeadInput;
  skipReason?: string;
}

export function webmotorsToWriteLead(r: WebmotorsSearchResult): WebmotorsToWriteLeadResult {
  const parsed = parseWebmotorsResult(r);
  const blob = `${parsed.brand} ${parsed.model} ${parsed.version ?? ""}\n${parsed.longComment}`;

  // Per-record PF seller gate: skip any result whose SellerType is present and
  // not "PF" (e.g. "PJ" = dealer). The tipovendedor=PF query param is the primary
  // filter, but this per-result check makes the PF intent explicit and verifiable.
  if (r.Seller.SellerType && r.Seller.SellerType !== "PF") {
    return { skipReason: "not_pf" };
  }

  // Fail-closed financing-signal gate.
  if (!hasFinancingSignal(blob)) return { skipReason: "no_financing_signal" };

  // Damage gate.
  const damage = detectDamageSignals(blob);
  if (damage.blocked) return { skipReason: "damage_signals" };

  // Identity guard.
  if (!parsed.brand || !parsed.model || !parsed.year) {
    return { skipReason: "missing_identity_fields" };
  }

  const { brand, model: modelRaw } = normalizeBrandModel(parsed.brand, parsed.model);
  // Webmotors serves model names in all-caps; title-case them for display.
  const model = titleCaseModel(modelRaw);

  // Body type: try guessBodyTypeByModel first (structural), then fall back to
  // inferBodyType (regex over full text blob).
  const bodyType =
    guessBodyTypeByModel(model) ?? guessBodyTypeByModel(parsed.version ?? "") ?? inferBodyType(brand, model, blob);
  if (!bodyType) return { skipReason: "no_body_type" };

  // Repasse economics.
  const economics = extractRepasseEconomics(parsed.longComment);
  // Fall back to the listed price as entryAskBRL ONLY when no saldo devedor was
  // disclosed. If debt IS disclosed but entrada was not stated, we cannot safely
  // reconstruct asking price (entry + debt would double-count the listed price).
  const entryAskBRL =
    economics.entryAskBRL ??
    (economics.outstandingDebtBRL === null ? parsed.priceBRL : null);
  if (entryAskBRL === null || entryAskBRL === 0) return { skipReason: "no_entry_price" };

  const urgency = computeRepasseUrgency({ adText: blob });

  const txRaw = parsed.transmission?.toLowerCase() ?? "";
  const transmission = TRANSMISSION_MAP[txRaw] ?? undefined;

  const notes = [
    parsed.version ? `Versão: ${parsed.version}.` : null,
    economics.entryAskBRL === null
      ? "entrada = preço anunciado na Webmotors (não declarada no texto)."
      : null,
    parsed.fipePercent !== null ? `FIPE: ${parsed.fipePercent}%.` : null,
  ]
    .filter((n): n is string => Boolean(n))
    .join(" ");

  return {
    input: {
      brand,
      model,
      year: parsed.year,
      dealPhase: "pre_repossession",
      sellerType: "repasse",
      sourceChannel: "classifieds",
      confidence: "medium",
      bodyType,
      entryAskBRL,
      outstandingDebtBRL: economics.outstandingDebtBRL,
      installmentBRL: economics.installmentBRL,
      installmentsRemaining: economics.installmentsRemaining,
      sellerContact: economics.sellerContact,
      repasseUrgency: urgency,
      mileageKm: parsed.mileageKm,
      city: parsed.city || undefined,
      state: parsed.state || undefined,
      transmission,
      color: r.Specification.Color?.Primary ?? undefined,
      photos: parsed.photos,
      sourceUrl: parsed.sourceUrl,
      sourcePlatform: "Webmotors",
      notes: notes || undefined,
    },
  };
}
