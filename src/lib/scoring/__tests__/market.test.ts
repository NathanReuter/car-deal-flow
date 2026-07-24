import { describe, it, expect } from "vitest";
import { computeMarketAssessment } from "../market";
import type { Car } from "@/lib/types";

// Default fixture is a local SC market car so landed ≈ ask; the landed-cost
// cases below opt into out-of-SC / auction origins explicitly.
const car = (o: Partial<Car>): Car => ({
  id: "c1", brand: "Toyota", model: "Corolla", trim: "XEI", year: 2022, modelYear: 2022,
  mileageKm: 40000, askingPriceBRL: 100000, city: "Florianópolis", state: "SC",
  dealPhase: "market", sellerType: "dealer",
  fuel: "flex", transmission: "automatic", bodyType: "sedan", color: "white",
  sourceUrl: "https://x", sourcePlatform: "OLX", notes: "", attachments: [], photos: [],
  pipelineStage: "new_lead", createdAt: "", updatedAt: "", fipeValueBRL: null, ...o,
});

describe("computeMarketAssessment", () => {
  it("null FIPE → unavailable with null ranges", () => {
    const m = computeMarketAssessment(car({}), null);
    expect(m.verdict).toBe("unavailable");
    expect(m.fairMarketMinBRL).toBeNull();
    expect(m.premiumOverFairPct).toBeNull();
  });
  it("asking well below FIPE → under_market, negative premium", () => {
    const m = computeMarketAssessment(car({ askingPriceBRL: 80000 }), 100000);
    expect(m.verdict).toBe("under_market");
    expect(m.premiumOverFairPct).toBeLessThan(0);
  });
  it("asking well above FIPE → overpriced", () => {
    const m = computeMarketAssessment(car({ askingPriceBRL: 120000 }), 100000);
    expect(m.verdict).toBe("overpriced");
  });
  it("asking near FIPE → fair", () => {
    const m = computeMarketAssessment(car({ askingPriceBRL: 102000 }), 100000);
    expect(m.verdict).toBe("fair");
  });

  it("premium uses landed cost (distant auction looks worse than ask alone)", () => {
    const m = computeMarketAssessment(
      car({ askingPriceBRL: 100000, city: "Goiânia", state: "GO", dealPhase: "auction" }),
      100000,
    );
    // landed > FIPE → positive premium / overpriced
    expect(m.landedCostBRL).toBeGreaterThan(100000);
    expect(m.premiumOverFairPct).toBeGreaterThan(0);
    expect(m.verdict).toBe("overpriced");
    expect(m.askingPriceBRL).toBe(100000); // source ask unchanged
  });

  it("SC market near FIPE stays fair on landed", () => {
    const m = computeMarketAssessment(
      car({ askingPriceBRL: 102000, city: "Florianópolis", state: "SC", dealPhase: "market" }),
      100000,
    );
    expect(m.landedCostBRL).toBe(102000);
    expect(m.verdict).toBe("fair");
  });
});
