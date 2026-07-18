import { describe, it, expect } from "vitest";
import { computeRiskScore } from "../risk";
import type { RiskCheckItem } from "@/lib/types";

const item = (o: Partial<RiskCheckItem>): RiskCheckItem => ({
  key: "recall_status", status: "verified", severity: "low", notes: "", ...o,
});

describe("computeRiskScore", () => {
  it("empty checklist scores 100", () => {
    expect(computeRiskScore([])).toBe(100);
  });
  it("all verified scores 100", () => {
    expect(computeRiskScore([item({}), item({ severity: "severe" })])).toBe(100);
  });
  it("a severe failed check floors the score", () => {
    expect(computeRiskScore([item({ status: "failed", severity: "severe" })])).toBeLessThanOrEqual(10);
  });
  it("pending costs less than failed at same severity", () => {
    const pending = computeRiskScore([item({ status: "pending", severity: "high" })]);
    const failed = computeRiskScore([item({ status: "failed", severity: "high" })]);
    expect(pending).toBeGreaterThan(failed);
  });
});
