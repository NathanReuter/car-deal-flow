import { describe, expect, it } from "vitest";
import { parseHarvestSource, resolveSantanderProbeOutcome } from "../harvest";

describe("parseHarvestSource", () => {
  it("accepts valid source names", () => {
    expect(parseHarvestSource("bradesco")).toBe("bradesco");
    expect(parseHarvestSource("vip")).toBe("vip");
    expect(parseHarvestSource("storefronts")).toBe("storefronts");
  });

  it("rejects unknown source names", () => {
    expect(() => parseHarvestSource("bradescco")).toThrow(/Invalid --source/);
  });
});

describe("resolveSantanderProbeOutcome", () => {
  it("allows the list step when html was captured and probe wasn't blocked", () => {
    expect(resolveSantanderProbeOutcome(true, { blocked: false })).toEqual({ ok: true });
  });

  it("fails closed with an actionable message when no html capture exists", () => {
    const outcome = resolveSantanderProbeOutcome(false, { blocked: false });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/did not produce an HTML capture/);
  });

  it("reuses an existing HTML capture when the probe was blocked this run (a blocked probe never overwrites it)", () => {
    expect(resolveSantanderProbeOutcome(true, { blocked: true })).toEqual({ ok: true });
  });

  it("fails closed with an actionable message when the probe was blocked and no capture exists at all", () => {
    const outcome = resolveSantanderProbeOutcome(false, { blocked: true });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toMatch(/detected a block/);
  });
});
