import type { FuelType } from "@/lib/types";

const BASE = "https://parallelum.com.br/fipe/api/v2/cars";
const TIMEOUT_MS = 10_000;

export interface FipeMatch { valueBRL: number; matchedModel: string; referenceMonth: string }
export class FipeError extends Error {
  constructor(message: string) { super(message); this.name = "FipeError"; }
}

interface Ref { codigo: string; nome: string }

const norm = (s: string) =>
  s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

const FUEL_TOKEN: Record<FuelType, RegExp> = {
  flex: /flex/i,
  gasoline: /gasolin/i,
  diesel: /diesel/i,
  hybrid: /h[íi]brid/i,
  electric: /el[ée]tric/i,
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new FipeError(`FIPE request failed (${res.status}) for ${url}`);
  return (await res.json()) as T;
}

function pickBrand(brands: Ref[], brand: string): Ref {
  const target = norm(brand);
  const hit = brands.find((b) => norm(b.nome).includes(target) || target.includes(norm(b.nome).slice(0, 4)));
  if (!hit) throw new FipeError(`No FIPE brand matches "${brand}"`);
  return hit;
}

function pickModel(models: Ref[], model: string): Ref {
  const target = norm(model);
  const matches = models.filter((m) => norm(m.nome).includes(target));
  if (matches.length === 0) throw new FipeError(`No FIPE model matches "${model}"`);
  // Documented product decision: resolve trim ambiguity to the shortest (base) name.
  return matches.sort((a, b) => a.nome.length - b.nome.length)[0];
}

function pickYear(years: Ref[], year: number, fuel?: FuelType): Ref {
  const matches = years.filter((y) => y.codigo.startsWith(String(year)) || y.nome.startsWith(String(year)));
  if (matches.length === 0) throw new FipeError(`No FIPE year entry for ${year}`);
  if (matches.length === 1) return matches[0];
  // Multiple fuel variants share the year — disambiguate by fuel, else fail closed.
  if (fuel) {
    const byFuel = matches.filter((m) => FUEL_TOKEN[fuel].test(m.nome));
    if (byFuel.length === 1) return byFuel[0];
  }
  throw new FipeError(`Ambiguous FIPE year entries for ${year} (${matches.length} fuel variants) — cannot resolve confidently`);
}

function parseBRL(v: string): number {
  const digits = v.replace(/[^0-9,]/g, "").replace(/\./g, "").split(",")[0];
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) throw new FipeError(`Unparseable FIPE value "${v}"`);
  return n;
}

export async function findFipeValue(
  input: { brand: string; model: string; year: number; modelYear?: number; fuel?: FuelType },
): Promise<FipeMatch> {
  const brands = await getJson<Ref[]>(`${BASE}/brands`);
  const brand = pickBrand(brands, input.brand);

  const modelsResp = await getJson<{ modelos?: Ref[] } | Ref[]>(`${BASE}/brands/${brand.codigo}/models`);
  const models = Array.isArray(modelsResp) ? modelsResp : (modelsResp.modelos ?? []);
  const model = pickModel(models, input.model);

  const years = await getJson<Ref[]>(`${BASE}/brands/${brand.codigo}/models/${model.codigo}/years`);
  const year = pickYear(years, input.modelYear ?? input.year, input.fuel);

  const detail = await getJson<{ Valor: string; Modelo: string; MesReferencia: string }>(
    `${BASE}/brands/${brand.codigo}/models/${model.codigo}/years/${year.codigo}`,
  );

  return { valueBRL: parseBRL(detail.Valor), matchedModel: detail.Modelo, referenceMonth: detail.MesReferencia };
}
