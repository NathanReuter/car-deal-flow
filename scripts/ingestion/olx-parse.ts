// Parses OLX ad detail HTML into a WriteLeadInput for pre-repossession leads.
// All data comes from the ad's embedded <script id="initial-data"> JSON —
// deterministic, no DOM scraping. Fail-closed: missing identity fields or no
// financing-transfer signal → skip with a reason, never a guess.
//
// LGPD: the ad body (which may contain a phone) is never copied into notes;
// only the conservative contact extraction lands in sellerContact.

import type { FuelType, Transmission } from "../../src/lib/types";
import { detectDamageSignals } from "../../src/lib/filters/damageSignals";
import type { WriteLeadInput } from "./write-lead";
import { extractRepasseEconomics } from "./lib/repasse-economics";
import { computeRepasseUrgency } from "./lib/repasse-urgency";
import { inferBodyType, normalizeBrandModel, parseBrl, parseKm } from "./lib/parse-common";

export interface OlxAdDetail {
  listId: string;
  url: string;
  subject: string;
  body: string;
  priceValueBRL: number | null;
  listTime: string | null;
  brand: string | null;
  model: string | null;
  year: number | null;
  mileageKm: number | null;
  fuel: string | null;
  gearbox: string | null;
  color: string | null;
  municipality: string | null;
  uf: string | null;
  /** "Tipo de veículo" prop (Sedã, Hatch, SUV, …). */
  vehicleType: string | null;
  /** Structured financing facts from ad props; null = not stated. */
  financiado: boolean | null;
  quitado: boolean | null;
  deLeilao: boolean | null;
}

const FINANCING_SIGNAL =
  /repasse|assum[oa]\s+(?:o\s+)?financiamento|assumir\s+(?:o\s+)?financiamento|passo\s+(?:o\s+)?financiamento|transfer[êe]ncia\s+de\s+financiamento|quitar\s+e\s+transferir/i;

export function hasFinancingSignal(text: string): boolean {
  return FINANCING_SIGNAL.test(text);
}

function htmlUnescape(s: string): string {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

type InitialData = {
  ad?: {
    listId?: number | string;
    subject?: string;
    body?: string;
    priceValue?: string;
    origListTime?: number | string;
    listTime?: string;
    canonicalUrl?: string;
    friendlyUrl?: string;
    properties?: Array<{ name?: string; label?: string; value?: string }>;
    location?: { municipality?: string; uf?: string };
  };
};

export function parseOlxDetail(html: string): OlxAdDetail | null {
  const m = html.match(/<script[^>]*id="initial-data"[^>]*data-json="([^"]*)"/);
  if (!m) return null;

  let data: InitialData;
  try {
    data = JSON.parse(htmlUnescape(m[1])) as InitialData;
  } catch {
    return null;
  }
  const ad = data.ad;
  if (!ad?.listId || !ad.subject) return null;

  const prop = (label: string): string | null => {
    const hit = ad.properties?.find((p) => p.label === label || p.name === label);
    return hit?.value ?? null;
  };

  const rawListTime =
    typeof ad.listTime === "string"
      ? ad.listTime
      : typeof ad.origListTime === "number"
        ? new Date(ad.origListTime * (ad.origListTime < 10_000_000_000 ? 1000 : 1)).toISOString()
        : typeof ad.origListTime === "string"
          ? ad.origListTime
          : null;

  const bool = (label: string): boolean | null => {
    const v = prop(label);
    if (v === "Sim") return true;
    if (v === "Não") return false;
    return null;
  };

  const yearRaw = prop("Ano");
  const year = yearRaw && /^\d{4}$/.test(yearRaw) ? Number(yearRaw) : null;

  return {
    listId: String(ad.listId),
    // friendlyUrl is the ad's own URL; canonicalUrl is a shared category page.
    url: ad.friendlyUrl || "",
    subject: ad.subject,
    body: ad.body ?? "",
    priceValueBRL: parseBrl(ad.priceValue),
    listTime: rawListTime,
    brand: prop("Marca"),
    model: prop("Modelo"),
    year,
    mileageKm: parseKm(prop("Quilometragem")),
    fuel: prop("Combustível"),
    gearbox: prop("Câmbio"),
    color: prop("Cor"),
    municipality: ad.location?.municipality ?? null,
    uf: ad.location?.uf ?? null,
    vehicleType: prop("Tipo de veículo"),
    financiado: bool("Financiado"),
    quitado: bool("Quitado"),
    deLeilao: bool("De leilão"),
  };
}

const FUEL_MAP: Record<string, FuelType> = {
  flex: "flex",
  gasolina: "gasoline",
  diesel: "diesel",
  "híbrido": "hybrid",
  hibrido: "hybrid",
  "elétrico": "electric",
  eletrico: "electric",
};

const GEARBOX_MAP: Record<string, Transmission> = {
  manual: "manual",
  "automático": "automatic",
  automatico: "automatic",
  cvt: "cvt",
  "semi-automático": "automated_manual",
  "semi-automatico": "automated_manual",
  automatizado: "automated_manual",
};

export interface OlxToWriteLeadResult {
  input?: WriteLeadInput;
  skipReason?: string;
}

/** OLX "Tipo de veículo" → domain BodyType. */
const VEHICLE_TYPE_MAP: Record<string, WriteLeadInput["bodyType"]> = {
  "sedã": "sedan",
  seda: "sedan",
  sedan: "sedan",
  hatch: "hatch",
  hatchback: "hatch",
  suv: "suv",
  picape: "pickup",
  "pick-up": "pickup",
  van: "minivan",
  minivan: "minivan",
  "cupê": "coupe",
  cupe: "coupe",
  conversível: "coupe",
  perua: "wagon",
  wagon: "wagon",
};

export function olxToWriteLead(ad: OlxAdDetail): OlxToWriteLeadResult {
  const blob = `${ad.subject}\n${ad.body}`;

  if (!hasFinancingSignal(blob)) return { skipReason: "no_financing_signal" };
  // Structured props beat free text: a paid-off car cannot be a financing
  // transfer — kills dealer "preço de repasse" false positives.
  if (ad.quitado === true || ad.financiado === false) return { skipReason: "not_financed" };

  const damage = detectDamageSignals(blob);
  if (damage.blocked) return { skipReason: "damage_signals" };

  if (!ad.brand || !ad.model || !ad.year) return { skipReason: "missing_identity_fields" };
  if (!ad.url) return { skipReason: "missing_url" };

  // OLX "Modelo" repeats the brand ("Chevrolet Plus LT 1.0..."); strip it.
  const modelRaw = ad.model.replace(new RegExp(`^${ad.brand}\\s+`, "i"), "").trim();
  const { brand, model } = normalizeBrandModel(ad.brand, modelRaw);

  const bodyType =
    (ad.vehicleType ? VEHICLE_TYPE_MAP[ad.vehicleType.toLowerCase()] : undefined) ??
    inferBodyType(brand, model, blob);
  if (!bodyType) return { skipReason: "no_body_type" };

  const economics = extractRepasseEconomics(ad.body);
  // The listed price on a repasse ad is the seller's transfer ask (probe doc §3).
  const entryAskBRL = economics.entryAskBRL ?? ad.priceValueBRL;
  if (entryAskBRL === null) return { skipReason: "no_entry_price" };

  const urgency = computeRepasseUrgency({ adText: blob });

  const notes = [
    ad.subject,
    economics.entryAskBRL === null
      ? "entrada = preço anunciado no OLX (não declarada no texto)."
      : null,
    ad.financiado === true ? "OLX props: veículo financiado (confirmado pelo anúncio)." : null,
    ad.deLeilao === true ? "OLX props: veículo de leilão — checar histórico." : null,
    ad.listTime ? `Anúncio publicado em ${ad.listTime.slice(0, 10)}.` : null,
  ]
    .filter((n): n is string => Boolean(n))
    .join(" ");

  return {
    input: {
      brand,
      model,
      year: ad.year,
      dealPhase: "pre_repossession",
      sellerType: "repasse",
      bodyType,
      entryAskBRL,
      outstandingDebtBRL: economics.outstandingDebtBRL,
      installmentBRL: economics.installmentBRL,
      installmentsRemaining: economics.installmentsRemaining,
      sellerContact: economics.sellerContact,
      repasseUrgency: urgency,
      mileageKm: ad.mileageKm,
      city: ad.municipality ?? undefined,
      state: ad.uf ?? undefined,
      fuel: ad.fuel ? FUEL_MAP[ad.fuel.toLowerCase()] : undefined,
      transmission: ad.gearbox ? GEARBOX_MAP[ad.gearbox.toLowerCase()] : undefined,
      color: ad.color ?? undefined,
      sourceUrl: ad.url,
      sourcePlatform: "OLX",
      sourceChannel: "classifieds",
      notes,
    },
  };
}
