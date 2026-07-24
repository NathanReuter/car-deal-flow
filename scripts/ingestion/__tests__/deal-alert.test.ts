import { describe, expect, it } from "vitest";
import { buildAlertReport } from "../deal-alert";
import type { DealCar } from "../lib/deal-economics";

const taos: DealCar & { brand: string } = {
  brand: "Volkswagen",
  model: "TAOS CL TSI",
  trim: "",
  sourceUrl: "https://vip.example/lot/9",
  year: 2023,
  dealPhase: "auction",
  askingPriceBRL: 33000,
  installmentBRL: null,
  installmentsRemaining: null,
  outstandingDebtBRL: null,
  fipeValueBRL: 129133,
  city: "Florianópolis",
  state: "SC",
};

const dud = { ...taos, model: "ONIX PLUS", sourceUrl: "https://x" };

describe("buildAlertReport", () => {
  it("keeps only special deals, sorted by pct of FIPE, with rounded pct", () => {
    const report = buildAlertReport([dud, taos]);
    expect(report.scanned).toBe(2);
    expect(report.deals).toHaveLength(1);
    expect(report.deals[0]).toMatchObject({
      label: "Volkswagen TAOS CL TSI 2023",
      totalCostBRL: 37550, // 33000 lance + 1650 comissão + 1200 DETRAN + 1700 buffer (SC → frete 0)
      fipeValueBRL: 129133,
      pctOfFipe: 29.1,
      sourceUrl: "https://vip.example/lot/9",
    });
  });
});
