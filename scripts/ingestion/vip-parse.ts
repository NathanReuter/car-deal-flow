import { detectDamageSignals } from "../../src/lib/filters/damageSignals";
import type { BodyType, SellerType } from "../../src/lib/types";
import { inferBodyType, parseBrl, parseKm } from "./lib/parse-common";
import { shouldSkipListing } from "./lib/listing-filters";
import type { WriteLeadInput } from "./write-lead";

export type VipDetail = {
  event: string;
  url: string;
  title: string;
  fields: Record<string, string>;
  ofertaInicial: string | null;
  valorAtual: string | null;
  editalUrl: string | null;
};

const NON_CAR =
  /\b(moto|motocicleta|scooter|bike|quadriciclo|triciclo|caminh[aã]o|truck|onibus|ônibus|micro[oô]nibus|van\s+escolar|reboque|carreta|semirreboque|implemento|empilhadeira|trator|m[aá]quina|jet\s*ski|lancha|barco|embarca[cç][aã]o|sr3e|frig|bitrem|toco|truck\b|\bcg\s*\d|\bnxr|\bxre\s*\d|\bcb\s*\d|\bpop\s*\d|fazer|factor|ybr|pcx|\bcrf\s*|xmax|bros|randon|bertolini|facchini)/i;

export function parseVipYear(ano: string | null | undefined): number | null {
  if (!ano) return null;
  const m = ano.match(/(\d{4})\s*\/\s*(\d{4})/) || ano.match(/(\d{4})/);
  if (!m) return null;
  const y = Number(m[1]);
  return y >= 1980 && y <= 2030 ? y : null;
}

export function parseVipModelYear(ano: string | null | undefined): number | null {
  if (!ano) return null;
  const m = ano.match(/(\d{4})\s*\/\s*(\d{4})/);
  if (!m) return null;
  const y = Number(m[2]);
  return y >= 1980 && y <= 2030 ? y : null;
}

export function parseVipBrandModel(veiculo: string): { brand: string; model: string } | null {
  if (!veiculo) return null;
  const parts = veiculo.split(/\s*-\s*/);
  if (parts.length < 2) return null;
  const brand = parts[0].trim();
  const model = parts.slice(1).join(" - ").trim();
  if (!brand || !model) return null;
  return { brand, model };
}

export function parseVipCityState(loc: string | null | undefined): { city?: string; state?: string } {
  if (!loc) return {};
  const m = loc.match(/,\s*([^,]+),\s*([A-Z]{2})\s*-\s*CEP/i);
  if (m) return { city: m[1].trim(), state: m[2].toUpperCase() };
  const m2 = loc.match(/-\s*([A-Z]{2})\b/);
  if (m2) return { state: m2[1].toUpperCase() };
  return {};
}

export function sellerTypeFromComitente(comitente: string): SellerType {
  const c = (comitente || "").toUpperCase();
  if (/CAIXA/.test(c)) return "caixa_recovery";
  if (
    /BRADESCO|SANTANDER|ITA[UÚ]|BV\b|OMNI|PAN\b|SAFRA|VOTORANTIM|BANCO|FINANC|CREDITAS|DAYCOVAL|BMG|BANRISUL|SICREDI|SICOOB|AILOS|PORTO\s*SEGURO\s*BANK|C6\b|INTER\b/.test(
      c,
    )
  ) {
    return "bank_recovery";
  }
  return "auction";
}

export function buildVipNotes(d: VipDetail): string {
  const f = d.fields;
  const parts: string[] = [];
  if (f["Procedência"]) parts.push(`Procedência: ${f["Procedência"]}`);
  if (f["Sinistro"]) parts.push(`Sinistro: ${f["Sinistro"]}`);
  if (f["Monta"]) parts.push(`Monta: ${f["Monta"]}`);
  if (f["Observações"]) parts.push(`Observações: ${f["Observações"]}`);
  if (f["Comitente"]) parts.push(`Comitente: ${f["Comitente"]}`);
  if (f["Funcionando na Entrada"]) parts.push(`Funcionando: ${f["Funcionando na Entrada"]}`);
  if (f["Chave"]) parts.push(`Chave: ${f["Chave"]}`);
  return parts.join(" | ");
}

export function parseVipLead(
  d: VipDetail,
  options?: { excludeInsurer?: boolean },
): { input?: WriteLeadInput; skip?: string; detail?: string } {
  const f = d.fields;
  const veiculo = f["Veículo"] || d.title || "";
  const notes = buildVipNotes(d);

  const insurerSkip = shouldSkipListing({
    comitente: f["Comitente"],
    excludeInsurer: options?.excludeInsurer,
  });
  if (insurerSkip.skip) {
    return { skip: insurerSkip.reason ?? "insurer_comitente" };
  }

  const damage = detectDamageSignals(`${notes} ${veiculo} ${f["Procedência"] || ""}`);
  if (damage.blocked) return { skip: "damage", detail: damage.reasons.join(",") };

  const bm = parseVipBrandModel(veiculo);
  if (!bm) return { skip: "missing_brand_model" };
  if (NON_CAR.test(veiculo) || NON_CAR.test(bm.model)) return { skip: "non_car" };

  const year = parseVipYear(f["Ano"]);
  if (!year) return { skip: "missing_year" };

  const price =
    parseBrl(d.ofertaInicial) ??
    parseBrl(d.valorAtual) ??
    parseBrl(f["Oferta Inicial"]) ??
    parseBrl(f["Valor Atual"]);
  if (!price) return { skip: "missing_price" };

  const bodyType = inferBodyType(bm.brand, bm.model, veiculo) as BodyType | null;
  if (!bodyType) return { skip: "unclear_bodyType", detail: veiculo.slice(0, 60) };

  const mileageKm = parseKm(f["KM"]);
  const { city, state } = parseVipCityState(f["Localização"]);
  const sellerType = sellerTypeFromComitente(f["Comitente"] || "");
  const modelYear = parseVipModelYear(f["Ano"]);
  const plateFinal = f["Final da placa"] || "";
  const fullNotes = [
    notes,
    plateFinal ? `Final placa: ${plateFinal}` : "",
    modelYear ? `Ano modelo: ${modelYear}` : "",
  ]
    .filter(Boolean)
    .join(" | ");

  let editalUrl: string | undefined;
  if (d.editalUrl) {
    editalUrl = d.editalUrl.startsWith("http")
      ? d.editalUrl
      : `https://www.vipleiloes.com.br${d.editalUrl}`;
  }

  return {
    input: {
      brand: bm.brand,
      model: bm.model,
      year,
      modelYear: modelYear ?? undefined,
      askingPriceBRL: price,
      sourceUrl: d.url,
      sourcePlatform: "VIP Leilões",
      sellerType,
      bodyType,
      mileageKm: mileageKm ?? null,
      city,
      state,
      notes: fullNotes,
      editalUrl,
    },
  };
}

export function extractVipTableFields(html: string): Record<string, string> {
  const map: Record<string, string> = {};
  const re = /<th[^>]*>\s*([^<]+?)\s*<\/th>\s*<td[^>]*>\s*([\s\S]*?)\s*<\/td>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const th = m[1].replace(/\s+/g, " ").trim();
    const td = m[2]
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (!map[th]) map[th] = td;
  }
  return map;
}

export function extractVipDetailFromHtml(
  html: string,
  url: string,
  event: string,
): VipDetail {
  const fields = extractVipTableFields(html);
  const titleMatch =
    html.match(/<meta\s+property="og:title"\s+content="([^"]+)"/i) ||
    html.match(/<h1[^>]*>\s*([^<]+)\s*<\/h1>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, " ").trim() : "";

  const oferta =
    html.match(/Oferta\s+Inicial[^R]*R\$\s*([\d.]+,\d{2})/i) ||
    html.match(/Valor\s+inicial[:\s]*R\$\s*([\d.]+,\d{2})/i);
  const atual = html.match(/Valor\s+Atual[^R]*R\$\s*([\d.]+,\d{2})/i);
  const edital =
    html.match(/href="([^"]*edital[^"]*\.pdf[^"]*)"/i) ||
    html.match(/href="([^"]+\.pdf)"/i);

  let ofertaInicial = oferta ? oferta[1] : null;
  let valorAtual = atual ? atual[1] : null;
  if (!ofertaInicial && fields["Oferta Inicial"]) {
    const m = String(fields["Oferta Inicial"]).match(/([\d.]+,\d{2})/);
    if (m) ofertaInicial = m[1];
  }
  if (!valorAtual && fields["Valor Atual"]) {
    const m = String(fields["Valor Atual"]).match(/([\d.]+,\d{2})/);
    if (m) valorAtual = m[1];
  }

  return {
    event,
    url,
    title,
    fields,
    ofertaInicial,
    valorAtual,
    editalUrl: edital ? edital[1] : null,
  };
}

export function extractFinanceiraEventIds(html: string): string[] {
  const ids = new Set<string>();
  const re = /\/evento\/detalhes\/([a-z0-9]+)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    const id = m[1];
    if (/\d{6}bs/i.test(id)) ids.add(id);
  }

  // Financeiras label near event link (broader than bs* slug pattern alone)
  const labeled = /Financeiras?[\s\S]{0,300}?\/evento\/detalhes\/([a-z0-9]+)/gi;
  while ((m = labeled.exec(html)) !== null) {
    ids.add(m[1]);
  }

  return [...ids];
}
