import { describe, it, expect, vi, afterEach } from "vitest";
import { findFipeValue, FipeError } from "../fipe";

function mockFetchSequence(responses: unknown[]) {
  let i = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    const body = responses[Math.min(i++, responses.length - 1)];
    return { ok: true, json: async () => body } as Response;
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("findFipeValue", () => {
  it("throws FipeError when the brand cannot be matched", async () => {
    mockFetchSequence([[{ codigo: "1", nome: "Fiat" }]]); // brand list without the target
    await expect(findFipeValue({ brand: "Lamborghini", model: "Aventador", year: 2022 }))
      .rejects.toBeInstanceOf(FipeError);
  });

  it("returns a match when brand→model→year resolve", async () => {
    mockFetchSequence([
      [{ codigo: "59", nome: "VW - VolksWagen" }],               // brands
      { modelos: [{ codigo: "5940", nome: "T-Cross Highline TSI" }], anos: [] }, // models
      [{ codigo: "2022-1", nome: "2022 Gasolina" }],             // years
      { Valor: "R$ 120.000,00", Modelo: "T-Cross Highline TSI", MesReferencia: "julho de 2026" },
    ]);
    const r = await findFipeValue({ brand: "Volkswagen", model: "T-Cross", year: 2022 });
    expect(r.valueBRL).toBe(120000);
    expect(r.matchedModel).toContain("T-Cross");
    expect(r.referenceMonth).toMatch(/julho/);
  });
});
