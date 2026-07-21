import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbContext } from "../../risk-checks/__tests__/test-db";
import { writeLead } from "../write-lead";
import { rescoreDecisions, RescoreDecisionsError } from "../rescore-decisions";
import { computeDecision } from "../../../src/lib/scoring/decision";
import { buildBundle, CAR_INCLUDE, toBuyingGoal } from "../../../src/lib/aggregate";

async function seedGoal(
  prisma: TestDbContext["prisma"],
  overrides: Partial<{
    budgetMinBRL: number;
    budgetMaxBRL: number;
    minYear: number;
    maxMileageKm: number;
    preferredBodyTypes: string[];
  }> = {},
) {
  return prisma.buyingGoal.create({
    data: {
      name: "Test goal",
      active: true,
      budgetMinBRL: overrides.budgetMinBRL ?? 50000,
      budgetMaxBRL: overrides.budgetMaxBRL ?? 150000,
      minYear: overrides.minYear ?? 2018,
      maxMileageKm: overrides.maxMileageKm ?? 100000,
      requiredFeatures: "[]",
      preferredBodyTypes: JSON.stringify(overrides.preferredBodyTypes ?? ["suv"]),
      preferredBrands: "[]",
      excludedBrandsModels: "[]",
      fuelEconomyThresholdKmL: 8,
      minResaleLiquidityScore: 30,
      familySpaceRequired: false,
    },
  });
}

describe("rescoreDecisions", () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createTestDb();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("throws when no active goal exists", async () => {
    await expect(rescoreDecisions(ctx.prisma)).rejects.toThrow(RescoreDecisionsError);
  });

  it("writes finalScore and verdict for each car and matches computeDecision", async () => {
    const goalRow = await seedGoal(ctx.prisma);
    const goal = toBuyingGoal(goalRow);

    const lead1 = await writeLead(ctx.prisma, {
      brand: "Hyundai",
      model: "Creta",
      year: 2022,
      askingPriceBRL: 100000,
      sourceUrl: "https://example.com/creta-rescore",
      sourcePlatform: "Bradesco Vitrine",
      sellerType: "bank_recovery",
      bodyType: "suv",
      mileageKm: 30000,
      city: "São Paulo",
      state: "SP",
    });

    const lead2 = await writeLead(ctx.prisma, {
      brand: "Fiat",
      model: "Argo",
      year: 2021,
      askingPriceBRL: 65000,
      sourceUrl: "https://example.com/argo-rescore",
      sourcePlatform: "VIP Leilões",
      sellerType: "auction",
      bodyType: "hatch",
      mileageKm: 50000,
    });

    const summary = await rescoreDecisions(ctx.prisma);
    expect(summary.scored).toBe(2);

    // Verify each car's stored score matches computeDecision output
    for (const leadResult of [lead1, lead2]) {
      const row = await ctx.prisma.car.findUniqueOrThrow({
        where: { id: leadResult.carId },
        include: CAR_INCLUDE,
      });

      expect(row.finalScore).not.toBeNull();
      expect(row.verdict).not.toBeNull();

      const bundle = buildBundle(row, goal);
      expect(row.finalScore).toBe(bundle.decision.finalScore);
      expect(row.verdict).toBe(bundle.decision.verdict);
    }
  });

  it("rescores 0 cars when DB is empty (goal exists)", async () => {
    await seedGoal(ctx.prisma);
    const summary = await rescoreDecisions(ctx.prisma);
    expect(summary.scored).toBe(0);
  });
});
