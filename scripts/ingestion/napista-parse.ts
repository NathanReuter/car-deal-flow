// Parses NaPista search-result offer cards (from __NEXT_DATA__ JSON) into
// WriteLeadInput. Data is dealer below-FIPE stock → dealPhase "market",
// sellerType "dealer", sourceChannel "aggregator", confidence "high".
// Fail-closed: missing brand / model / year / price → null. No network.

import { detectDamageSignals } from "../../src/lib/filters/damageSignals";
import { guessBodyTypeByModel, inferBodyType, normalizeBrandModel } from "./lib/parse-common";
import type { WriteLeadInput } from "./write-lead";

/** Shape of a single offer object inside __NEXT_DATA__ searchResult.offers[]. */
export interface NapistaCard {
  id: string;
  makeName: string;
  modelName: string;
  modelYear: number;
  manufacturedYear?: number;
  price: number;
  mileage?: number;
  location?: {
    city?: string;
    state?: string;
    uf?: string;
  };
  versionName?: string;
  createdDate?: string;
}

export interface NapistaParsed {
  brand: string;
  model: string;
  year: number;
  askingPriceBRL: number;
  mileageKm: number | null;
  city: string | undefined;
  state: string | undefined;
  versionName: string | undefined;
}

export interface NapistaToWriteLeadResult {
  input?: WriteLeadInput;
  skipReason?: string;
}

/**
 * Parse a NaPista card object into structured fields.
 * Returns null (fail-closed) if any identity or price field is missing.
 */
export function parseNapistaCard(card: NapistaCard): NapistaParsed | null {
  const makeRaw = card.makeName?.trim();
  const modelRaw = card.modelName?.trim();
  const year = card.modelYear;
  const price = card.price;

  if (!makeRaw || !modelRaw || !year || !price) return null;

  // NaPista modelName is often ALL_CAPS; normalise through normalizeBrandModel.
  const { brand, model } = normalizeBrandModel(makeRaw, modelRaw);

  return {
    brand,
    model,
    year,
    askingPriceBRL: price,
    mileageKm: card.mileage ?? null,
    city: card.location?.city ?? undefined,
    state: card.location?.uf ?? undefined,
    versionName: card.versionName?.trim() || undefined,
  };
}

/**
 * Convert a parsed NaPista card into a WriteLeadInput.
 * Skips if bodyType cannot be inferred or damage signals are present.
 */
export function napistaToWriteLead(
  parsed: NapistaParsed,
  cardId: string,
): NapistaToWriteLeadResult {
  const blob = [parsed.brand, parsed.model, parsed.versionName].filter(Boolean).join(" ");

  const damage = detectDamageSignals(blob);
  if (damage.blocked) return { skipReason: "damage_signals" };

  // NaPista model names are structured (e.g. "DISCOVERY SPORT", "ONIX", "HILUX").
  // guessBodyTypeByModel covers this richer all-caps vocabulary; inferBodyType
  // is the text-blob fallback that may catch additional signals from versionName.
  const bodyType =
    guessBodyTypeByModel(`${parsed.brand} ${parsed.model}`) ??
    inferBodyType(parsed.brand, parsed.model, blob);
  if (!bodyType) return { skipReason: "no_body_type" };

  const sourceUrl = `https://napista.com.br/anuncios/${cardId}`;

  const input: WriteLeadInput = {
    brand: parsed.brand,
    model: parsed.model,
    year: parsed.year,
    askingPriceBRL: parsed.askingPriceBRL,
    dealPhase: "market",
    sellerType: "dealer",
    sourceChannel: "aggregator",
    confidence: "high",
    sourcePlatform: "NaPista",
    sourceUrl,
    bodyType,
    mileageKm: parsed.mileageKm,
    city: parsed.city,
    state: parsed.state,
  };

  return { input };
}
