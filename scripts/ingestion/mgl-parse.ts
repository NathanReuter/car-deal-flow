import type { SellerType } from "../../src/lib/types";
import type { WriteLeadInput } from "./write-lead";
import { parseMglLot, type MglListLotRow } from "./mgl-harvest-write";

export type { MglListLotRow };

export type MglParsed = ReturnType<typeof parseMglLot>;

function mglSellerType(parsed: MglParsed): SellerType {
  const c = (parsed.comitente ?? "").toLowerCase();
  const n = parsed.notes.toLowerCase();
  const blob = `${c} ${n}`;
  if (/caixa\s*econ[oô]mica|caixa\b/.test(blob)) return "caixa_recovery";
  if (
    /\b(banco|bradesco|itau|itaú|santander|bb\b|banco do brasil|safra|sicoob|sicredi|banrisul|bv\b|pan\b|inter)\b/.test(
      blob,
    )
  ) {
    return "bank_recovery";
  }
  return "auction";
}

export function mglToWriteLead(parsed: MglParsed): WriteLeadInput | null {
  if (parsed.skipReason) return null;
  const input: WriteLeadInput = {
    brand: parsed.brand,
    model: parsed.model,
    year: parsed.year,
    askingPriceBRL: parsed.price,
    sourceUrl: parsed.url,
    sourcePlatform: "MGL",
    sellerType: mglSellerType(parsed),
    bodyType: parsed.bodyType,
    mileageKm: parsed.mileageKm,
    notes: parsed.notes,
  };
  if (parsed.modelYear) input.modelYear = parsed.modelYear;
  if (parsed.city) input.city = parsed.city;
  if (parsed.state) input.state = parsed.state;
  return input;
}

export function parseMglLead(
  id: number,
  url: string,
  html: string,
  listRow: MglListLotRow,
): { input?: WriteLeadInput; skip?: string } {
  const parsed = parseMglLot(id, url, html, listRow);
  if (parsed.skipReason) return { skip: parsed.skipReason };
  const input = mglToWriteLead(parsed);
  if (!input) return { skip: "parse_failed" };
  return { input };
}

export { parseMglLot };
