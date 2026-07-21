// Real-data ingestion — replaces the demo mock dataset with actual vehicles
// the owner is considering. Unlike prisma/seed.ts (which restores curated
// demo data with baseline-verified checklists), this creates genuinely
// unreviewed records: every RiskCheckItem starts "pending" and every
// ConditionField starts "not_inspected" — nothing here has actually been
// checked yet, and the app should never claim otherwise.
//
// Edit REAL_CARS below to add/update real candidates, then run:
//   npx tsx scripts/ingest-real-cars.ts
// This wipes all existing cars (and their attachments/risk-checks/condition
// reviews, via cascade) and replaces them with this list.

import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";
import { requireDatabaseUrl } from "./lib/database-url";
import { findFipeValue, FipeError } from "../src/lib/integrations/fipe";
import type { RiskCheckItem, RiskCheckKey, ConditionField } from "../src/lib/types";

const adapter = new PrismaBetterSqlite3({ url: requireDatabaseUrl() });
const prisma = new PrismaClient({ adapter });

const AUTOMATABLE_AND_MANUAL_KEYS: RiskCheckKey[] = [
  "registration_consistency",
  "chassis_consistency",
  "financing_lien",
  "judicial_restriction",
  "theft_recovery_history",
  "recall_status",
  "auction_history",
  "accident_flags",
  "mileage_inconsistency",
  "overdue_taxes_fines",
  "ownership_count",
  "service_records",
  "manual_key_availability",
];

const CONDITION_FIELDS: { key: string; label: string }[] = [
  { key: "paint_body", label: "Paint / body mismatch" },
  { key: "tires", label: "Tires" },
  { key: "suspension_brakes", label: "Suspension / brakes" },
  { key: "engine", label: "Engine noise / leaks" },
  { key: "transmission_behavior", label: "Transmission behavior" },
  { key: "ac_electronics", label: "AC and electronics" },
  { key: "multimedia", label: "Multimedia quality" },
  { key: "interior_wear", label: "Seat / interior wear" },
  { key: "trunk_family", label: "Trunk / family usability" },
];

interface RealCarInput {
  brand: string;
  model: string;
  trim: string;
  year: number;
  modelYear: number;
  fuel: "flex" | "gasoline" | "diesel" | "hybrid" | "electric";
  transmission: "manual" | "automatic" | "cvt" | "automated_manual";
  bodyType: "hatch" | "sedan" | "suv" | "pickup" | "minivan" | "coupe" | "wagon";
  // Placeholder until a real listing is found — flagged in notes, never
  // presented as verified.
  placeholderMileageKm: number;
  placeholderAskingPriceBRL: number;
  placeholderFipeValueBRL?: number; // used only if the live FIPE match fails
  notes: string;
}

const REAL_CARS: RealCarInput[] = [
  {
    brand: "Hyundai", model: "Creta", trim: "Limited 1.0 Turbo", year: 2022, modelYear: 2022,
    fuel: "flex", transmission: "automatic", bodyType: "suv",
    placeholderMileageKm: 60000, placeholderAskingPriceBRL: 112000,
    notes: "Comparison-stage candidate — no specific listing found yet. Mileage, asking price, city/state, and seller type are placeholders pending a real ad. Top pick: teto solar, câmera 360°, mais completo do grupo.",
  },
  {
    brand: "Volkswagen", model: "T-Cross", trim: "Highline 1.4 200 TSI", year: 2022, modelYear: 2022,
    fuel: "flex", transmission: "automatic", bodyType: "suv",
    placeholderMileageKm: 60000, placeholderAskingPriceBRL: 109000, placeholderFipeValueBRL: 109000,
    notes: "Comparison-stage candidate — no specific listing found yet. Mileage, asking price, city/state, and seller type are placeholders pending a real ad. FIPE value is a manual estimate (user-provided range midpoint): the live FIPE sync could not confidently match the 'Highline' trim in the catalog and refused to guess — rerun 'Sync from FIPE' once a specific listing/trim is confirmed. Differential: motor 1.4 mais potente, maior liquidez VW.",
  },
  {
    brand: "Chevrolet", model: "Tracker", trim: "LTZ 1.2 Turbo", year: 2022, modelYear: 2022,
    fuel: "flex", transmission: "automatic", bodyType: "suv",
    placeholderMileageKm: 60000, placeholderAskingPriceBRL: 99000,
    notes: "Comparison-stage candidate — no specific listing found yet. Mileage, asking price, city/state, and seller type are placeholders pending a real ad. Melhor custo-benefício do grupo, menor preço.",
  },
  {
    brand: "Renault", model: "Duster", trim: "Iconic", year: 2022, modelYear: 2022,
    fuel: "flex", transmission: "automatic", bodyType: "suv",
    placeholderMileageKm: 60000, placeholderAskingPriceBRL: 85000,
    notes: "Comparison-stage candidate — no specific listing found yet. Mileage, asking price, city/state, and seller type are placeholders pending a real ad. Maior porta-malas do grupo (475L), porém menor liquidez de revenda.",
  },
];

function pendingRiskItems(): RiskCheckItem[] {
  return AUTOMATABLE_AND_MANUAL_KEYS.map((key) => ({
    key,
    status: "pending",
    severity: "low",
    notes: "Not yet reviewed.",
  }));
}

function notInspectedFields(): ConditionField[] {
  return CONDITION_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    rating: "not_inspected",
    notes: "Not yet inspected.",
  }));
}

async function main() {
  console.log("Wiping existing cars (and their attachments/risk-checks/condition reviews)...");
  await prisma.car.deleteMany();

  for (const input of REAL_CARS) {
    let fipeValueBRL = input.placeholderFipeValueBRL ?? input.placeholderAskingPriceBRL;
    let fipeNote = "";

    try {
      const result = await findFipeValue(input);
      fipeValueBRL = result.valueBRL;
      fipeNote = ` [Live FIPE match: "${result.matchedModel}", ${result.referenceMonth}]`;
    } catch (e) {
      if (e instanceof FipeError) {
        fipeNote = ` [Live FIPE sync failed: ${e.message}]`;
      } else {
        throw e;
      }
    }

    const car = await prisma.car.create({
      data: {
        brand: input.brand,
        model: input.model,
        trim: input.trim,
        year: input.year,
        modelYear: input.modelYear,
        mileageKm: input.placeholderMileageKm,
        askingPriceBRL: input.placeholderAskingPriceBRL,
        city: "São Paulo",
        state: "SP",
        sellerType: "dealer",
        fuel: input.fuel,
        transmission: input.transmission,
        bodyType: input.bodyType,
        color: "Não informado",
        sourceUrl: "#",
        sourcePlatform: "Not sourced yet — comparison stage",
        notes: input.notes + fipeNote,
        photos: "[]",
        pipelineStage: "researching",
        fipeValueBRL,
      },
    });

    await prisma.riskCheck.create({
      data: {
        carId: car.id,
        items: JSON.stringify(pendingRiskItems()),
        caixaApplicable: false,
        caixaEditalReviewed: false,
        caixaHiddenTransferCosts: 0,
        caixaResaleStigmaNote: "",
        caixaHistoryClarity: "clear",
        caixaLegalTransferRisk: "",
      },
    });

    await prisma.conditionReview.create({
      data: {
        carId: car.id,
        fields: JSON.stringify(notInspectedFields()),
        mechanicNotes: "No inspection performed yet.",
      },
    });

    console.log(`Ingested ${input.brand} ${input.model} ${input.trim} (id=${car.id}, FIPE=${fipeValueBRL})`);
  }

  console.log(`\nDone — ${REAL_CARS.length} real cars ingested, 0 mock cars remain.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
