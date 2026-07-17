import { describe, it, expect } from "vitest";
import { computeGoalFit } from "@/lib/scoring/goalFit";
import type { BodyType, BuyingGoal, Car } from "@/lib/types";

const MAPFRE_NOTES = `Sinistro: COLISÃO (360923126000089)
Monta: MEDIA MONTA`;

function baseGoal(): BuyingGoal {
  return {
    id: "goal-1",
    name: "Test",
    active: true,
    budgetMinBRL: 40000,
    budgetMaxBRL: 100000,
    minYear: 2020,
    maxMileageKm: 80000,
    requiredFeatures: [],
    preferredBodyTypes: ["suv"],
    preferredBrands: ["Volkswagen"],
    excludedBrandsModels: [],
    fuelEconomyThresholdKmL: 10,
    minResaleLiquidityScore: 50,
    familySpaceRequired: false,
  };
}

function baseCar(overrides: Partial<Car> = {}): Car {
  return {
    id: "car-1",
    brand: "Volkswagen",
    model: "T-Cross",
    trim: "",
    year: 2024,
    modelYear: 2024,
    mileageKm: 30000,
    askingPriceBRL: 47900,
    city: "João Pessoa",
    state: "PB",
    sellerType: "bank_recovery",
    fuel: "flex",
    transmission: "automatic",
    bodyType: "suv" as BodyType,
    color: "Branco",
    sourceUrl: "https://leiloespb.com.br/lote/40329",
    sourcePlatform: "Leilões PB",
    notes: "askingPriceBRL = minimum bid (lance mínimo).",
    attachments: [],
    photos: [],
    pipelineStage: "new_lead",
    createdAt: "2026-07-14",
    updatedAt: "2026-07-14",
    fipeValueBRL: null,
    ...overrides,
  };
}

describe("computeGoalFit damage gate", () => {
  it("hard-rejects cars with collision / monta in notes", () => {
    const match = computeGoalFit(baseCar({ notes: MAPFRE_NOTES }), baseGoal());
    expect(match.score).toBe(0);
    expect(match.failedCriteria.join(" ")).toMatch(/Damage\/sinistro/i);
    expect(match.failedCriteria.join(" ")).toMatch(/colisão/i);
  });

  it("does not reject sem sinistro / conservado notes", () => {
    const match = computeGoalFit(
      baseCar({ notes: "Veículo conservado, sem sinistro aparente." }),
      baseGoal(),
    );
    expect(match.score).toBeGreaterThan(0);
  });
});
