import type { BodyType } from "./types";

// Curated option lists for the buying-goal editor. Brands and features are
// suggestions (custom entries are allowed in the UI); body types are the closed
// set the scoring engine matches against, so they are list-only.

// Canonical brands, aligned with BRAND_ALIASES in scripts/ingestion/lib/parse-common.ts.
// Kept as a plain list here so src/ does not import from scripts/. Sorted for the picker.
export const BRAND_OPTIONS: string[] = [
  "Audi",
  "BMW",
  "BYD",
  "Caoa Chery",
  "Chery",
  "Chevrolet",
  "Citroën",
  "Fiat",
  "Ford",
  "Honda",
  "Hyundai",
  "Jeep",
  "Kia",
  "Land Rover",
  "Mercedes-Benz",
  "Mini",
  "Mitsubishi",
  "Nissan",
  "Peugeot",
  "Ram",
  "Renault",
  "Toyota",
  "Volkswagen",
  "Volvo",
].sort((a, b) => a.localeCompare(b, "pt-BR"));

// Human-readable labels for the closed BodyType set. Using Record<BodyType, ...>
// forces this to stay exhaustive: adding a BodyType in types.ts breaks the build here.
export const BODY_TYPE_LABELS: Record<BodyType, string> = {
  hatch: "Hatch",
  sedan: "Sedan",
  suv: "SUV",
  pickup: "Pickup",
  minivan: "Minivan",
  coupe: "Coupé",
  wagon: "Wagon (Perua)",
};

export const BODY_TYPE_OPTIONS = Object.keys(BODY_TYPE_LABELS) as BodyType[];

// Common desirable features. Not yet wired into scoring — persisted for now.
export const FEATURE_OPTIONS: string[] = [
  "Câmbio automático",
  "Ar-condicionado digital",
  "Central multimídia",
  "Apple CarPlay / Android Auto",
  "Câmera de ré",
  "Câmera 360°",
  "Sensor de estacionamento",
  "Piloto automático adaptativo (ADAS)",
  "Alerta de ponto cego",
  "Teto solar",
  "Bancos de couro",
  "Bancos com ajuste elétrico",
  "Faróis de LED",
  "Painel digital",
  "Partida sem chave (keyless)",
  "Controle de tração e estabilidade",
];
