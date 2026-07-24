import { describe, it, expect } from "vitest";
import { parseHarvestPhase, parseHarvestSource, sourcesForPhase, PHASE_SOURCES } from "../harvest";

describe("harvest phase selection", () => {
  it("maps pre → olx + webmotors, auction → the five auction sources, market → napista + storefronts + facebook", () => {
    expect(sourcesForPhase("pre")).toEqual(["olx", "webmotors"]);
    expect(sourcesForPhase("auction")).toEqual([
      "bradesco",
      "vip",
      "bidchain",
      "mgl",
      "santander",
    ]);
    expect(sourcesForPhase("market")).toEqual(["napista", "storefronts", "facebook"]);
  });

  it("all = auction + pre + market sources with no duplicates", () => {
    const all = sourcesForPhase("all");
    expect(all).toEqual(
      expect.arrayContaining([
        ...sourcesForPhase("auction"),
        ...sourcesForPhase("pre"),
        ...sourcesForPhase("market"),
      ]),
    );
    expect(all.length).toBe(
      sourcesForPhase("auction").length +
        sourcesForPhase("pre").length +
        sourcesForPhase("market").length,
    );
    expect(new Set(all).size).toBe(all.length);
  });

  it("accepts new harvester sources and rejects unknown phases/sources", () => {
    expect(parseHarvestSource("olx")).toBe("olx");
    expect(parseHarvestSource("webmotors")).toBe("webmotors");
    expect(parseHarvestSource("napista")).toBe("napista");
    expect(parseHarvestSource("storefronts")).toBe("storefronts");
    expect(parseHarvestSource("facebook")).toBe("facebook");
    expect(() => parseHarvestSource("nope")).toThrow(/Invalid --source/);
    expect(parseHarvestPhase("pre")).toBe("pre");
    expect(() => parseHarvestPhase("both")).toThrow(/Invalid --phase/);
  });

  it("parseHarvestPhase accepts 'market' and PHASE_SOURCES.market carries the market sources", () => {
    expect(parseHarvestPhase("market")).toBe("market");
    expect(PHASE_SOURCES.market).toEqual(["napista", "storefronts", "facebook"]);
  });

  it("invalid --phase error message lists all 4 valid options", () => {
    expect(() => parseHarvestPhase("foo")).toThrow(/market/);
  });
});
