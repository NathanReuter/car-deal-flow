import { describe, it, expect } from "vitest";
import { parseHarvestPhase, parseHarvestSource, sourcesForPhase } from "../harvest";

describe("harvest phase selection", () => {
  it("maps pre → olx only, auction → the five auction sources", () => {
    expect(sourcesForPhase("pre")).toEqual(["olx"]);
    expect(sourcesForPhase("auction")).toEqual([
      "bradesco",
      "vip",
      "bidchain",
      "mgl",
      "santander",
    ]);
  });

  it("all = auction sources + pre sources with no duplicates", () => {
    const all = sourcesForPhase("all");
    expect(all).toEqual([...sourcesForPhase("auction"), ...sourcesForPhase("pre")]);
    expect(new Set(all).size).toBe(all.length);
  });

  it("accepts olx as a --source and rejects unknown phases/sources", () => {
    expect(parseHarvestSource("olx")).toBe("olx");
    expect(() => parseHarvestSource("webmotors")).toThrow(/Invalid --source/);
    expect(parseHarvestPhase("pre")).toBe("pre");
    expect(() => parseHarvestPhase("both")).toThrow(/Invalid --phase/);
  });
});
