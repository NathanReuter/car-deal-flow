export type FreteSource =
  | "local"
  | "city"
  | "uf_capital"
  | "uf_band"
  | "unknown_assumed";

export type FreightResolve = {
  freteBRL: number;
  freteSource: FreteSource;
  notes: string[];
};

/** Midpoints of Tabela 1 ranges (cegonha compartilhada → Florianópolis/SC). */
export const CITY_FREIGHT_MID_BRL: Record<string, number> = {
  goiania: 2600,
  brasilia: 2750,
  "sao paulo": 1098,
  "rio de janeiro": 1750,
  "belo horizonte": 1900,
  curitiba: 775,
  "porto alegre": 1000,
  salvador: 3850,
  recife: 4450,
  manaus: 6500,
};

/** UF → normalized capital name present in CITY_FREIGHT_MID_BRL. */
export const UF_CAPITAL: Record<string, string> = {
  GO: "goiania",
  DF: "brasilia",
  SP: "sao paulo",
  RJ: "rio de janeiro",
  MG: "belo horizonte",
  PR: "curitiba",
  RS: "porto alegre",
  BA: "salvador",
  PE: "recife",
  AM: "manaus",
};

/** Regra prática band midpoints for UFs without a capital row. */
export const FREIGHT_BAND_SHORT_BRL = 1250; // mid(900, 1600)
export const FREIGHT_BAND_MID_BRL = 2200; // mid(1600, 2800)
export const FREIGHT_BAND_LONG_BRL = 4150; // mid(2800, 5500)

/** UFs not in UF_CAPITAL → band (South short / SE-CO mid / N-NE long). */
export const UF_FREIGHT_BAND_BRL: Record<string, number> = {
  // Mid haul (SE / Centro-Oeste leftovers)
  ES: FREIGHT_BAND_MID_BRL,
  MT: FREIGHT_BAND_MID_BRL,
  MS: FREIGHT_BAND_MID_BRL,
  // Long haul (N / NE leftovers)
  AC: FREIGHT_BAND_LONG_BRL,
  AL: FREIGHT_BAND_LONG_BRL,
  AP: FREIGHT_BAND_LONG_BRL,
  CE: FREIGHT_BAND_LONG_BRL,
  MA: FREIGHT_BAND_LONG_BRL,
  PA: FREIGHT_BAND_LONG_BRL,
  PB: FREIGHT_BAND_LONG_BRL,
  PI: FREIGHT_BAND_LONG_BRL,
  RN: FREIGHT_BAND_LONG_BRL,
  RO: FREIGHT_BAND_LONG_BRL,
  RR: FREIGHT_BAND_LONG_BRL,
  SE: FREIGHT_BAND_LONG_BRL,
  TO: FREIGHT_BAND_LONG_BRL,
};

export function normalizePlace(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, " ");
}

export function resolveFreightBRL(city: string, state: string): FreightResolve {
  const uf = (state ?? "").trim().toUpperCase();
  if (uf === "SC") {
    return { freteBRL: 0, freteSource: "local", notes: [] };
  }

  const cityKey = normalizePlace(city ?? "");
  if (cityKey && CITY_FREIGHT_MID_BRL[cityKey] != null) {
    return {
      freteBRL: CITY_FREIGHT_MID_BRL[cityKey],
      freteSource: "city",
      notes: [],
    };
  }

  const capital = UF_CAPITAL[uf];
  if (capital != null && CITY_FREIGHT_MID_BRL[capital] != null) {
    return {
      freteBRL: CITY_FREIGHT_MID_BRL[capital],
      freteSource: "uf_capital",
      notes: [],
    };
  }

  const band = UF_FREIGHT_BAND_BRL[uf];
  if (band != null) {
    return { freteBRL: band, freteSource: "uf_band", notes: [] };
  }

  return {
    freteBRL: FREIGHT_BAND_LONG_BRL,
    freteSource: "unknown_assumed",
    notes: ["frete_assumed_unknown_origin"],
  };
}
