/** BIDchain lot HTML parser — deterministic, no network. */
import { detectDamageSignals } from "../../src/lib/filters/damageSignals";
import type { BodyType } from "../../src/lib/types";
import type { WriteLeadInput } from "./write-lead";

export type BidchainParsed = {
  id: string;
  url: string;
  brand: string;
  model: string;
  year: number;
  price: number;
  bodyType: BodyType;
  sellerType: "caixa_recovery" | "bank_recovery" | "auction";
  mileageKm: null;
  plate?: string;
  chassis?: string;
  city?: string;
  state?: string;
  notes: string;
  skipReason?: string;
};

const BRAND_ALIASES: Record<string, string> = {
  VW: "Volkswagen",
  VOLKSWAGEN: "Volkswagen",
  GM: "Chevrolet",
  CHEVROLET: "Chevrolet",
  "M.BENZ": "Mercedes-Benz",
  "MERCEDES BENZ": "Mercedes-Benz",
  MERCEDES: "Mercedes-Benz",
  "MERCEDES-BENZ": "Mercedes-Benz",
  FIAT: "Fiat",
  FORD: "Ford",
  TOYOTA: "Toyota",
  HYUNDAI: "Hyundai",
  AUDI: "Audi",
  BMW: "BMW",
  CHERY: "Chery",
  "CAOA CHERY": "Chery",
  RENAULT: "Renault",
  NISSAN: "Nissan",
  HONDA: "Honda",
  JEEP: "Jeep",
  KIA: "Kia",
  PEUGEOT: "Peugeot",
  CITROEN: "Citroen",
  CITROËN: "Citroen",
  MITSUBISHI: "Mitsubishi",
};

const MODEL_BRAND: Array<{ re: RegExp; brand: string }> = [
  { re: /\b(SAVEIRO|GOL|FOX|CROSSFOX|POLO|VOYAGE|VIRTUS|JETTA|NIVUS|T[\-\s]?CROSS)\b/i, brand: "Volkswagen" },
  { re: /\b(CELTA|CORSA|MONTANA|S10|ONIX|PRISMA|CRUZE|SPIN|TRACKER)\b/i, brand: "Chevrolet" },
  { re: /\b(UNO|PALIO|SIENA|STRADA|DOBLO|ARGO|CRONOS|MOBI|TORO|PULSE)\b/i, brand: "Fiat" },
  { re: /\b(FIESTA|FOCUS|FUSION|RANGER|KA\b|ECOSPORT)\b/i, brand: "Ford" },
  { re: /\b(COROLLA|HILUX|ETIOS|YARIS|SW4)\b/i, brand: "Toyota" },
  { re: /\b(HB20|CRETA|TUCSON|IX35|i30)\b/i, brand: "Hyundai" },
  { re: /\b(KWID|LOGAN|SANDERO|DUSTER|OROCH|CAPTUR|CLIO)\b/i, brand: "Renault" },
  { re: /\b(VERSA|KICKS|MARCH|SENTRA|FRONTIER)\b/i, brand: "Nissan" },
  { re: /\b(TIGGO|ARRIZO)\b/i, brand: "Chery" },
  { re: /\b(320I|318I|X1|X3)\b/i, brand: "BMW" },
  { re: /\b(B180|B200|C180|A200)\b/i, brand: "Mercedes-Benz" },
  { re: /\b(A3|A4|A5|Q3|Q5)\b/i, brand: "Audi" },
];

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\u00a0/g, " ");
}

function stripTags(html: string): string {
  return decodeEntities(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim(),
  );
}

function parseBrl(raw: string): number | null {
  const cleaned = raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractPrice(html: string): number | null {
  const inicial = html.match(
    /Lance Inicial:\s*(?:<\/strong>)?\s*R\$\s*([\d.]+,\d{2})/i,
  );
  if (inicial) return parseBrl(inicial[1]);

  // Judicial: use 1º LEILÃO floor when listed (upcoming first auction).
  const primeiro = html.match(
    /1[ºo]\s*LEIL[ÃA]O:\s*(?:<\/strong>)?\s*R\$\s*([\d.]+,\d{2})/i,
  );
  if (primeiro) return parseBrl(primeiro[1]);

  const qualquer = html.match(
    /bem-lance-valores[\s\S]{0,400}?R\$\s*([\d.]+,\d{2})/i,
  );
  return qualquer ? parseBrl(qualquer[1]) : null;
}

function extractH5(html: string): string {
  const m = html.match(/<h5[^>]*>([\s\S]*?)<\/h5>/i);
  if (!m) return "";
  return stripTags(m[1]);
}

function extractLoc(html: string): { city?: string; state?: string } {
  const bread = html.match(/-->\s*([A-ZÁÉÍÓÚÂÊÔÃÕÇ][^<\n,]{1,40}),\s*([A-Z]{2})/);
  if (bread) return { city: bread[1].trim(), state: bread[2].toUpperCase() };
  const title = html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "";
  const t = decodeEntities(title);
  const m = t.match(/\bem\s+(.+?)\s+-\s+([A-Za-zÁÉÍÓÚÂÊÔÃÕÇ ]+)$/i);
  if (m) {
    // e.g. "em GOIANA - Pernambuco" — state name not UF; try UF elsewhere
    const city = m[1].trim();
    return { city };
  }
  return {};
}

function extractUfFromTitle(html: string): string | undefined {
  // "em DOURADOS - Mato Grosso do Sul" — map common
  const title = decodeEntities(html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "");
  const map: Array<[RegExp, string]> = [
    [/Mato Grosso do Sul/i, "MS"],
    [/Pernambuco/i, "PE"],
    [/Minas Gerais/i, "MG"],
    [/Rio de Janeiro/i, "RJ"],
    [/Paraíba/i, "PB"],
    [/São Paulo/i, "SP"],
    [/Paraná/i, "PR"],
  ];
  for (const [re, uf] of map) if (re.test(title)) return uf;
  return undefined;
}

function extractIdentity(text: string): { plate?: string; chassis?: string } {
  const plateM = text.match(/\bPLACA:\s*([A-Z0-9*]+)/i);
  const chassisM = text.match(/\bCHASSI:\s*([A-Z0-9*]+)/i);
  const plate = plateM?.[1];
  const chassis = chassisM?.[1];
  const out: { plate?: string; chassis?: string } = {};
  if (plate && !plate.includes("*") && plate.length >= 7) out.plate = plate.toUpperCase();
  if (chassis && !chassis.includes("*") && chassis.length >= 17)
    out.chassis = chassis.toUpperCase();
  return out;
}

function extractYears(text: string): { year: number; modelYear?: number } | null {
  let m = text.match(
    /ANO\s*FAB\s*\/\s*ANO\s*MOD:\s*(\d{4})\s*[-–]\s*(\d{4})/i,
  );
  if (m) return { year: Number(m[1]), modelYear: Number(m[2]) };
  m = text.match(/\b(\d{4})\s*\/\s*(\d{4})\b/);
  if (m) return { year: Number(m[1]), modelYear: Number(m[2]) };
  m = text.match(/\b((?:19|20)\d{2})\s*[-–]\s*((?:19|20)\d{2})\b/);
  if (m) return { year: Number(m[1]), modelYear: Number(m[2]) };
  m = text.match(/\b((?:19|20)\d{2})\b/);
  if (m) return { year: Number(m[1]) };
  return null;
}

function cleanModel(model: string, brand: string): string {
  let m = model.replace(/\s+/g, " ").trim();
  // Drop brand prefix duplicated in model (e.g. "MERCEDES BENZ B180", "BMW 320I")
  const brandPrefix = brand.toUpperCase().replace(/-/g, " ");
  const aliases = [brandPrefix, brandPrefix.replace(/\s+/g, " "), "MERCEDES BENZ", "M.BENZ", "VW", "GM"];
  for (const a of aliases) {
    const re = new RegExp(`^${a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s+`, "i");
    m = m.replace(re, "");
  }
  // Strip trailing year / color / fuel crumbs
  m = m
    .replace(/\s*[-–]\s*\d{4}\s*[-–].*$/, "")
    .replace(/\s+\d{4}\s*$/, "")
    .replace(/\s*[-–]\s*(PRATA|PRETA|BRANCA|VERMELHO|VERDE|AZUL|CINZA|GASOLINA|ÁLCOOL\/GASOLINA|FLEX).*$/i, "")
    .trim();
  return m;
}

function splitBrandModel(h5: string): { brand: string; model: string } | null {
  const clean = h5
    .replace(/\|\s*ANO[\s\S]*$/i, "")
    .replace(/\bANO\s*FAB[\s\S]*$/i, "")
    .replace(/\bPLACA:[\s\S]*$/i, "")
    .replace(/\bCOR:[\s\S]*$/i, "")
    .replace(/\bFLEX\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  // "BRAND - MODEL ..." only when left side is a known brand token
  const dash = clean.match(/^([A-Z0-9.]+(?:\s+[A-Z0-9.]+)?)\s*[-–]\s*(.+)$/i);
  if (dash) {
    const rawBrand = dash[1].trim().toUpperCase();
    if (BRAND_ALIASES[rawBrand] || ["FIAT","FORD","TOYOTA","HYUNDAI","AUDI","BMW","CHERY","RENAULT","NISSAN","HONDA","JEEP","KIA","PEUGEOT","VOLKSWAGEN","CHEVROLET"].includes(rawBrand)) {
      const brand = BRAND_ALIASES[rawBrand] ?? titleCase(rawBrand);
      let model = dash[2].trim();
      model = model.replace(/\s*[-–]\s*\d{4}.*$/, "").trim();
      model = cleanModel(model, brand);
      if (brand && model) return { brand, model };
    }
  }

  // Canal style: "KWID ZEN 10MT - 2019 - 2020 - BRANCA - ..." or "FORD FIESTA - 2002 - ..."
  const canal = clean.match(/^(.+?)\s*[-–]\s*\d{4}\b/);
  const head = (canal?.[1] ?? clean).trim();

  // Leading known brand in head
  for (const [alias, brand] of Object.entries(BRAND_ALIASES)) {
    if (head.toUpperCase().startsWith(alias + " ")) {
      return { brand, model: cleanModel(head.slice(alias.length).trim(), brand) };
    }
  }

  for (const { re, brand } of MODEL_BRAND) {
    if (re.test(head)) {
      return { brand, model: cleanModel(head, brand) };
    }
  }
  return null;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/([\s-]+)/)
    .map((p) => (/^[\s-]+$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1)))
    .join("");
}

function guessBodyType(model: string): BodyType | null {
  const m = model
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase();

  if (
    /\b(STRADA|SAVEIRO|TORO|HILUX|RANGER|S10|MAVERICK|OROCH|MONTANA|FRONTIER|AMAROK|L200)\b/.test(
      m,
    )
  ) {
    return "pickup";
  }
  if (/\b(SPIN|DOBLO|IDEA|B180|B200)\b/.test(m)) return "minivan";
  if (
    /\b(CRETA|COMPASS|TRACKER|T-CROSS|TCROSS|KICKS|HR-V|HRV|RENEGADE|DUSTER|CAPTUR|SW4|ECOSPORT|TIGGO|TAOS|NIVUS|FASTBACK|PULSE|TUCSON|SPORTAGE|IX35)\b/.test(
      m,
    )
  ) {
    return "suv";
  }
  // Hatch before sedan so "GOL ... CITY" / Fiesta etc. don't hit sedan CITY/FOCUS lists wrongly.
  if (
    /\b(UNO|PALIO|GOL|FOX|CROSSFOX|POLO|GOLF|KA\b|FIESTA|ONIX|HB20|SANDERO|CLIO|MOBI|ARGO|KWID|CELTA|CORSA)\b/.test(
      m,
    )
  ) {
    return "hatch";
  }
  if (
    /\b(COROLLA|CRUZE|FOCUS|FUSION|SENTRA|VERSA|PRISMA|COBALT|SIENA|VOYAGE|VIRTUS|JETTA|LOGAN|320I|318I|A3|A4|A5)\b/.test(
      m,
    ) ||
    /\bHONDA\s+CITY\b|\bCITY\s+1\./.test(m)
  ) {
    return "sedan";
  }
  return null;
}

function sellerTypeFromHtml(html: string): BidchainParsed["sellerType"] {
  const text = stripTags(html);
  if (/caixa\s+econ[oô]mica\s+federal|\bcaixa\b/i.test(text) &&
      /leil[aã]o\s+caixa|caixa\s+econ[oô]mica|comitente[^.]{0,40}caixa/i.test(text)) {
    return "caixa_recovery";
  }
  // Strong explicit Caixa heading used on Adri white-label
  if (/Caixa Econ[oô]mica Federal/i.test(html)) return "caixa_recovery";

  const bank = text.match(
    /\b(Banco\s+[A-ZÁÉÍÓÚ][\wÁÉÍÓÚáéíóúÃÕãõç ]{2,40}|Bradesco|Ita[uú]|Santander|BB\b|Banco do Brasil)\b/i,
  );
  // Avoid false positives from generic footer
  if (bank && /comitente/i.test(text)) return "bank_recovery";
  return "auction";
}

function notesFromHtml(html: string, h5: string): string {
  const bits: string[] = [];
  const caixa = html.match(/Caixa Econ[oô]mica Federal[^<\n]{0,40}/i);
  if (caixa) bits.push(stripTags(caixa[0]));
  const sin = html.match(/Sinistro[^<\n]{0,80}/i);
  if (sin) bits.push(stripTags(sin[0]));
  const monta = html.match(/\b(?:pequena|m[eé]dia|grande)\s+monta\b[^<\n]{0,40}/i);
  if (monta) bits.push(stripTags(monta[0]));
  const vara = stripTags(html).match(/\d[ªa]\s+Vara[^.]{0,60}/i);
  if (vara) bits.push(vara[0].slice(0, 80));
  const conserv = stripTags(html).match(/estado de conserva[cç][aã]o[^.]{0,80}/i);
  if (conserv) bits.push(conserv[0].slice(0, 100));
  if (h5) bits.push(h5.slice(0, 160));
  return bits.join(" | ").slice(0, 500);
}

function isHeavyOrMoto(text: string): boolean {
  return /\b(caminh[aã]o|cargo\s*\d|stralis|ax[0o]r|ônibus|onibus|trator|semi[- ]?reboque|motocicleta|\bcg\s*\d|pop\s*\d|yamaha\s+factor|honda\s+cg|honda\s+pop|sucata)\b/i.test(
    text,
  );
}

function extractLotDescription(html: string): string {
  // Prefer DESCRIÇÃO COMPLETA block; avoid site-wide category nav ("SUCATA").
  const m = html.match(
    /DESCRI[CÇ][AÃ]O COMPLETA([\s\S]{0,6000}?)(?:ÚLTIMOS LANCES|LANCES POR USUÁRIO|bem-lance-valores)/i,
  );
  if (m) return stripTags(m[1]);
  const h5 = extractH5(html);
  return h5;
}

function parseBidchainLot(id: string, url: string, html: string): BidchainParsed {
  const h5 = extractH5(html);
  const title = decodeEntities(html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "");
  const description = extractLotDescription(html);
  // Damage / sucata: lot title + description only (never full page — nav lists SUCATA).
  const damageBlob = `${h5}\n${title}\n${description}`;

  if (/sucata/i.test(h5) || /sucata/i.test(title)) {
    return emptySkip(id, url, "sucata");
  }
  if (isHeavyOrMoto(h5) || isHeavyOrMoto(title)) {
    return emptySkip(id, url, "heavy_or_moto");
  }

  const damage = detectDamageSignals(damageBlob);
  if (damage.blocked) {
    return emptySkip(id, url, `damage: ${damage.reasons.join(", ")}`);
  }

  const brandModel = splitBrandModel(h5 || title);
  if (!brandModel) return emptySkip(id, url, "missing brand/model");

  const years = extractYears(h5 || title);
  if (!years?.year) return emptySkip(id, url, "missing year");

  const price = extractPrice(html);
  if (!price) return emptySkip(id, url, "missing price");

  const bodyType = guessBodyType(`${brandModel.brand} ${brandModel.model}`);
  if (!bodyType) return emptySkip(id, url, `ambiguous bodyType: ${brandModel.model}`);

  const loc = extractLoc(html);
  const state = loc.state ?? extractUfFromTitle(html);
  const idents = extractIdentity(h5);
  const sellerType = sellerTypeFromHtml(html);
  const notes = notesFromHtml(html, h5);

  // Canonical source URL: prefer candidate url (already white-label)
  return {
    id,
    url,
    brand: brandModel.brand,
    model: brandModel.model.replace(/\s+/g, " ").trim(),
    year: years.year,
    price,
    bodyType,
    sellerType,
    mileageKm: null,
    plate: idents.plate,
    chassis: idents.chassis,
    city: loc.city,
    state,
    notes,
  };
}

function emptySkip(id: string, url: string, skipReason: string): BidchainParsed {
  return {
    id,
    url,
    brand: "",
    model: "",
    year: 0,
    price: 0,
    bodyType: "hatch",
    sellerType: "auction",
    mileageKm: null,
    notes: "",
    skipReason,
  };
}

export function bidchainToWriteLead(parsed: BidchainParsed): WriteLeadInput | null {
  if (parsed.skipReason) return null;
  const input: WriteLeadInput = {
    brand: parsed.brand,
    model: parsed.model,
    year: parsed.year,
    askingPriceBRL: parsed.price,
    sourceUrl: parsed.url,
    sourcePlatform: "BIDchain",
    sellerType: parsed.sellerType,
    bodyType: parsed.bodyType,
    mileageKm: null,
    notes: parsed.notes,
  };
  if (parsed.plate) input.plate = parsed.plate;
  if (parsed.chassis) input.chassis = parsed.chassis;
  if (parsed.city) input.city = parsed.city;
  if (parsed.state) input.state = parsed.state;
  return input;
}

export { parseBidchainLot };
