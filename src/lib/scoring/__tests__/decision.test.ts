import { describe, it, expect } from "vitest";
import { computeDecision } from "../decision";
import type { BuyingGoal, Car, RiskCheck, ConditionReview } from "@/lib/types";

const car = (o: Partial<Car>): Car => ({
  id: "c1", brand: "Volkswagen", model: "T-Cross", trim: "", year: 2022, modelYear: 2022,
  mileageKm: 40000, askingPriceBRL: 100000, city: "SP", state: "SP", sellerType: "dealer",
  fuel: "flex", transmission: "automatic", bodyType: "suv", color: "white",
  sourceUrl: "https://x", sourcePlatform: "OLX", notes: "", attachments: [], photos: [],
  pipelineStage: "new_lead", createdAt: "", updatedAt: "", fipeValueBRL: null, ...o,
});
const goal: BuyingGoal = {
  id: "g1", name: "g", active: true, budgetMinBRL: 60000, budgetMaxBRL: 1000000, minYear: 2021,
  maxMileageKm: 90000, requiredFeatures: [], preferredBodyTypes: ["suv", "sedan", "hatch"],
  preferredBrands: [], excludedBrandsModels: [], fuelEconomyThresholdKmL: 10,
  minResaleLiquidityScore: 50, familySpaceRequired: false,
};
const risk = (o: Partial<RiskCheck> = {}): RiskCheck => ({
  carId: "c1", items: [], caixaReview: { applicable: false, editalReviewed: false, hiddenTransferCostsBRL: 0, resaleStigmaNote: "", historyClarity: "clear", legalTransferRiskNote: "" }, score: 100, ...o,
});
const cond: ConditionReview = { carId: "c1", fields: [], mechanicNotes: "", score: 80 };

describe("computeDecision", () => {
  it("excludes value from the blend and renormalizes when FIPE is null", () => {
    const d = computeDecision(car({ fipeValueBRL: null }), goal, risk(), cond);
    expect(d.valueScore).toBeNull();
    const sum = d.weights.goalFit + d.weights.documentationRisk + d.weights.condition + d.weights.resaleLiquidity;
    expect(sum).toBeCloseTo(1, 5);
    expect(d.weights.value).toBe(0);
    expect(d.finalScore).toBeGreaterThan(0);
  });
  it("a severe failed risk check gates the verdict to avoid", () => {
    const gated = risk({ items: [{ key: "judicial_restriction", status: "failed", severity: "severe", notes: "" }], score: 10 });
    const d = computeDecision(car({ fipeValueBRL: 100000 }), goal, gated, cond);
    expect(d.severeRiskGate).toBe(true);
    expect(d.verdict).toBe("avoid");
  });
  it("manual override wins", () => {
    const d = computeDecision(car({ manualVerdictOverride: "safe_buy" }), goal, risk(), cond);
    expect(d.manualOverrideApplied).toBe(true);
    expect(d.verdict).toBe("safe_buy");
  });
});
