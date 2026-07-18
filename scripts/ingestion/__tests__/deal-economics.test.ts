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
};

describe("totalCostBRL", () => {
  it("uses asking price for auction cars", () => {
    expect(totalCostBRL(base)).toBe(33000);
  });

  it("adds remaining installments for repasse cars", () => {
    const c = { ...base, dealPhase: "pre_repossession", askingPriceBRL: 65000, installmentBRL: 1000, installmentsRemaining: 66 };
    expect(totalCostBRL(c)).toBe(65000 + 66000);
  });

  it("treats zero remaining installments as fully paid, not unknown", () => {
    const paidOff = { ...base, dealPhase: "pre_repossession", installmentBRL: 1500, installmentsRemaining: 0 };
    expect(totalCostBRL(paidOff)).toBe(base.askingPriceBRL);
  });

  it("falls back to outstanding debt, else null for repasse", () => {
    const debt = { ...base, dealPhase: "pre_repossession", outstandingDebtBRL: 40000 };
    expect(totalCostBRL(debt)).toBe(73000);
    const unknown = { ...base, dealPhase: "pre_repossession" };
    expect(totalCostBRL(unknown)).toBeNull();
  });
});

describe("isSpecialDeal", () => {
  it("accepts a 2021+ target model at ≤60% of FIPE", () => {
    expect(isSpecialDeal(base)).toBe(true); // Taos at 26% of FIPE
  });

  it("matches target model in sourceUrl when model column is trim-only", () => {
    const nivus = { ...base, model: "Highline 1.0 200 TSI", sourceUrl: "https://mg.olx.com.br/x/volkswagen-nivus-highline-2022" };
    expect(isSpecialDeal(nivus)).toBe(true);
  });

  it("rejects: non-target model, old year, thin discount, unknown total or FIPE", () => {
    expect(isSpecialDeal({ ...base, model: "ONIX PLUS", sourceUrl: "x" })).toBe(false);
    expect(isSpecialDeal({ ...base, year: 2019 })).toBe(false);
    expect(isSpecialDeal({ ...base, askingPriceBRL: 104030, fipeValueBRL: 115102 })).toBe(false);
    expect(isSpecialDeal({ ...base, dealPhase: "pre_repossession" })).toBe(false);
    expect(isSpecialDeal({ ...base, fipeValueBRL: null })).toBe(false);
  });
});
