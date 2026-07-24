import type { FuelType, Transmission } from "@/lib/types";
import { FipeError } from "@/lib/integrations/fipe-error";
import { rankFipeModels, selectFipeModel } from "@/lib/integrations/fipe-model-match";

export { FipeError };

const BASE = "https://parallelum.com.br/fipe/api/v2/cars";
const TIMEOUT_MS = 10_000;

export interface FipeMatch { valueBRL: number; matchedModel: string; referenceMonth: string }

/** Parallelum FIPE API v2 reference row (`code`/`name`, not v1 `codigo`/`nome`). */
interface Ref { code: string; name: string }

const norm = (s: string) =>
  (s ?? "").toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]/g, "");

const FUEL_TOKEN: Record<FuelType, RegExp> = {
  flex: /flex/i,
  gasoline: /gasolin/i,
  diesel: /diesel/i,
  hybrid: /h[íi]brid/i,
  electric: /el[ée]tric/i,
};

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  // installCachedFetch caches this resolved Response (including 429s) by URL,
  // so retrying here would just replay the same cached failure — no backoff
  // helps until the caller stops hitting the API. See syncMissingFipe's
  // circuit breaker.
  if (!res.ok) throw new FipeError(`FIPE request failed (${res.status}) for ${url}`);
  return (await res.json()) as T;
}

function pickBrand(brands: Ref[], brand: string): Ref {
  const target = norm(brand);
  if (!target) throw new FipeError(`No FIPE brand matches "${brand}"`);
  const hit = brands.find((b) => {
    const n = norm(b.name);
    return n.includes(target) || target.includes(n.slice(0, 4));
  });
  if (!hit) throw new FipeError(`No FIPE brand matches "${brand}"`);
  return hit;
}

function pickYear(years: Ref[], year: number, fuel?: FuelType): Ref {
  const matches = years.filter((y) => y.code.startsWith(String(year)) || y.name.startsWith(String(year)));
  if (matches.length === 0) throw new FipeError(`No FIPE year entry for ${year}`);
  if (matches.length === 1) return matches[0];
  // Multiple fuel variants share the year — disambiguate by fuel, else fail closed.
  if (fuel && FUEL_TOKEN[fuel]) {
    const byFuel = matches.filter((m) => FUEL_TOKEN[fuel].test(m.name));
    if (byFuel.length === 1) return byFuel[0];
  }
  throw new FipeError(`Ambiguous FIPE year entries for ${year} (${matches.length} fuel variants) — cannot resolve confidently`);
}

function parseBRL(v: string): number {
  const digits = (v ?? "").replace(/[^0-9,]/g, "").replace(/\./g, "").split(",")[0];
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) throw new FipeError(`Unparseable FIPE value "${v}"`);
  return n;
}

export async function findFipeValue(
  input: {
    brand: string;
    model: string;
    trim?: string;
    year: number;
    modelYear?: number;
    fuel?: FuelType;
    transmission?: Transmission;
  },
): Promise<FipeMatch> {
  const brands = await getJson<Ref[]>(`${BASE}/brands`);
  const brand = pickBrand(brands, input.brand);

  const modelsResp = await getJson<{ modelos?: Ref[] } | Ref[]>(`${BASE}/brands/${brand.code}/models`);
  const models = Array.isArray(modelsResp) ? modelsResp : (modelsResp.modelos ?? []);

  // Auction listings rarely carry a distinctive trim, so several catalog rows
  // often tie on score (e.g. every "Onix 1.0" trim since 2014). Picking the
  // top tie arbitrarily can land on a discontinued row missing this car's
  // year. Walk the candidates tied for the top score and keep the first
  // whose years list actually covers the target year, instead of committing
  // up front. Candidates below the top score are a worse family/trim match,
  // not a tie, so they're not worth the extra requests.
  const ranked = rankFipeModels(models, input.model, input.trim ?? "", {
    transmission: input.transmission,
  });
  if (ranked.length === 0) {
    // Preserve the existing fail-closed error (missing distinctive trim, etc).
    selectFipeModel(models, input.model, input.trim ?? "", { transmission: input.transmission });
  }
  const topScore = ranked[0]?.score;
  const tied = ranked.filter((r) => r.score === topScore);

  let lastErr: FipeError | undefined;
  for (const { model } of tied) {
    let years: Ref[];
    let year: Ref;
    try {
      years = await getJson<Ref[]>(`${BASE}/brands/${brand.code}/models/${model.code}/years`);
      year = pickYear(years, input.modelYear ?? input.year, input.fuel);
    } catch (e) {
      if (!(e instanceof FipeError)) throw e;
      lastErr = e;
      continue;
    }

    const detail = await getJson<{
      price?: string;
      Valor?: string;
      model?: string;
      Modelo?: string;
      referenceMonth?: string;
      MesReferencia?: string;
    }>(`${BASE}/brands/${brand.code}/models/${model.code}/years/${year.code}`);

    const price = detail.price ?? detail.Valor;
    const matchedModel = detail.model ?? detail.Modelo;
    const referenceMonth = detail.referenceMonth ?? detail.MesReferencia;
    if (!price || !matchedModel || !referenceMonth) {
      throw new FipeError("FIPE detail response missing price/model/referenceMonth");
    }

    return { valueBRL: parseBRL(price), matchedModel, referenceMonth };
  }

  throw (
    lastErr ??
    new FipeError(`No FIPE year entry for ${input.modelYear ?? input.year} among tied matching models`)
  );
}
