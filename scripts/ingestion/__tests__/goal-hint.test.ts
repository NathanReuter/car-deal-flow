import { describe, it, expect, vi } from "vitest";
import { loadGoalHint } from "../goal-hint";

describe("loadGoalHint", () => {
  it("returns guidance when no active goal", async () => {
    const prisma = {
      buyingGoal: { findFirst: vi.fn().mockResolvedValue(null) },
    };
    const hint = await loadGoalHint(prisma as never);
    expect(hint.ok).toBe(false);
  });

  it("summarizes active goal prefer bands", async () => {
    const prisma = {
      buyingGoal: {
        findFirst: vi.fn().mockResolvedValue({
          name: "Family daily",
          budgetMinBRL: 40000,
          budgetMaxBRL: 100000,
          minYear: 2018,
          maxMileageKm: 120000,
          preferredBrands: '["Toyota","Honda"]',
          preferredBodyTypes: '["suv","hatch"]',
          excludedBrandsModels: '["Jeep Renegade"]',
        }),
      },
    };
    const hint = await loadGoalHint(prisma as never);
    expect(hint.ok).toBe(true);
    if (!hint.ok) return;
    expect(hint.prefer.budgetBRL).toEqual({ min: 40000, max: 100000 });
    expect(hint.prefer.preferredBrands).toContain("Toyota");
    expect(hint.guidance.some((g) => g.includes("1000"))).toBe(true);
  });
});
