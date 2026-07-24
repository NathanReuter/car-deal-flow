import { describe, expect, it } from "vitest";
import { classifyCretaTechTrim } from "../cretaTechTrim";

describe("classifyCretaTechTrim", () => {
  it("ignores non-Creta cars", () => {
    expect(classifyCretaTechTrim("Chevrolet", "Tracker", "Premier", null)).toBeNull();
  });

  it("allows Comfort+ / Limited / Platinum / N Line / Ultimate", () => {
    expect(classifyCretaTechTrim("Hyundai", "CRETA", "Comfort", null)?.status).toBe("allowed");
    expect(classifyCretaTechTrim("Hyundai", "Creta", "Comfort Plus", null)?.status).toBe("allowed");
    expect(classifyCretaTechTrim("Hyundai", "Creta", "Limited", null)?.status).toBe("allowed");
    expect(classifyCretaTechTrim("Hyundai", "Creta", "Platinum Safety", null)?.status).toBe("allowed");
    expect(classifyCretaTechTrim("Hyundai", "creta limited", "", null)?.status).toBe("allowed");
  });

  it("blocks Action", () => {
    const v = classifyCretaTechTrim("Hyundai", "CRETA", "Action", null);
    expect(v?.status).toBe("blocked");
  });

  it("flags empty/unknown trim as unknown", () => {
    const v = classifyCretaTechTrim("Hyundai", "CRETA", "", null);
    expect(v?.status).toBe("unknown");
  });

  it("reads trim tokens from notes", () => {
    expect(
      classifyCretaTechTrim("Hyundai", "CRETA", "", "Creta Comfort 1.0 turbo com CarPlay")?.status,
    ).toBe("allowed");
    expect(classifyCretaTechTrim("Hyundai", "CRETA", "", "Creta Action 1.6")?.status).toBe("blocked");
  });
});
