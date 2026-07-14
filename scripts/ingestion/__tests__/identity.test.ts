import { describe, it, expect } from "vitest";
import { normalizeChassis, normalizePlate, isMergeablePlate } from "../identity";

describe("identity normalization", () => {
  it("normalizes plates by stripping separators and casefolding", () => {
    expect(normalizePlate("abc-1d23")).toBe("ABC1D23");
    expect(normalizePlate(" ABC 1D23 ")).toBe("ABC1D23");
  });

  it("returns null for empty plate", () => {
    expect(normalizePlate(null)).toBeNull();
    expect(normalizePlate("")).toBeNull();
    expect(normalizePlate("   ")).toBeNull();
  });

  it("normalizes chassis similarly", () => {
    expect(normalizeChassis("9bwzzZ377at000001")).toBe("9BWZZZ377AT000001");
    expect(normalizeChassis("9bw-zzz-377")).toBe("9BWZZZ377");
  });

  it("only treats full BR plates as mergeable identity", () => {
    expect(isMergeablePlate("ABC1D23")).toBe(true); // Mercosul
    expect(isMergeablePlate("ABC1234")).toBe(true); // old
    expect(isMergeablePlate("FINAL3")).toBe(false);
    expect(isMergeablePlate("ABC")).toBe(false);
    expect(isMergeablePlate(null)).toBe(false);
  });
});
