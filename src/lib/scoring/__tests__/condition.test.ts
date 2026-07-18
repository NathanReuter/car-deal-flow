import { describe, it, expect } from "vitest";
import { computeConditionScore } from "../condition";
import type { ConditionField } from "@/lib/types";

const f = (rating: ConditionField["rating"]): ConditionField => ({ key: "k", label: "L", rating, notes: "" });

describe("computeConditionScore", () => {
  it("no rated fields → 50", () => {
    expect(computeConditionScore([])).toBe(50);
    expect(computeConditionScore([f("not_inspected")])).toBe(50);
  });
  it("averages rated fields, ignoring not_inspected", () => {
    expect(computeConditionScore([f("good"), f("poor"), f("not_inspected")])).toBe(60);
  });
});
