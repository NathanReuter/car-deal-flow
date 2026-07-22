import { describe, it, expect } from "vitest";
import { findDiscontinuedRisk } from "@/lib/filters/discontinuedRisk";

describe("findDiscontinuedRisk", () => {
  it("flags a brand-level exit (case-insensitive)", () => {
    expect(findDiscontinuedRisk("jaguar", "F-Pace")).toMatch(/discontinued/i);
    expect(findDiscontinuedRisk("Subaru", "Forester")).toMatch(/ended commercial operations/i);
  });

  it("flags a model-level discontinuation", () => {
    expect(findDiscontinuedRisk("Mitsubishi", "Pajero Sport")).toMatch(/no confirmed successor/i);
    expect(findDiscontinuedRisk("Mitsubishi", "PAJERO SPORT")).toMatch(/no confirmed successor/i);
  });

  it("does not flag an unrelated Mitsubishi model", () => {
    expect(findDiscontinuedRisk("Mitsubishi", "Outlander")).toBeNull();
  });

  it("does not flag unrelated brands/models", () => {
    expect(findDiscontinuedRisk("Hyundai", "Creta")).toBeNull();
    expect(findDiscontinuedRisk("Volkswagen", "T-Cross")).toBeNull();
  });
});
