import { describe, it, expect } from "vitest";
import { detectDamageSignals } from "@/lib/filters/damageSignals";

const MAPFRE_T_CROSS = `MAPFRE | LOTE: 14 | DATA: 15/07/2026
VOLKSWAGEN / T-CROSS SENSE 200 1.0 TSI AT6 M FLEX 2024/2024 - BRANCO
Sinistro: COLISÃO (360923126000089)
Monta: MEDIA MONTA
Possui Chave: SIM | Possui Manual: SIM
Valor médio de mercado: R$ 101.750,00`;

describe("detectDamageSignals", () => {
  it("blocks Mapfre T-Cross collision + média monta listing", () => {
    const result = detectDamageSignals(MAPFRE_T_CROSS);
    expect(result.blocked).toBe(true);
    expect(result.reasons).toContain("colisão");
    expect(result.reasons).toContain("média monta");
    expect(result.reasons).toContain("sinistro");
  });

  it("does not block integral / conservado / sem sinistro", () => {
    expect(detectDamageSignals("Veículo integral, conservado, sem sinistro.").blocked).toBe(
      false,
    );
    expect(
      detectDamageSignals("Único dono, revisões na concessionária, sem sinistro aparente.")
        .blocked,
    ).toBe(false);
  });

  it("blocks sucata, batido, and sinistro de médio porte", () => {
    expect(detectDamageSignals("Lote marcado como sucata").blocked).toBe(true);
    expect(detectDamageSignals("Veículo batido conforme edital").blocked).toBe(true);
    expect(
      detectDamageSignals(
        "Leilão de seguradora — laudo indica sinistro de médio porte na lateral direita.",
      ).blocked,
    ).toBe(true);
  });

  it("blocks pequena and grande monta", () => {
    expect(detectDamageSignals("Monta: PEQUENA MONTA").reasons).toContain("pequena monta");
    expect(detectDamageSignals("Monta: GRANDE MONTA").reasons).toContain("grande monta");
  });

  it("does not block non-sucata disclaimers", () => {
    expect(detectDamageSignals("Mapfre; non-sucata listing").blocked).toBe(false);
    expect(detectDamageSignals("nao sucata").blocked).toBe(false);
  });

  it("returns not blocked for empty or missing text", () => {
    expect(detectDamageSignals("").blocked).toBe(false);
    expect(detectDamageSignals(null).blocked).toBe(false);
  });
});
