import type { BodyType } from "../../../src/lib/types";

const NON_CAR =
  /\b(moto|motocicleta|scooter|bike|quadriciclo|triciclo|caminh[aã]o|truck|onibus|ônibus|micro[oô]nibus|reboque|carreta|semirreboque|implemento|empilhadeira|trator|m[aá]quina|jet\s*ski|lancha|barco|embarca[cç][aã]o)\b/i;

export const MODEL_BODY_RULES: Array<{ re: RegExp; body: BodyType }> = [
  {
    re: /\b(s10|hilux|ranger|amarok|frontier|l200|triton|oroch|strada|saveiro|montana|toro|maverick|duster\s*oroch|f[-]?100|f[-]?250|f[-]?350|f[-]?4000|courier|colorado|silverado|foison)\b/i,
    body: "pickup",
  },
  {
    re: /\b(creta|tracker|t[- ]?cross|tcross|kicks|renegade|compass|commander|hr[-]?v|hrv|wr[-]?v|wrv|duster|captur|niva|sw4|sw[-]?4|rav4|corolla\s*cross|nivus|taos|tiggo|pulse|fastback|ecosport|aircross|c3\s*aircross|tucson|sportage|ix35|jimny|bronco|territory|pajero|outlander|asx|edge\b|equinox|trailblazer|santa\s*fe|sorento|kuga|cayenne|macan|x1\b|x3\b|x5\b|q3\b|q5\b|q7\b|tiguan|virtus\s*cross|freemont|journey|ml\s*350|ml350|gl[aaceks]\d*)\b/i,
    body: "suv",
  },
  {
    re: /\b(spin(?!\s*activ)|doblo|idea|livina|meriva|zafira|carnival|ducato|boxer|jumper|jumpy|master|sprinter|transit|kangoo|partner|berlingo|trafic|picasso)\b/i,
    body: "minivan",
  },
  {
    re: /\b(fiesta\s*sedan|corsa\s*sedan|ka\s*(se\s*)?(1\.\d)?\s*sd|focus\s*(se\s*)?sedan|civic|corolla(?!\s*cross)|city\b|virtus|voyage|prisma|cobalt|onix\s*plus|cronos|argo\s*sedan|siena|grand\s*siena|logan|versa|sentra|fluence|jetta|passat|fusion|symbol|etios\s*sedan|hb20s|arrizo|linea|bora|sedan|300c|xe\b|320i|328i|330i|520i|530i|a3\s*sedan|a4\b|a6\b|c180|c200|c250)\b/i,
    body: "sedan",
  },
  {
    re: /\b(gol|celta|uno|palio(?!\s*wk)|ka\b|fiesta(?!\s*sedan)|fox|polo(?!\s*sedan)|hb20(?!s)|onix(?!\s*plus)|sandero|kwid|mobi|argo(?!\s*sedan)|fit\b|march|eti?os(?!\s*sedan)|yaris(?!\s*sedan)|corsa(?!\s*sedan)|agile|up!|\bup\b|clio|208|207|c3(?!\s*aircross)|golf|i30|cerato|rio\b|soul|focus(?!\s*sedan)|punto|bravo|stilo|hatch)\b/i,
    body: "hatch",
  },
  { re: /\b(mustang|camaro|tt\b|cayman|911)\b/i, body: "coupe" },
  { re: /\b(weekend|spacefox|fiorino|parati|quantum|palio\s*wk)\b/i, body: "wagon" },
];

export const BRAND_ALIASES: Record<string, string> = {
  VOLKSWAGEN: "Volkswagen",
  CHEVROLET: "Chevrolet",
  TOYOTA: "Toyota",
  FORD: "Ford",
  FIAT: "Fiat",
  HONDA: "Honda",
  HYUNDAI: "Hyundai",
  RENAULT: "Renault",
  NISSAN: "Nissan",
  JEEP: "Jeep",
  PEUGEOT: "Peugeot",
  CITROEN: "Citroën",
  "CITROËN": "Citroën",
  BMW: "BMW",
  AUDI: "Audi",
  KIA: "Kia",
  MITSUBISHI: "Mitsubishi",
  MERCEDES: "Mercedes-Benz",
  "MERCEDES-BENZ": "Mercedes-Benz",
  "MERCEDES BENZ": "Mercedes-Benz",
  "M.BENZ": "Mercedes-Benz",
  CHERY: "Chery",
  "CAOA CHERY": "Caoa Chery",
  BYD: "BYD",
  RAM: "Ram",
  VOLVO: "Volvo",
  LANDROVER: "Land Rover",
  "LAND ROVER": "Land Rover",
  MINI: "Mini",
  Mini: "Mini",
  GM: "Chevrolet",
  VW: "Volkswagen",
};

export function parseBrl(raw: string | null | undefined): number | null {
  if (!raw?.trim()) return null;

  const trimmed = raw.trim();
  const brStyle = trimmed.match(/([\d.]+),(\d{2})/);
  if (brStyle) {
    const n = Number(brStyle[1].replace(/\./g, "") + "." + brStyle[2]);
    if (Number.isFinite(n) && n > 0) return Math.round(n);
  }

  const cleaned = trimmed.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  if (Number.isFinite(n) && n > 0) return Math.round(n);

  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  const fromDigits = Number(digits) / 100;
  return Number.isFinite(fromDigits) && fromDigits > 0 ? Math.round(fromDigits) : null;
}

export function parseKm(raw: string | null | undefined): number | null {
  if (!raw?.trim()) return null;
  if (/n[aã]o\s+informado|sem\s+informa/i.test(raw)) return null;

  const kmMatch = raw.match(/Km\s*([0-9.]+)/i);
  if (kmMatch) {
    const n = Number(kmMatch[1].replace(/\./g, ""));
    return Number.isFinite(n) && n >= 0 ? n : null;
  }

  const digits = raw.replace(/\D/g, "");
  if (!digits) return null;
  const n = Number(digits);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function parseYearFromText(
  text: string | null | undefined,
): { year: number; modelYear?: number } | null {
  if (!text?.trim()) return null;
  const blob = text.trim();

  const pair = blob.match(/(\d{4})\s*\/\s*(\d{4})/);
  if (pair) {
    const year = Number(pair[1]);
    const modelYear = Number(pair[2]);
    if (year >= 1980 && year <= 2030 && modelYear >= 1980 && modelYear <= 2030) {
      return { year, modelYear };
    }
  }

  const single = blob.match(/\b(19|20)\d{2}\b/);
  if (!single) return null;
  const year = Number(single[0]);
  return year >= 1980 && year <= 2030 ? { year } : null;
}

export function normalizeBrand(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return trimmed;
  return BRAND_ALIASES[trimmed] || BRAND_ALIASES[trimmed.toUpperCase()] || trimmed;
}

/**
 * Normalize a brand and strip a leading repetition of the brand from the model
 * (OLX "Modelo" often repeats the brand, e.g. "Chevrolet Onix Plus LT").
 * Returns the canonical brand and the de-duplicated model.
 */
export function normalizeBrandModel(brandRaw: string, modelRaw: string): { brand: string; model: string } {
  const brand = normalizeBrand(brandRaw);
  let model = modelRaw.trim();
  for (const prefix of [brand, brandRaw.trim()]) {
    if (!prefix) continue;
    const escaped = prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    model = model.replace(new RegExp(`^${escaped}\\s+`, "i"), "").trim();
  }
  return { brand, model };
}

/**
 * Model-name → body-type heuristic shared by the auction sources (BIDchain, MGL).
 * Order matters: pickup → minivan → SUV → sedan → hatch, then a few post-hoc
 * overrides, then wagon. Canonical union of the previously-duplicated per-source
 * copies (MGL's richer ruleset, plus BIDchain-only tokens: B180/B200, 320i/318i/A5).
 */
export function guessBodyTypeByModel(model: string): BodyType | null {
  const m = model.normalize("NFD").replace(/\p{M}/gu, "").toUpperCase();

  if (/\b(STRADA|SAVEIRO|TORO|HILUX|RANGER|S10|MAVERICK|OROCH|MONTANA|FRONTIER|AMAROK|L200|FIORINO|PARTNER|DOBLO CARGO)\b/.test(m)) {
    return "pickup";
  }
  if (/\b(SPIN|DOBLO|IDEA|LIVINA|JACARE|MULTIPLA|XPANDER|ZAFIRA|PICASSO|MERIVA|TRAFIC|KANGOO|PARTNER TEPEE|B180|B200)\b/.test(m)) {
    return "minivan";
  }
  if (/\b(CRETA|COMPASS|TRACKER|T[-\s]?CROSS|TCROSS|KICKS|HR-V|HRV|RENEGADE|DUSTER|CAPTUR|COROLLA CROSS|SW4|PAJERO|AIRCROSS|2008|3008|5008|ECOSPORT|TIGGO|HAVAL|TAOS|NIVUS|FASTBACK|PULSE|COMMANDER|BRONCO|TUCSON|SPORTAGE|IX35|OUTLANDER|DISCOVERY|EVOQUE|FREELANDER|CR-V|CRV|ASX|ECLIPSE CROSS|KAROQ|KODIAQ|TIGUAN|TERRITORY|BIGSTER|CAPTIVA)\b/.test(m)) {
    return "suv";
  }
  if (/\b(CIVIC|COROLLA|CRUZE|FOCUS|FUSION|SENTRA|VERSA|PRISMA|ONIX PLUS|COBALT|CLASSIC|SIENA|GRAND SIENA|LINEA|VOYAGE|VIRTUS|JETTA|CITY|ARRIZO|FLUENCE|LOGAN|SYMBOL|NEST|NEON|PASSAT|AZERA|OPTIMA|CERATO|LANCER|S90|S60|A3 SEDAN|A4|A5|320I|318I|ACCORD)\b/.test(m)) {
    return "sedan";
  }
  if (/\b(UNO|PALIO|GOL|FOX|UP[! ]|POLO|GOLF|KA\b|FIESTA|ONIX(?!\s+PLUS)|HB20(?!\s*S)|SANDERO|CLIO|207|208|\bC3\b|MOBI|ARGO|CRONOS|YARIS(?!\s*SEDAN)|ETIOS(?!\s*SEDAN)|KA\+|MARCH|KWID|PICANTO|i30|CELTA|CORSA|AGILE|SPACEFOX|CROSSFOX|KADETT|CHEVETTE|MONZA(?!\s+WAGON)|OPALA)\b/.test(m)) {
    return "hatch";
  }
  if (/\bHB20S\b/.test(m)) return "sedan";
  if (/\bCRONOS\b/.test(m)) return "sedan";
  if (/\bARGO\b/.test(m)) return "hatch";
  if (/\b(GOLF\s*VARIANT|SPACEFOX|PARATI|FOC\w*\s*SW|I30\s*CW)\b/.test(m)) return "wagon";
  return null;
}

export function inferBodyType(brand: string, model: string, blob: string): BodyType | null {
  const text = `${brand} ${model} ${blob}`;
  if (NON_CAR.test(text)) return null;
  for (const { re, body } of MODEL_BODY_RULES) {
    if (re.test(model) || re.test(text)) return body;
  }
  return null;
}
