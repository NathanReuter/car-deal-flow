import { describe, expect, it } from "vitest";
import {
  classifyTargetModel,
  isSpecialDeal,
  totalCostBRL,
  type DealCar,
} from "../lib/deal-economics";

const base: DealCar = {
  model: "TAOS CL TSI",
  trim: "",
  sourceUrl: "https://example.com/lot/1",
  year: 2023,
  dealPhase: "auction",
  askingPriceBRL: 33000,
  installmentBRL: null,
  installmentsRemaining: null,
  outstandingDebtBRL: null,
  fipeValueBRL: 129133,
  city: "Goiânia",
  state: "GO",
};

describe("totalCostBRL (landed)", () => {
  it("returns landed cost for auction cars (frete + fees)", () => {
    // 33000 + 2600 + 1650 + 1200 + 1700
    expect(totalCostBRL(base)).toBe(40150);
  });

  it("does not re-add installments for repasse (ask is already effective cost)", () => {
    const c = {
      ...base,
      dealPhase: "pre_repossession",
      askingPriceBRL: 65000,
      installmentBRL: 1000,
      installmentsRemaining: 66,
      city: "Florianópolis",
      state: "SC",
    };
    expect(totalCostBRL(c)).toBe(65000);
  });

  it("adds frete only for repasse outside SC", () => {
    const c = {
      ...base,
      dealPhase: "pre_repossession",
      askingPriceBRL: 65000,
      installmentBRL: 1000,
      installmentsRemaining: 66,
      city: "Brasília",
      state: "DF",
    };
    expect(totalCostBRL(c)).toBe(65000 + 2750);
  });

  it("still prices repasse when debt fields are null (ask-only)", () => {
    const unknown = {
      ...base,
      dealPhase: "pre_repossession",
      city: "Florianópolis",
      state: "SC",
    };
    expect(totalCostBRL(unknown)).toBe(33000);
  });
});

describe("isSpecialDeal", () => {
  it("accepts a 2021+ target model at ≤60% of FIPE", () => {
    expect(isSpecialDeal(base)).toBe(true); // Taos landed 40150 ≈ 31% of FIPE
  });

  it("matches target model in sourceUrl when model column is trim-only", () => {
    const nivus = { ...base, model: "Highline 1.0 200 TSI", sourceUrl: "https://mg.olx.com.br/x/volkswagen-nivus-highline-2022" };
    expect(isSpecialDeal(nivus)).toBe(true);
  });

  it("rejects: non-target model, old year, thin discount, missing FIPE", () => {
    expect(isSpecialDeal({ ...base, model: "ONIX PLUS", sourceUrl: "x" })).toBe(false);
    expect(isSpecialDeal({ ...base, year: 2019 })).toBe(false);
    expect(isSpecialDeal({ ...base, askingPriceBRL: 104030, fipeValueBRL: 115102 })).toBe(false);
    expect(isSpecialDeal({ ...base, fipeValueBRL: null })).toBe(false);
  });

  it("prices repasse from ask now, so a cheap known-ask repasse can still qualify", () => {
    // Under the landed model, pre_repossession is no longer 'unpriced' — ask is
    // treated as effective cost, so a 33000 ask (+frete) stays ≤60% of FIPE.
    expect(isSpecialDeal({ ...base, dealPhase: "pre_repossession" })).toBe(true);
  });

  it("accepts Song / Yuan Plus / Haval at ≤60% FIPE", () => {
    const song: DealCar = {
      ...base,
      model: "Song Pro",
      askingPriceBRL: 90000,
      fipeValueBRL: 170000,
    };
    expect(isSpecialDeal(song)).toBe(true);
    expect(isSpecialDeal({ ...song, model: "Yuan Plus" })).toBe(true);
    expect(isSpecialDeal({ ...song, model: "HAVAL H6" })).toBe(true);
  });

  it("rejects Tiggo 7 even when deeply discounted", () => {
    expect(
      isSpecialDeal({
        ...base,
        model: "Tiggo 7 PRO",
        askingPriceBRL: 50000,
        fipeValueBRL: 150000,
      }),
    ).toBe(false);
  });
});

describe("classifyTargetModel", () => {
  it("classifies core peers including Tiggo 5x", () => {
    expect(classifyTargetModel("Hyundai CRETA Limited")).toEqual({ key: "creta", tier: "core" });
    expect(classifyTargetModel("VW T-Cross Highline")).toEqual({ key: "t-cross", tier: "core" });
    expect(classifyTargetModel("Caoa Chery Tiggo 5x PRO")).toEqual({ key: "tiggo-5x", tier: "core" });
    expect(classifyTargetModel("Toyota Corolla Cross XRE")).toEqual({
      key: "corolla-cross",
      tier: "core",
    });
  });

  it("classifies lottery NEV models", () => {
    expect(classifyTargetModel("BYD Song Pro GS")).toEqual({ key: "song", tier: "lottery" });
    expect(classifyTargetModel("BYD Yuan Plus")).toEqual({ key: "yuan-plus", tier: "lottery" });
    expect(classifyTargetModel("GWM HAVAL H6 HEV")).toEqual({ key: "haval", tier: "lottery" });
  });

  it("rejects Tiggo 7/8, Tracker, bare Chery/GWM, and watch-list brands", () => {
    expect(classifyTargetModel("Chery Tiggo 7 PRO")).toBeNull();
    expect(classifyTargetModel("Chery Tiggo 8")).toBeNull();
    expect(classifyTargetModel("Chevrolet Tracker Premier")).toBeNull();
    expect(classifyTargetModel("Chery Arrizo")).toBeNull();
    expect(classifyTargetModel("Omoda 5 HEV")).toBeNull();
    expect(classifyTargetModel("Leapmotor C10")).toBeNull();
  });
});
