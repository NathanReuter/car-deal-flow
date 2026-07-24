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

describe("computeGoalFit body type gate", () => {
  it("hard-rejects a car whose body type is outside preferredBodyTypes", () => {
    const match = computeGoalFit(baseCar({ bodyType: "hatch" as BodyType }), baseGoal());
    expect(match.score).toBe(0);
    expect(match.failedCriteria.join(" ")).toMatch(/hatch/i);
    expect(match.failedCriteria.join(" ")).toMatch(/preferred body type/i);
  });

  it("does not gate when preferredBodyTypes is empty (no preference set)", () => {
    const match = computeGoalFit(
      baseCar({ bodyType: "hatch" as BodyType }),
      { ...baseGoal(), preferredBodyTypes: [] },
    );
    expect(match.score).toBeGreaterThan(0);
  });

  it("passes a car whose body type matches preferredBodyTypes", () => {
    const match = computeGoalFit(baseCar({ bodyType: "suv" as BodyType }), baseGoal());
    expect(match.score).toBeGreaterThan(0);
  });
});

describe("computeGoalFit discontinued-risk gate", () => {
  it("hard-rejects a brand with paralyzed/exited Brazil operations", () => {
    const match = computeGoalFit(
      baseCar({ brand: "Subaru", model: "Forester", bodyType: "suv" as BodyType }),
      { ...baseGoal(), preferredBrands: [] },
    );
    expect(match.score).toBe(0);
    expect(match.failedCriteria.join(" ")).toMatch(/ended commercial operations/i);
  });

  it("hard-rejects a discontinued model with no successor", () => {
    const match = computeGoalFit(
      baseCar({ brand: "Mitsubishi", model: "Pajero Sport", bodyType: "suv" as BodyType }),
      { ...baseGoal(), preferredBrands: [] },
    );
    expect(match.score).toBe(0);
    expect(match.failedCriteria.join(" ")).toMatch(/no confirmed successor/i);
  });

  it("does not gate an unrelated model from the same brand", () => {
    const match = computeGoalFit(
      baseCar({ brand: "Mitsubishi", model: "Outlander", bodyType: "suv" as BodyType }),
      { ...baseGoal(), preferredBrands: [] },
    );
    expect(match.score).toBeGreaterThan(0);
  });
});

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

describe("computeGoalFit Creta CarPlay trim gate", () => {
  it("hard-rejects Creta Action", () => {
    const match = computeGoalFit(
      baseCar({ brand: "Hyundai", model: "CRETA", trim: "Action", bodyType: "suv" as BodyType }),
      { ...baseGoal(), preferredBrands: [] },
    );
    expect(match.score).toBe(0);
    expect(match.failedCriteria.join(" ")).toMatch(/Action/i);
  });

  it("parks unknown Creta trim at score 40", () => {
    const match = computeGoalFit(
      baseCar({ brand: "Hyundai", model: "CRETA", trim: "", bodyType: "suv" as BodyType }),
      { ...baseGoal(), preferredBrands: [] },
    );
    expect(match.score).toBe(40);
    expect(match.failedCriteria.join(" ")).toMatch(/trim unknown/i);
  });

  it("allows Creta Limited", () => {
    const match = computeGoalFit(
      baseCar({ brand: "Hyundai", model: "Creta", trim: "Limited", bodyType: "suv" as BodyType }),
      { ...baseGoal(), preferredBrands: [] },
    );
    expect(match.score).toBeGreaterThan(40);
  });
});

describe("computeGoalFit budget uses landed cost", () => {
  it("fails budget when landed (ask+frete+fees) exceeds soft max but ask alone would pass", () => {
    // soft max = 100000 * 1.05 = 105000
    // ask 100000 in GO auction → landed 100000+2600+5000+1200+1700 = 110500
    const match = computeGoalFit(
      baseCar({
        askingPriceBRL: 100_000,
        city: "Goiânia",
        state: "GO",
        dealPhase: "auction",
      }),
      baseGoal(),
    );
    expect(match.failedCriteria.some((c) => c.startsWith("Budget"))).toBe(true);
  });

  it("passes budget for same ask in SC market (frete 0, no auction fees)", () => {
    const match = computeGoalFit(
      baseCar({
        askingPriceBRL: 100_000,
        city: "Florianópolis",
        state: "SC",
        dealPhase: "market",
      }),
      baseGoal(),
    );
    expect(match.matchedCriteria.some((c) => c.startsWith("Budget"))).toBe(true);
  });
});
