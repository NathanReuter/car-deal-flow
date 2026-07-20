import { describe, it, expect } from "vitest";
import { parseHarvestPhase, parseHarvestSource, sourcesForPhase, PHASE_SOURCES } from "../harvest";

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

  it("parseHarvestPhase accepts 'market' and PHASE_SOURCES.market is an empty array", () => {
    expect(parseHarvestPhase("market")).toBe("market");
    expect(PHASE_SOURCES.market).toEqual([]);
  });

  it("sourcesForPhase('all') includes market sources (even when empty)", () => {
    const all = sourcesForPhase("all");
    const expected = [
      ...sourcesForPhase("auction"),
      ...sourcesForPhase("pre"),
      ...PHASE_SOURCES.market,
    ];
    expect(all).toEqual(expected);
  });

  it("invalid --phase error message lists all 4 valid options", () => {
    expect(() => parseHarvestPhase("foo")).toThrow(/market/);
  });
});
