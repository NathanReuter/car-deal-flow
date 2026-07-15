import { detectDamageSignals } from "../../src/lib/filters/damageSignals";
import type { BodyType } from "../../src/lib/types";
import { inferBodyType, parseBrl, parseKm, parseYearFromText } from "./lib/parse-common";
import type { WriteLeadInput } from "./write-lead";

export type SantanderParsed = {
  id: string;
  url: string;
  brand: string;
  model: string;
  year: number;
  price: number;
  bodyType: BodyType;
  mileageKm: number | null;
  city?: string;
  state?: string;
  notes: string;
  skipReason?: string;
};

function stripTags(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitBrandModel(text: string): { brand: string; model: string } | null {
  const parts = text.split(/\s*-\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length >= 2) return { brand: parts[0], model: parts.slice(1).join(" - ") };
  const words = text.trim().split(/\s+/);
  if (words.length >= 2) return { brand: words[0], model: words.slice(1).join(" ") };
  return null;
}

export function parseSantanderLot(id: string, url: string, html: string): SantanderParsed {
  const text = stripTags(html);
  const title =
    html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1] ??
    html.match(/<title>([^<]+)<\/title>/i)?.[1] ??
    "";

  const damage = detectDamageSignals(`${title}\n${text.slice(0, 4000)}`);
  if (damage.blocked) {
    return emptySkip(id, url, `damage: ${damage.reasons.join(", ")}`);
  }

  const vehicleLine =
    text.match(/(?:Marca|Modelo|Ve[ií]culo)\s*[:\-]\s*([^\n|]{5,120})/i)?.[1] ??
    title;
  const brandModel = splitBrandModel(vehicleLine.replace(/\s*\|\s*Santander.*$/i, "").trim());
  if (!brandModel) return emptySkip(id, url, "missing brand/model");

  const yearRaw =
    text.match(/Ano(?:\/Modelo)?\s*[:\-]\s*([0-9]{4}(?:\s*\/\s*[0-9]{4})?)/i)?.[1] ??
    title;
  const years = parseYearFromText(yearRaw);
  if (!years?.year) return emptySkip(id, url, "missing year");

  const priceRaw =
    text.match(/(?:Valor|Pre[cç]o|Lance)\s*[:\-]\s*(R\$\s*[\d.,]+)/i)?.[1] ??
    text.match(/R\$\s*[\d.]+,\d{2}/)?.[0];
  const price = priceRaw ? parseBrl(priceRaw) : null;
  if (!price) return emptySkip(id, url, "missing price");

  const kmRaw = text.match(/(?:KM|Quilometragem)\s*[:\-]\s*([\d.]+)/i)?.[1];
  const mileageKm = kmRaw ? parseKm(kmRaw) : null;

  const bodyType = inferBodyType(brandModel.brand, brandModel.model, text);
  if (!bodyType) return emptySkip(id, url, "ambiguous bodyType");

  const loc = text.match(/([A-Za-zÀ-ú\s]{2,40}),\s*([A-Z]{2})\b/);
  const notes = ["Retomado Santander", title.slice(0, 120)].filter(Boolean).join(" | ");

  return {
    id,
    url,
    brand: brandModel.brand,
    model: brandModel.model,
    year: years.year,
    price,
    bodyType,
    mileageKm,
    city: loc?.[1]?.trim(),
    state: loc?.[2],
    notes,
  };
}

function emptySkip(id: string, url: string, skipReason: string): SantanderParsed {
  return {
    id,
    url,
    brand: "",
    model: "",
    year: 0,
    price: 0,
    bodyType: "hatch",
    mileageKm: null,
    notes: "",
    skipReason,
  };
}

export function santanderToWriteLead(parsed: SantanderParsed): WriteLeadInput | null {
  if (parsed.skipReason) return null;
  const input: WriteLeadInput = {
    brand: parsed.brand,
    model: parsed.model,
    year: parsed.year,
    askingPriceBRL: parsed.price,
    sourceUrl: parsed.url,
    sourcePlatform: "Santander Retomados",
    sellerType: "bank_recovery",
    bodyType: parsed.bodyType,
    mileageKm: parsed.mileageKm,
    notes: parsed.notes,
  };
  if (parsed.city) input.city = parsed.city;
  if (parsed.state) input.state = parsed.state;
  return input;
}
