import { describe, expect, it } from "vitest";
import {
  buildTopPicksReport,
  detectTargetModel,
  isTopPickEligible,
  type TopPicksCar,
  type TopPicksGoal,
} from "../lib/top-picks";

const goal: TopPicksGoal = {
  budgetMinBRL: 60000,
  budgetMaxBRL: 110000,
  minYear: 2022,
  maxMileageKm: 70000,
  preferredBodyTypes: ["suv"],
  preferredBrands: [
    "Toyota",
    "Honda",
    "Volkswagen",
    "Hyundai",
    "Chevrolet",
    "Byd",
    "GWM",
    "Chery",
  ],
  excludedBrandsModels: ["Jeep Renegade", "Chevrolet Tracker", "Tracker"],
};

function car(over: Partial<TopPicksCar> = {}): TopPicksCar {
  return {
    id: "c1",
    brand: "Hyundai",
    model: "CRETA",
    trim: "Limited",
    sourceUrl: "https://napista.com.br/anuncios/x",
    year: 2025,
    dealPhase: "market",
    askingPriceBRL: 89990,
    installmentBRL: null,
    installmentsRemaining: null,
    outstandingDebtBRL: null,
    fipeValueBRL: 105741,
    bodyType: "suv",
    mileageKm: 35902,
    pipelineStage: "new_lead",
    sourcePlatform: "NaPista",
    stageReason: null,
    notes: null,
    ...over,
  };
}

describe("detectTargetModel", () => {
  it("maps core and lottery keys", () => {
    expect(detectTargetModel(car({ model: "T-CROSS" }))).toBe("t-cross");
    expect(detectTargetModel(car({ model: "Song Pro", brand: "BYD" }))).toBe("song");
    expect(detectTargetModel(car({ model: "Tiggo 5x", brand: "Chery" }))).toBe("tiggo-5x");
    expect(detectTargetModel(car({ model: "Yuan Plus", brand: "BYD" }))).toBe("yuan-plus");
    expect(detectTargetModel(car({ brand: "GWM", model: "HAVAL H6" }))).toBe("haval");
  });

  it("rejects Tiggo 7/8 and excluded Tracker", () => {
    expect(detectTargetModel(car({ model: "Tiggo 7", brand: "Chery" }))).toBeNull();
    expect(detectTargetModel(car({ model: "Tiggo 8", brand: "Chery" }))).toBeNull();
    expect(detectTargetModel(car({ brand: "Chevrolet", model: "TRACKER" }))).toBeNull();
  });
});

describe("isTopPickEligible", () => {
  it("keeps new_lead target SUVs in preferred brands", () => {
    expect(isTopPickEligible(car(), goal)).toBe(true);
  });

  it("excludes researching and later pipeline stages", () => {
    expect(isTopPickEligible(car({ pipelineStage: "researching" }), goal)).toBe(false);
    expect(isTopPickEligible(car({ pipelineStage: "negotiating" }), goal)).toBe(false);
    expect(isTopPickEligible(car({ pipelineStage: "parked" }), goal)).toBe(false);
  });

  it("excludes FALSE POSITIVE flags", () => {
    expect(
      isTopPickEligible(car({ stageReason: "MAYBE FALSE POSITIVE (2026-07-22): trade-in" }), goal),
    ).toBe(false);
  });

  it("excludes non-preferred brands and non-target models", () => {
    expect(isTopPickEligible(car({ brand: "Nissan", model: "Kicks" }), goal)).toBe(false);
    expect(isTopPickEligible(car({ brand: "Chevrolet", model: "Onix" }), goal)).toBe(false);
    expect(isTopPickEligible(car({ brand: "Chery", model: "Tiggo 7" }), goal)).toBe(false);
  });

  it("excludes Creta Action and unknown-trim Cretas", () => {
    expect(isTopPickEligible(car({ brand: "Hyundai", model: "CRETA", trim: "Action" }), goal)).toBe(
      false,
    );
    expect(isTopPickEligible(car({ brand: "Hyundai", model: "CRETA", trim: "" }), goal)).toBe(false);
    expect(
      isTopPickEligible(car({ brand: "Hyundai", model: "CRETA", trim: "Limited" }), goal),
    ).toBe(true);
  });
});

describe("buildTopPicksReport", () => {
  it("ranks by FIPE % then cost, prefers in-budget", () => {
    const report = buildTopPicksReport(
      [
        car({ id: "dear", askingPriceBRL: 120000, fipeValueBRL: 130000 }), // over budget, better %
        car({
          id: "cheap",
          askingPriceBRL: 83900,
          fipeValueBRL: 93517,
          model: "HR-V",
          brand: "Honda",
          trim: "EXL",
        }),
        car({ id: "best", askingPriceBRL: 89990, fipeValueBRL: 105741 }),
        car({
          id: "moved",
          pipelineStage: "researching",
          askingPriceBRL: 50000,
          fipeValueBRL: 160000,
          model: "Song Pro",
          brand: "BYD",
        }),
      ],
      goal,
      10,
    );
    expect(report.picks.map((p) => p.id)).toEqual(["best", "cheap", "dear"]);
    expect(report.eligible).toBe(3);
    expect(report.picks[0]!.pctOfFipe).toBe(85.1);
    expect(report.picks[0]!.inBudget).toBe(true);
    expect(report.picks[0]!.tier).toBe("core");
    expect(report.picks[2]!.inBudget).toBe(false);
  });

  it("prefers core in-budget over deeper out-of-budget lottery", () => {
    const report = buildTopPicksReport(
      [
        car({
          id: "lottery-deep",
          brand: "BYD",
          model: "Song Pro",
          trim: "GS",
          askingPriceBRL: 160000,
          fipeValueBRL: 280000, // ~57% FIPE, over soft max
        }),
        car({
          id: "core-in",
          brand: "Hyundai",
          model: "CRETA",
          trim: "Limited",
          askingPriceBRL: 89990,
          fipeValueBRL: 105741,
        }),
      ],
      goal,
      10,
    );
    expect(report.picks.map((p) => p.id)).toEqual(["core-in", "lottery-deep"]);
    expect(report.picks[0]!.tier).toBe("core");
    expect(report.picks[1]!.tier).toBe("lottery");
  });

  it("ranks out-of-budget lottery ≤70% FIPE before weak lottery deals", () => {
    const report = buildTopPicksReport(
      [
        car({
          id: "lottery-bad",
          brand: "GWM",
          model: "HAVAL H6",
          askingPriceBRL: 180000,
          fipeValueBRL: 200000, // 90%
        }),
        car({
          id: "core-in",
          askingPriceBRL: 89990,
          fipeValueBRL: 105741,
        }),
        car({
          id: "lottery-ok",
          brand: "BYD",
          model: "Yuan Plus",
          askingPriceBRL: 160000,
          fipeValueBRL: 250000, // 64%
        }),
      ],
      goal,
      10,
    );
    expect(report.picks.map((p) => p.id)).toEqual(["core-in", "lottery-ok", "lottery-bad"]);
    expect(report.picks[1]!.tier).toBe("lottery");
    expect(report.picks[1]!.pctOfFipe).toBe(64);
  });

  it("does not promote out-of-budget lottery with missing FIPE over core", () => {
    const report = buildTopPicksReport(
      [
        car({
          id: "lottery-nofipe",
          brand: "BYD",
          model: "Song Pro",
          askingPriceBRL: 160000,
          fipeValueBRL: null,
        }),
        car({
          id: "core-in",
          askingPriceBRL: 89990,
          fipeValueBRL: 105741,
        }),
      ],
      goal,
      10,
    );
    expect(report.picks.map((p) => p.id)).toEqual(["core-in", "lottery-nofipe"]);
    expect(report.picks[0]!.tier).toBe("core");
  });

  it("adds repasse trade-in caveats", () => {
    const report = buildTopPicksReport(
      [
        car({
          id: "rep",
          brand: "BYD",
          model: "Song Pro",
          dealPhase: "pre_repossession",
          askingPriceBRL: 75000,
          outstandingDebtBRL: 87500,
          fipeValueBRL: 161852,
          notes: "Aceito veículo de 75 e transfiro a dívida. Para quem quer trocar o carro.",
        }),
      ],
      goal,
      5,
    );
    // 75k+87.5k = 162.5k is over soft budget → still eligible but caveat present
    expect(report.picks).toHaveLength(1);
    expect(report.picks[0]!.caveats[0]).toMatch(/trade-in/i);
    expect(report.picks[0]!.tier).toBe("lottery");
  });
});
