import { describe, it, expect } from "vitest";
import { computeGoalFit } from "@/lib/scoring/goalFit";
import { computeMarketAssessment } from "@/lib/scoring/market";
import { computeDecision } from "@/lib/scoring/decision";
import { formatKm, formatFipe } from "@/lib/format";
import type { BuyingGoal, Car, ConditionReview, RiskCheck } from "@/lib/types";

function baseCar(overrides: Partial<Car> = {}): Car {
  return {
    id: "car-1",
    brand: "Hyundai",
    model: "Creta",
    trim: "Limited",
    year: 2022,
    modelYear: 2022,
    mileageKm: 40000,
    askingPriceBRL: 100000,
    city: "São Paulo",
    state: "SP",
    sellerType: "auction",
    fuel: "flex",
    transmission: "automatic",
    bodyType: "suv",
    color: "White",
    sourceUrl: "https://example.com/1",
    sourcePlatform: "Test",
    notes: "",
    attachments: [],
    photos: [],
    pipelineStage: "new_lead",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    fipeValueBRL: 110000,
    ...overrides,
  };
}

function baseGoal(overrides: Partial<BuyingGoal> = {}): BuyingGoal {
  return {
    id: "goal-1",
    name: "Test",
    active: true,
    budgetMinBRL: 50000,
    budgetMaxBRL: 120000,
    minYear: 2020,
    maxMileageKm: 80000,
    requiredFeatures: [],
    preferredBodyTypes: ["suv"],
    preferredBrands: [],
    excludedBrandsModels: [],
    fuelEconomyThresholdKmL: 10,
    minResaleLiquidityScore: 50,
    familySpaceRequired: false,
    ...overrides,
  };
}

const emptyRisk: RiskCheck = {
  carId: "car-1",
  items: [],
  caixaReview: {
    applicable: false,
    editalReviewed: false,
    hiddenTransferCostsBRL: 0,
    resaleStigmaNote: "",
    historyClarity: "clear",
    legalTransferRiskNote: "",
  },
  score: 70,
};

const emptyCondition: ConditionReview = {
  carId: "car-1",
  fields: [],
  mechanicNotes: "",
  score: 50,
};

describe("null mileage / FIPE scoring", () => {
  it("fails goal-fit mileage criterion when mileage is null", () => {
    const match = computeGoalFit(baseCar({ mileageKm: null }), baseGoal());
    expect(match.failedCriteria.some((c) => c.toLowerCase().includes("mileage"))).toBe(true);
  });

  it("keeps resale liquidity based on body type when mileage is null", () => {
    const withKm = computeMarketAssessment(baseCar({ mileageKm: 20000 }), 110000);
    const withoutKm = computeMarketAssessment(baseCar({ mileageKm: null }), 110000);
    expect(withoutKm.resaleEase).toBe(withKm.resaleEase);
  });

  it("returns unavailable market + null value score when FIPE is null", () => {
    const market = computeMarketAssessment(baseCar({ fipeValueBRL: null }), null);
    expect(market.verdict).toBe("unavailable");
    const decision = computeDecision(baseCar({ fipeValueBRL: null }), baseGoal(), emptyRisk, emptyCondition);
    expect(decision.valueScore).toBeNull();
  });

  it("excludes value weight from decision when FIPE is null", () => {
    const withoutFipe = computeDecision(baseCar({ fipeValueBRL: null }), baseGoal(), emptyRisk, emptyCondition);
    expect(withoutFipe.valueScore).toBeNull();
    expect(withoutFipe.reasoning.some((r) => r.includes("FIPE not synced") || r.includes("value excluded"))).toBe(
      true,
    );
  });

  it("formats null mileage and FIPE", () => {
    expect(formatKm(null)).toBe("—");
    expect(formatFipe(null)).toBe("Not synced");
  });
});
