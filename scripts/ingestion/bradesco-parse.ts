import type { BodyType, SellerType } from "../../src/lib/types";
import { detectDamageSignals } from "../../src/lib/filters/damageSignals";
import type { BradescoDetail } from "./bradesco-fetch";
import type { BradescoListLot } from "./bradesco-list";
import { shouldSkipListing } from "./lib/listing-filters";
import {
  inferBodyType,
  normalizeBrand,
  parseKm,
  parseYearFromText,
} from "./lib/parse-common";
import type { WriteLeadInput } from "./write-lead";

const NON_CAR =
  /\b(moto|motocicleta|scooter|bike|quadriciclo|triciclo|caminh[aã]o|truck|onibus|ônibus|micro[oô]nibus|reboque|carreta|semirreboque|implemento|empilhadeira|trator|m[aá]quina|jet\s*ski|lancha|barco|embarca[cç][aã]o)\b/i;

const UF_FROM_STATE: Record<string, string> = {
  acre: "AC",
  alagoas: "AL",
  amapá: "AP",
  amapa: "AP",
  amazonas: "AM",
  bahia: "BA",
  ceará: "CE",
  ceara: "CE",
  "distrito federal": "DF",
  "espírito santo": "ES",
  "espirito santo": "ES",
  goiás: "GO",
  goias: "GO",
  maranhão: "MA",
  maranhao: "MA",
  "mato grosso": "MT",
  "mato grosso do sul": "MS",
  "minas gerais": "MG",
  pará: "PA",
  para: "PA",
  paraíba: "PB",
  paraiba: "PB",
  paraná: "PR",
  parana: "PR",
  pernambuco: "PE",
  piauí: "PI",
  piaui: "PI",
  "rio de janeiro": "RJ",
  "rio grande do norte": "RN",
  "rio grande do sul": "RS",
  rondônia: "RO",
  rondonia: "RO",
  roraima: "RR",
  "santa catarina": "SC",
  "são paulo": "SP",
  "sao paulo": "SP",
  sergipe: "SE",
  tocantins: "TO",
};

export function normalizeBradescoState(
  state: string | null | undefined,
): string | undefined {
  if (!state) return undefined;
  const s = state.trim();
  if (/^[A-Z]{2}$/i.test(s)) return s.toUpperCase();
  const key = s
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase();
  return UF_FROM_STATE[s.toLowerCase()] || UF_FROM_STATE[key];
}

export function parseBradescoBrandModel(
  name: string,
): { brand: string; model: string } | null {
  if (!name) return null;
  const parts = name.split(/\s*-\s*/).map((p) => p.trim()).filter(Boolean);
  if (parts.length < 2) return null;

  let brand = parts[0];
  let model = parts[1];
  const rest = parts.slice(2);
  if (rest.length && !/^\d{4}/.test(model)) {
    const modelParts = [model];
    for (const p of rest) {
      if (/^\d{4}/.test(p)) break;
      modelParts.push(p);
    }
    model = modelParts.join(" - ");
  }

  brand = brand.replace(/\s+/g, " ").trim();
  model = model.replace(/\s+/g, " ").trim();
  model = model.replace(/\s*-\s*\d{4}(\s*\/\s*\d{4})?\s*$/, "").trim();
  if (!brand || !model || brand.length < 2 || model.length < 1) return null;

  brand = normalizeBrand(/^mini$/i.test(brand) ? "Mini" : brand.toUpperCase());
  return { brand, model };
}

export function bradescoSourceUrl(detail: BradescoDetail, list: BradescoListLot): string | null {
  const slug = detail.slug || list.slug;
  if (!slug) return null;
  return `https://vitrinebradesco.com.br/auctions/${slug}`;
}

export function buildBradescoNotes(
  detail: BradescoDetail,
  list: BradescoListLot,
): string {
  const parts: string[] = ["Bradesco retomado."];
  const recovery = detail.vehicle_type_of_recovery;
  if (recovery) parts.push(`vehicle_type_of_recovery: ${recovery}`);
  const auctioneer = detail.auctioneer?.name;
  if (auctioneer) parts.push(`Partner=${auctioneer}`);
  const desc = detail.description || list.description;
  if (desc) parts.push(`desc=${desc}`);
  parts.push("askingPriceBRL = minimum bid (lance mínimo).");
  return parts.join(" ");
}

export type ParsedBradescoLead =
  | { input: WriteLeadInput; skip?: undefined }
  | { input?: undefined; skip: string; detail?: string };

export function parseBradescoLead(
  list: BradescoListLot,
  detail: BradescoDetail,
): ParsedBradescoLead {
  const recoverySkip = shouldSkipListing({
    recoveryType: detail.vehicle_type_of_recovery ?? undefined,
  });
  if (recoverySkip.skip) {
    return { skip: recoverySkip.reason ?? "sinistrado_recovery" };
  }

  const name = detail.name || list.name || "";
  const description = detail.description || list.description || "";
  const notes = buildBradescoNotes(detail, list);

  const damage = detectDamageSignals(notes);
  if (damage.blocked) return { skip: "damage", detail: damage.reasons.join(",") };

  const brandModel = parseBradescoBrandModel(name);
  const yearParsed = parseYearFromText(`${name} ${description}`);
  const year = yearParsed?.year ?? null;
  const price =
    typeof detail.price === "number" && detail.price > 0
      ? Math.round(detail.price)
      : typeof list.price === "number" && list.price > 0
        ? Math.round(list.price)
        : null;
  const sourceUrl = bradescoSourceUrl(detail, list);

  if (!brandModel || !year || !price || !sourceUrl) {
    const missing: string[] = [];
    if (!brandModel) missing.push("brand/model");
    if (!year) missing.push("year");
    if (!price) missing.push("price");
    if (!sourceUrl) missing.push("sourceUrl");
    return { skip: "missing_fields", detail: missing.join("+") };
  }

  if (NON_CAR.test(`${brandModel.brand} ${brandModel.model} ${name}`)) {
    return { skip: "non_car" };
  }

  const bodyType = inferBodyType(
    brandModel.brand,
    brandModel.model,
    `${name} ${description}`,
  ) as BodyType | null;
  if (!bodyType) {
    return {
      skip: "ambiguous_body",
      detail: `${brandModel.brand} ${brandModel.model}`,
    };
  }

  const mileageKm = parseKm(description);
  const city = detail.city || list.city || undefined;
  const state = normalizeBradescoState(detail.state || list.state || undefined);

  return {
    input: {
      brand: brandModel.brand,
      model: brandModel.model,
      year,
      askingPriceBRL: price,
      sourceUrl,
      sourcePlatform: "Bradesco Vitrine",
      sellerType: "bank_recovery" satisfies SellerType,
      bodyType,
      mileageKm: mileageKm ?? null,
      city: city ?? undefined,
      state,
      notes,
    },
  };
}
