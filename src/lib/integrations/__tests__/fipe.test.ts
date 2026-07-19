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
    mockFetchSequence([[{ code: "1", name: "Fiat" }]]); // brand list without the target
    await expect(findFipeValue({ brand: "Lamborghini", model: "Aventador", year: 2022 }))
      .rejects.toBeInstanceOf(FipeError);
  });

  it("returns a match when brand→model→year resolve", async () => {
    mockFetchSequence([
      [{ code: "59", name: "VW - VolksWagen" }],
      [{ code: "10375", name: "T-Cross Hig. 250 TSI 1.4 Flex 16V 5p Aut" }],
      [{ code: "2022-1", name: "2022 Gasolina" }],
      { price: "R$ 120.000,00", model: "T-Cross Hig. 250 TSI 1.4 Flex 16V 5p Aut", referenceMonth: "julho de 2026" },
    ]);
    const r = await findFipeValue({
      brand: "Volkswagen",
      model: "T-Cross",
      trim: "Highline 1.4 250 TSI",
      year: 2022,
      transmission: "automatic",
    });
    expect(r.valueBRL).toBe(120000);
    expect(r.matchedModel).toContain("T-Cross");
    expect(r.referenceMonth).toMatch(/julho/);
  });

  it("fails closed when multiple fuel variants share the year and fuel can't disambiguate", async () => {
    mockFetchSequence([
      [{ code: "59", name: "VW - VolksWagen" }],
      [{ code: "5940", name: "T-Cross 1.0 TSI Flex 12V 5p Mec." }],
      [{ code: "2022-1", name: "2022 Gasolina" }, { code: "2022-3", name: "2022 Diesel" }],
    ]);
    await expect(findFipeValue({ brand: "Volkswagen", model: "T-Cross", year: 2022 }))
      .rejects.toBeInstanceOf(FipeError);
  });

  it("disambiguates multiple year variants by fuel", async () => {
    mockFetchSequence([
      [{ code: "59", name: "VW - VolksWagen" }],
      [{ code: "5940", name: "T-Cross 1.0 TSI Flex 12V 5p Mec." }],
      [{ code: "2022-1", name: "2022 Gasolina" }, { code: "2022-3", name: "2022 Diesel" }],
      { price: "R$ 130.000,00", model: "T-Cross", referenceMonth: "julho de 2026" },
    ]);
    const r = await findFipeValue({ brand: "Volkswagen", model: "T-Cross", year: 2022, fuel: "diesel" });
    expect(r.valueBRL).toBe(130000);
  });

  it("does not crash when API returns v2 code/name fields (not v1 codigo/nome)", async () => {
    mockFetchSequence([
      [{ code: "59", name: "VW - VolksWagen" }],
      [{ code: "10375", name: "T-Cross Hig. 250 TSI 1.4 Flex 16V 5p Aut" }],
      [{ code: "2022-1", name: "2022 Flex" }],
      { price: "R$ 99.000,00", model: "T-Cross Hig.", referenceMonth: "julho de 2026" },
    ]);
    await expect(
      findFipeValue({ brand: "Volkswagen", model: "T-Cross", trim: "HL", year: 2022, transmission: "automatic" }),
    ).resolves.toMatchObject({ valueBRL: 99000 });
  });
});
