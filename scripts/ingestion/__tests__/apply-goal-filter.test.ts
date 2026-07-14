import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbContext } from "../../risk-checks/__tests__/test-db";
import { writeLead } from "../write-lead";
import { applyGoalFilter, ApplyGoalFilterError } from "../apply-goal-filter";

async function seedGoal(
  prisma: TestDbContext["prisma"],
  overrides: Partial<{
    budgetMinBRL: number;
    budgetMaxBRL: number;
    minYear: number;
    maxMileageKm: number;
    preferredBodyTypes: string[];
    preferredBrands: string[];
    excludedBrandsModels: string[];
  }> = {},
) {
  await prisma.buyingGoal.create({
    data: {
      name: "Test goal",
      active: true,
      budgetMinBRL: overrides.budgetMinBRL ?? 50000,
      budgetMaxBRL: overrides.budgetMaxBRL ?? 120000,
      minYear: overrides.minYear ?? 2020,
      maxMileageKm: overrides.maxMileageKm ?? 80000,
      requiredFeatures: "[]",
      preferredBodyTypes: JSON.stringify(overrides.preferredBodyTypes ?? ["suv"]),
      preferredBrands: JSON.stringify(overrides.preferredBrands ?? []),
      excludedBrandsModels: JSON.stringify(overrides.excludedBrandsModels ?? []),
      fuelEconomyThresholdKmL: 10,
      minResaleLiquidityScore: 50,
      familySpaceRequired: false,
    },
  });
}

describe("applyGoalFilter", () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createTestDb();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("throws when no active goal exists", async () => {
    await expect(applyGoalFilter(ctx.prisma)).rejects.toThrow(ApplyGoalFilterError);
  });

  it("hard-rejects leads with damage/sinistro in notes", async () => {
    await seedGoal(ctx.prisma);
    const lead = await writeLead(ctx.prisma, {
      brand: "Volkswagen",
      model: "T-Cross",
      year: 2024,
      askingPriceBRL: 47900,
      sourceUrl: "https://example.com/tcross-damage",
      sourcePlatform: "Leilões PB",
      sellerType: "bank_recovery",
      bodyType: "suv",
      mileageKm: 30000,
      notes: "Sinistro: COLISÃO\nMonta: MEDIA MONTA",
      forceDamaged: true,
    });

    const summary = await applyGoalFilter(ctx.prisma);
    expect(summary.rejected).toBe(1);
    const car = await ctx.prisma.car.findUnique({ where: { id: lead.carId } });
    expect(car!.pipelineStage).toBe("rejected");
    expect(car!.stageReason).toMatch(/Damage\/sinistro/i);
  });

  it("hard-rejects excluded brands", async () => {
    await seedGoal(ctx.prisma, { excludedBrandsModels: ["Renault"] });
    const lead = await writeLead(ctx.prisma, {
      brand: "Renault",
      model: "Duster",
      year: 2022,
      askingPriceBRL: 85000,
      sourceUrl: "https://example.com/duster",
      sourcePlatform: "VIP Leilões",
      sellerType: "auction",
      bodyType: "suv",
      mileageKm: 40000,
    });

    const summary = await applyGoalFilter(ctx.prisma);
    expect(summary.rejected).toBe(1);
    const car = await ctx.prisma.car.findUnique({ where: { id: lead.carId } });
    expect(car!.pipelineStage).toBe("rejected");
    expect(car!.stageReason).toMatch(/excluded/i);
  });

  it("parks cars below the goal-fit threshold", async () => {
    await seedGoal(ctx.prisma, {
      budgetMaxBRL: 60000,
      preferredBodyTypes: ["hatch"],
      minYear: 2023,
    });
    const lead = await writeLead(ctx.prisma, {
      brand: "Fiat",
      model: "Argo",
      year: 2019,
      askingPriceBRL: 90000,
      sourceUrl: "https://example.com/argo",
      sourcePlatform: "VIP Leilões",
      sellerType: "auction",
      bodyType: "suv",
      mileageKm: null,
    });

    const summary = await applyGoalFilter(ctx.prisma, { minGoalFit: 50 });
    expect(summary.parked).toBe(1);
    const car = await ctx.prisma.car.findUnique({ where: { id: lead.carId } });
    expect(car!.pipelineStage).toBe("parked");
    expect(car!.stageReason).toBeTruthy();
  });

  it("keeps strong fits as new_lead and clears stageReason", async () => {
    await seedGoal(ctx.prisma);
    const lead = await writeLead(ctx.prisma, {
      brand: "Hyundai",
      model: "Creta",
      year: 2022,
      askingPriceBRL: 100000,
      sourceUrl: "https://example.com/creta",
      sourcePlatform: "Bradesco Vitrine",
      sellerType: "bank_recovery",
      bodyType: "suv",
      mileageKm: 35000,
      city: "São Paulo",
      state: "SP",
    });
    await ctx.prisma.car.update({
      where: { id: lead.carId },
      data: { pipelineStage: "parked", stageReason: "stale" },
    });

    const summary = await applyGoalFilter(ctx.prisma);
    expect(summary.keptNewLead).toBe(1);
    const car = await ctx.prisma.car.findUnique({ where: { id: lead.carId } });
    expect(car!.pipelineStage).toBe("new_lead");
    expect(car!.stageReason).toBeNull();
  });

  it("does not touch researching cars", async () => {
    await seedGoal(ctx.prisma, { excludedBrandsModels: ["Fiat"] });
    const lead = await writeLead(ctx.prisma, {
      brand: "Fiat",
      model: "Argo",
      year: 2022,
      askingPriceBRL: 70000,
      sourceUrl: "https://example.com/argo2",
      sourcePlatform: "VIP Leilões",
      sellerType: "auction",
      bodyType: "hatch",
      mileageKm: 20000,
    });
    await ctx.prisma.car.update({
      where: { id: lead.carId },
      data: { pipelineStage: "researching" },
    });

    const summary = await applyGoalFilter(ctx.prisma);
    expect(summary.evaluated).toBe(0);
    const car = await ctx.prisma.car.findUnique({ where: { id: lead.carId } });
    expect(car!.pipelineStage).toBe("researching");
  });
});
