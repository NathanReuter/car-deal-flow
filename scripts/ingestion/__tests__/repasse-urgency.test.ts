import { describe, it, expect } from "vitest";
import { computeRepasseUrgency } from "../lib/repasse-urgency";

describe("computeRepasseUrgency", () => {
  it("forces high when a judicial/RENAJUD restriction was found (clock running)", () => {
    expect(computeRepasseUrgency({ restrictionFound: true, adText: "" })).toBe("high");
  });

  it("returns high on strong distress markers in the ad text", () => {
    expect(computeRepasseUrgency({ adText: "Banco vai tomar o carro, preciso repassar" })).toBe("high");
    expect(computeRepasseUrgency({ adText: "Já recebi aviso de busca e apreensão" })).toBe("high");
    expect(computeRepasseUrgency({ adText: "Estou com 3 parcelas atrasadas" })).toBe("high");
    expect(computeRepasseUrgency({ adText: "Aceito entrega amigável ou repasse" })).toBe("high");
  });

  it("returns medium on soft urgency markers", () => {
    expect(computeRepasseUrgency({ adText: "URGENTE! Repasse Onix 2022" })).toBe("medium");
    expect(computeRepasseUrgency({ adText: "Preciso vender rápido" })).toBe("medium");
  });

  it("returns medium on a deep discount vs FIPE even without text markers", () => {
    expect(
      computeRepasseUrgency({ adText: "Repasse Onix", askingPriceBRL: 50000, fipeValueBRL: 80000 }),
    ).toBe("medium");
  });

  it("returns low for a plain ad with no signals", () => {
    expect(computeRepasseUrgency({ adText: "Repasse de financiamento, carro revisado" })).toBe("low");
    expect(
      computeRepasseUrgency({ adText: "Repasse", askingPriceBRL: 78000, fipeValueBRL: 80000 }),
    ).toBe("low");
  });

  it("ignores FIPE when either price is missing (no false precision)", () => {
    expect(computeRepasseUrgency({ adText: "Repasse", askingPriceBRL: 50000, fipeValueBRL: null })).toBe("low");
  });
});
