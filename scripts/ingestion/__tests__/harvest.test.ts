import { describe, expect, it } from "vitest";
import { parseHarvestSource } from "../harvest";

describe("parseHarvestSource", () => {
  it("accepts valid source names", () => {
    expect(parseHarvestSource("bradesco")).toBe("bradesco");
    expect(parseHarvestSource("vip")).toBe("vip");
  });

  it("rejects unknown source names", () => {
    expect(() => parseHarvestSource("bradescco")).toThrow(/Invalid --source/);
  });
});
