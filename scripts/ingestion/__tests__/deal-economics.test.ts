import { describe, expect, it } from "vitest";
import { isSpecialDeal, totalCostBRL, type DealCar } from "../lib/deal-economics";

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
});
