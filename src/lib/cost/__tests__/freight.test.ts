import { describe, expect, it } from "vitest";
import { resolveFreightBRL } from "../freight";

describe("resolveFreightBRL", () => {
  it("returns 0 for any SC city (local)", () => {
    expect(resolveFreightBRL("Joinville", "SC")).toEqual({
      freteBRL: 0,
      freteSource: "local",
      notes: [],
    });
    expect(resolveFreightBRL("Florianópolis", "SC").freteBRL).toBe(0);
  });

  it("matches Tabela 1 city midpoints", () => {
    expect(resolveFreightBRL("São Paulo", "SP")).toMatchObject({
      freteBRL: 1098,
      freteSource: "city",
    });
    expect(resolveFreightBRL("Goiania", "GO")).toMatchObject({
      freteBRL: 2600,
      freteSource: "city",
    });
    expect(resolveFreightBRL("Curitiba", "PR").freteBRL).toBe(775);
  });

  it("falls back to UF capital for unknown city in known UF", () => {
    expect(resolveFreightBRL("Anápolis", "GO")).toMatchObject({
      freteBRL: 2600,
      freteSource: "uf_capital",
    });
  });

  it("uses UF band for UFs without a Tabela 1 capital", () => {
    expect(resolveFreightBRL("Vitória", "ES")).toMatchObject({
      freteBRL: 2200,
      freteSource: "uf_band",
    });
    expect(resolveFreightBRL("Fortaleza", "CE")).toMatchObject({
      freteBRL: 4150,
      freteSource: "uf_band",
    });
  });

  it("assumes long-haul frete for unknown state (never 0)", () => {
    const r = resolveFreightBRL("Unknown", "??");
    expect(r.freteBRL).toBe(4150);
    expect(r.freteSource).toBe("unknown_assumed");
    expect(r.notes).toContain("frete_assumed_unknown_origin");
  });
});
