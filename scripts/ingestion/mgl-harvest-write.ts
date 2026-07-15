/**
 * Parse MGL lot HTML dumps and write leads (damage-only gate).
 * Does not call the network — reads /tmp/mgl-harvest/lots/*.html
 *
 * @deprecated Prefer `mgl-harvest.ts` for full corp-repasse pipeline.
 */
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { detectDamageSignals } from "../../src/lib/filters/damageSignals";
import type { BodyType } from "../../src/lib/types";
import { isCliEntry } from "./fetch-guards";

const LOTS_DIR = "/tmp/mgl-harvest/lots";
const LIST_JSON = "/tmp/mgl-harvest/lots-all.json";
const TALLY_OUT = "/tmp/mgl-harvest/tally.json";
const ROOT = process.cwd();

export type MglListLotRow = {
  id: number;
  url: string;
  statusLote: string;
  statusLeilao: string;
  statusLabel?: string;
  valorMinimo: number | null;
  valorVendaDireta?: number | null;
  valorAvaliacao?: number | null;
  isVendaDireta?: boolean;
  categoria?: string;
  auctionId?: number;
  titulo?: string;
};

type Parsed = {
  id: number;
  url: string;
  brand: string;
  model: string;
  year: number;
  modelYear?: number;
  price: number;
  bodyType: BodyType;
  mileageKm: number | null;
  city?: string;
  state?: string;
  notes: string;
  infoBlock: string;
  status: string;
  comitente?: string;
  skipReason?: string;
};

const BRANDS = [
  "LAND ROVER",
  "MERCEDES-BENZ",
  "MERCEDES BENZ",
  "VOLKSWAGEN",
  "CHEVROLET",
  "MITSUBISHI",
  "HYUNDAI",
  "RENAULT",
  "PEUGEOT",
  "CITROEN",
  "CITROËN",
  "TOYOTA",
  "NISSAN",
  "HONDA",
  "FIAT",
  "FORD",
  "JEEP",
  "KIA",
  "BMW",
  "AUDI",
  "VOLVO",
  "CHERY",
  "CAOA CHERY",
  "BYD",
  "RAM",
  "I/VW",
  "VW",
  "GM",
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

function extractInfoBlock(html: string): string {
  // Prefer the Informações section content between MODELO and Ônus / despesas boilerplate.
  const modeloIdx = html.search(/MODELO\s*:/i);
  if (modeloIdx === -1) return "";
  const slice = html.slice(modeloIdx, modeloIdx + 4000);
  const text = stripTags(slice);
  // Cut before generic legal terms that contain "eventual sinistro"
  const cut = text.split(
    /A descrição pode não apresentar|DESPESA ADMINISTRATIVA|VENDA VOCÊ TAMBÉM|REGRAS PARA ENVIO/i,
  )[0];
  return cut.trim();
}

function parseBrl(raw: string): number | null {
  const cleaned = raw.replace(/[^\d,.-]/g, "").replace(/\./g, "").replace(",", ".");
  const n = Number(cleaned);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function extractPrice(html: string, list: MglListLotRow): number | null {
  const fromList = list.valorMinimo && list.valorMinimo > 0 ? list.valorMinimo : null;
  const vendaHtml = html.match(
    /class="ValorMinVendaDireta"[^>]*>\s*(?:R\$\s*)?([\d.]+,\d{2})/i,
  );
  const vendaParsed = vendaHtml ? parseBrl(vendaHtml[1]) : null;
  const venda =
    (list.valorVendaDireta && list.valorVendaDireta > 0
      ? list.valorVendaDireta
      : null) ?? vendaParsed;

  // Prefer list ProximoLance / 1ª praça (already resolved in list JSON).
  if (fromList) return fromList;
  if (venda) return venda;

  const vals: number[] = [];
  for (const cls of [
    "ValorMinimoLancePrimeiraPraca",
    "ValorMinimoLanceSegundaPraca",
    "ValorMinimoLanceTerceiraPraca",
  ]) {
    const re = new RegExp(
      `class="${cls}"[^>]*>\\s*(?:R\\$\\s*)?([\\d.]+,\\d{2})`,
      "i",
    );
    const m = html.match(re);
    if (m) {
      const n = parseBrl(m[1]);
      if (n) vals.push(n);
    }
  }
  // First matching labeled praca in preferred order (not Math.min — avoid 3ª scrap).
  if (vals.length) return vals[0];
  return null;
}

function guessBodyType(model: string): BodyType | null {
  const m = model
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toUpperCase();

  if (
    /\b(STRADA|SAVEIRO|TORO|HILUX|RANGER|S10|MAVERICK|OROCH|MONTANA|FRONTIER|AMAROK|L200|FIORINO|PARTNER|MONTANA|DOBLO CARGO)\b/.test(
      m,
    )
  ) {
    return "pickup";
  }
  if (/\b(SPIN|DOBLO|IDEA|LIVINA|JACARE|MULTIPLA|XPANDER|ZAFIRA|PICASSO|MERIVA|TRAFIC|KANGOO|PARTNER TEPEE)\b/.test(m)) {
    return "minivan";
  }
  if (
    /\b(CRETA|COMPASS|TRACKER|T[-\s]?CROSS|TCROSS|KICKS|HR-V|HRV|RENEGADE|DUSTER|CAPTUR|COROLLA CROSS|SW4|PAJERO|AIRCROSS|2008|3008|5008|ECOSPORT|TIGGO|CAOA|HAVAL|TAOS|NIVUS|FASTBACK|PULSE|COMMANDER|BRONCO|TUCSON|SPORTAGE|IX35|OUTLANDER|DISCOVERY|EVOQUE|FREELANDER|CR-V|CRV|ASX|ECLIPSE CROSS|KAROQ|KODIAQ|TIGUAN|TERRITORY|BIGSTER|CAPTIVA)\b/.test(
      m,
    )
  ) {
    return "suv";
  }
  if (
    /\b(CIVIC|COROLLA|CRUZE|FOCUS|FUSION|SENTRA|VERSA|PRISMA|ONIX PLUS|COBALT|CLASSIC|SIENA|GRAND SIENA|LINEA|VOYAGE|VIRTUS|JETTA|CITY|ARRIZO|FLUENCE|LOGAN|SYMBOL|NEST|NEON|PASSAT|AZERA|OPTIMA|CERATO|LANCER|S90|S60|A3 SEDAN|A4|ACCORD)\b/.test(
      m,
    )
  ) {
    return "sedan";
  }
  if (
    /\b(UNO|PALIO|GOL|FOX|UP[! ]|POLO|GOLF|KA\b|FIESTA|ONIX(?!\s+PLUS)|HB20(?!\s*S)|SANDERO|CLIO|207|208|\bC3\b|MOBI|ARGO|CRONOS|YARIS(?!\s*SEDAN)|ETIOS(?!\s*SEDAN)|KA\+|MARCH|KWID|PICANTO|i30|CELTA|CORSA|AGILE|SPACEFOX|CROSSFOX|KADETT|CHEVETTE|MONZA(?!\s+WAGON)|OPALA)\b/.test(
      m,
    )
  ) {
    return "hatch";
  }
  if (/\bHB20S\b/.test(m)) return "sedan";
  if (/\bCRONOS\b/.test(m)) return "sedan";
  if (/\bARGO\b/.test(m)) return "hatch";
  if (/\b(GOLF\s*VARIANT|SPACEFOX|PARATI|FOC\w*\s*SW|I30\s*CW)\b/.test(m)) {
    return "wagon";
  }
  return null;
}

function splitBrandModel(modelo: string): { brand: string; model: string } | null {
  let t = modelo.replace(/\s+/g, " ").trim();
  // Normalize VW/, GM/, I/VW prefixes from auction titles
  t = t
    .replace(/^I\/VW\s*/i, "VOLKSWAGEN ")
    .replace(/^VW\//i, "VOLKSWAGEN ")
    .replace(/^VW\s+/i, "VOLKSWAGEN ")
    .replace(/^GM\//i, "CHEVROLET ")
    .replace(/^GM\s+/i, "CHEVROLET ")
    .replace(/^KIA\s+MOTORS\s+/i, "KIA ")
    .replace(/^RENAULT\s*\/\s*/i, "RENAULT ")
    .trim();
  for (const b of BRANDS) {
    if (t.toUpperCase().startsWith(b + " ") || t.toUpperCase() === b) {
      return {
        brand:
          b === "VW" || b === "I/VW"
            ? "Volkswagen"
            : b === "GM"
              ? "Chevrolet"
              : titleCase(b),
        model: t.slice(b.length).trim() || t,
      };
    }
  }
  // title may be CITY/UF- BRAND ...
  return null;
}

function titleCase(s: string): string {
  return s
    .toLowerCase()
    .split(/([\s-]+)/)
    .map((p) =>
      /^[\s-]+$/.test(p) ? p : p.charAt(0).toUpperCase() + p.slice(1),
    )
    .join("");
}

export function parseMglLot(id: number, url: string, html: string, list: MglListLotRow): Parsed {
  const info = extractInfoBlock(html);
  const titleMatch =
    html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1] ??
    html.match(/<title>([^<]+)<\/title>/i)?.[1] ??
    "";
  const title = decodeEntities(titleMatch)
    .replace(/\s*Carros em leilão.*$/i, "")
    .replace(/\s*\|\s*MGL.*$/i, "")
    .trim();

  let city: string | undefined;
  let state: string | undefined;
  const loc = title.match(/^([^-\n]+?)\/([A-Z]{2})\s*-/i);
  if (loc) {
    city = loc[1].trim();
    state = loc[2].toUpperCase();
  }

  const modeloRaw =
    info
      .match(
        /MODELO:\s*(.+?)(?=\s+ANO(?:\/MODELO)?:|\s+COR:|\s+CÂMBIO:|\s+COMBUST|\s+KM:|\s+EMPLACAMENTO:|\s+PLACA:|\s+CHASSI:|$)/i,
      )?.[1]
      ?.trim() ??
    title
      .replace(/^[^/]+\/[A-Z]{2}\s*-\s*/i, "")
      .replace(/-\s*[A-Z]{0,3}\d+\s*$/i, "")
      .replace(/\s*Carros em leilão.*$/i, "")
      .trim();

  // Fail closed on salvage titles/slugs before brand parse
  if (
    /sucata|baixado|\bbatido\b|recuperado e sucata/i.test(title) ||
    /veiculos-batidos|sucatas/i.test(url)
  ) {
    return {
      id,
      url,
      brand: "",
      model: "",
      year: 0,
      price: 0,
      bodyType: "hatch",
      mileageKm: null,
      notes: title.slice(0, 200),
      infoBlock: `${title} ${info}`,
      status: "",
      skipReason: `damage-title/url: ${title.slice(0, 80)}`,
    };
  }

  const brandModel = splitBrandModel(modeloRaw);
  if (!brandModel) {
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
      infoBlock: info,
      status: "",
      skipReason: `brand/model unclear: ${modeloRaw.slice(0, 80)}`,
    };
  }

  const anoRaw =
    info.match(/ANO(?:\/MODELO)?:\s*([0-9]{4})(?:\s*\/\s*([0-9]{4}))?/i) ??
    null;
  let year = anoRaw ? Number(anoRaw[1]) : 0;
  let modelYear = anoRaw?.[2] ? Number(anoRaw[2]) : undefined;
  if (!year) {
    const fromTitle = title.match(/\b(19|20)\d{2}\s*\/\s*((?:19|20)\d{2})\b/);
    if (fromTitle) {
      year = Number(fromTitle[0].slice(0, 4));
      modelYear = Number(fromTitle[2]);
    }
  }
  // Allow classic/older auction cars (owner: write all clear years, not only goal window).
  if (!year || year < 1950 || year > 2030) {
    return {
      id,
      url,
      brand: brandModel.brand,
      model: brandModel.model,
      year: 0,
      price: 0,
      bodyType: "hatch",
      mileageKm: null,
      notes: "",
      infoBlock: info,
      status: "",
      skipReason: "year unclear",
    };
  }

  const kmMatch = info.match(/KM:\s*([\d.]+)/i);
  const mileageKm = kmMatch
    ? Number(kmMatch[1].replace(/\./g, ""))
    : null;
  const mileage =
    mileageKm != null && Number.isFinite(mileageKm) && mileageKm > 0
      ? mileageKm
      : null;

  const price = extractPrice(html, list);
  if (!price) {
    return {
      id,
      url,
      brand: brandModel.brand,
      model: brandModel.model,
      year,
      modelYear,
      price: 0,
      bodyType: "hatch",
      mileageKm: mileage,
      notes: "",
      infoBlock: info,
      status: "",
      skipReason: "price unclear",
    };
  }

  // Motos / machines — fail closed (no bodyType)
  if (
    /\b(MOTO|MOTOCICLETA|SCOOTER|CG\s*\d|BIZ|FAN\s*\d|TITAN|TRAILER|CAMINH[AÃ]O|ONIBUS|ÔNIBS|TRATOR|EMPILHADEIRA|M[AÁ]QUINA)\b/i.test(
      `${brandModel.model} ${title} ${info}`,
    )
  ) {
    return {
      id,
      url,
      brand: brandModel.brand,
      model: brandModel.model,
      year,
      modelYear,
      price,
      bodyType: "hatch",
      mileageKm: mileage,
      notes: "",
      infoBlock: info,
      status: "",
      skipReason: `non-car / ambiguous category: ${brandModel.model.slice(0, 60)}`,
    };
  }

  const bodyType = guessBodyType(brandModel.model);
  if (!bodyType) {
    return {
      id,
      url,
      brand: brandModel.brand,
      model: brandModel.model,
      year,
      modelYear,
      price,
      bodyType: "hatch",
      mileageKm: mileage,
      notes: "",
      infoBlock: info,
      status: "",
      skipReason: `bodyType fail-closed: ${brandModel.model}`,
    };
  }

  const online = /dg-lote-meio--online/i.test(html) ? "Online" : "";
  const compre = /COMPRE AGORA/i.test(html) || list.isVendaDireta ? "COMPRE AGORA" : "";
  const status = [
    list.statusLabel || list.statusLeilao || list.statusLote,
    online,
    compre,
  ]
    .filter(Boolean)
    .join(" | ");

  const cod =
    html.match(/Cód do leilão:\s*<strong>([^<]+)<\/strong>/i)?.[1] ??
    html.match(/0?\d{4}\/[A-Z0-9]+/i)?.[0] ??
    "";

  const comitente =
    info.match(/COMITENTE:\s*(.+?)(?=\s+[A-ZÁÉÍÓÚÃÕÇ]{3,}:|$)/i)?.[1]?.trim() ??
    stripTags(html).match(/Comitente\s*:\s*([^\n|]{3,80})/i)?.[1]?.trim() ??
    "";

  const sourceTag =
    list.categoria?.toUpperCase().includes("MGL DIRETO") || list.isVendaDireta
      ? "MGL DIRETO"
      : /judicial/i.test(list.url)
        ? "judicial"
        : list.categoria || "MGL";

  const notesParts = [
    sourceTag,
    status,
    cod ? `Cód ${cod}` : "",
    comitente ? `Comitente: ${comitente}` : "",
    info.match(/CÂMBIO:\s*([^A-Z]+|[A-Z][A-Z\s]+?)(?=\s+COMBUST|$)/i)?.[0],
    info.match(/COMBUSTÍVEL:\s*\w+/i)?.[0],
    info.includes("No estado") ? "No estado" : "",
  ].filter(Boolean);

  return {
    id,
    url,
    brand: brandModel.brand,
    model: brandModel.model,
    year,
    modelYear,
    price: Math.round(price),
    bodyType,
    mileageKm: mileage,
    city,
    state,
    notes: notesParts.join(" | "),
    infoBlock: info,
    status,
    comitente,
  };
}

function titleFromHtml(html: string): string {
  const raw =
    html.match(/property="og:title"\s+content="([^"]+)"/i)?.[1] ??
    html.match(/<title>([^<]+)<\/title>/i)?.[1] ??
    "";
  return decodeEntities(raw);
}

function runCheckDamage(text: string): { blocked: boolean; reasons: string[] } {
  // Strip common legal "eventual sinistro" disclaimers so they do not trip the gate
  const cleaned = text.replace(
    /eventual\s+sinistro[^.]{0,80}\.?/gi,
    " ",
  );
  const r = detectDamageSignals(cleaned);
  return { blocked: r.blocked, reasons: r.reasons };
}

function sellerTypeFor(p: Parsed): "auction" | "bank_recovery" | "caixa_recovery" {
  const c = (p.comitente ?? "").toLowerCase();
  const n = p.notes.toLowerCase();
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

function writeLead(p: Parsed): { ok: boolean; out: string } {
  const args = [
    "scripts/ingestion/write-lead.ts",
    "--brand",
    p.brand,
    "--model",
    p.model,
    "--year",
    String(p.year),
    "--price",
    String(p.price),
    "--source-url",
    p.url,
    "--source-platform",
    "MGL",
    "--seller-type",
    sellerTypeFor(p),
    "--body-type",
    p.bodyType,
    "--mileage",
    p.mileageKm == null ? "null" : String(p.mileageKm),
    "--notes",
    p.notes,
  ];
  if (p.modelYear) {
    args.push("--model-year", String(p.modelYear));
  }
  if (p.city) args.push("--city", p.city);
  if (p.state) args.push("--state", p.state);

  const res = spawnSync("./node_modules/.bin/tsx", args, {
    cwd: ROOT,
    encoding: "utf8",
  });
  const out = `${res.stdout ?? ""}${res.stderr ?? ""}`.trim();
  return { ok: res.status === 0, out };
}

function main() {
  const list = JSON.parse(readFileSync(LIST_JSON, "utf8")) as {
    lots: MglListLotRow[];
    auctions?: Record<string, number>;
  };
  const byId = new Map(list.lots.map((l) => [l.id, l]));
  const files = readdirSync(LOTS_DIR).filter((f) => f.endsWith(".html"));
  const CEILING = 1000;

  const tally = {
    source: "MGL",
    found: list.lots.length,
    auctions: list.auctions ?? {},
    fetched: files.length,
    written: 0,
    created: 0,
    updated: 0,
    merged: 0,
    skipped: [] as { id: number; reason: string }[],
    damaged: [] as { id: number; reasons: string[] }[],
    writeErrors: [] as { id: number; out: string }[],
    writtenIds: [] as number[],
    ceiling: CEILING,
    applyGoalFilter: false,
  };

  for (const file of files) {
    if (tally.written >= CEILING) {
      tally.skipped.push({
        id: Number(file.replace(/\.html$/, "")),
        reason: "ceiling 1000",
      });
      continue;
    }
    const id = Number(file.replace(/\.html$/, ""));
    const listRow = byId.get(id);
    if (!listRow) {
      tally.skipped.push({ id, reason: "not in current lots-all.json" });
      continue;
    }
    const html = readFileSync(join(LOTS_DIR, file), "utf8");
    if (/Attention Required!\s*\|\s*Cloudflare/i.test(html) || html.length < 5000) {
      tally.skipped.push({ id, reason: "bad/cloudflare html" });
      continue;
    }
    const parsed = parseMglLot(id, listRow.url, html, listRow);
    if (parsed.skipReason) {
      tally.skipped.push({ id, reason: parsed.skipReason });
      continue;
    }

    // Damage gate: Informações + title/url (batidos auctions often only tag salvage there)
    const dmg = runCheckDamage(
      [parsed.infoBlock, parsed.notes, listRow.url, titleFromHtml(html)].join("\n"),
    );
    if (dmg.blocked) {
      tally.damaged.push({ id, reasons: dmg.reasons });
      tally.skipped.push({
        id,
        reason: `damage: ${dmg.reasons.join(",")}`,
      });
      continue;
    }

    const result = writeLead(parsed);
    if (!result.ok) {
      tally.writeErrors.push({ id, out: result.out.slice(0, 400) });
      tally.skipped.push({ id, reason: `write-lead: ${result.out.slice(0, 120)}` });
      continue;
    }
    tally.written += 1;
    tally.writtenIds.push(id);
    if (/"created"\s*:\s*true/i.test(result.out)) tally.created += 1;
    else if (/"merged"\s*:\s*true/i.test(result.out)) tally.merged += 1;
    else if (/"updated"\s*:\s*true/i.test(result.out)) tally.updated += 1;
    console.log(
      `OK ${id} ${parsed.brand} ${parsed.model} ${parsed.year} R$${parsed.price} ${parsed.bodyType} ${sellerTypeFor(parsed)}`,
    );
    console.log(result.out);
  }

  writeFileSync(TALLY_OUT, JSON.stringify(tally, null, 2));
  console.log("\n=== TALLY ===");
  console.log(JSON.stringify(tally, null, 2));
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main();
}
