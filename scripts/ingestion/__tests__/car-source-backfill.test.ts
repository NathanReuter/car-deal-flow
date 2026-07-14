import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbContext } from "../../risk-checks/__tests__/test-db";
import { backfillCarSources } from "../backfill-car-sources";

describe("backfillCarSources", () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createTestDb();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("creates one CarSource per existing Car from primary sourceUrl/platform", async () => {
    const car = await ctx.prisma.car.create({
      data: {
        brand: "Chevrolet",
        model: "Onix",
        trim: "",
        year: 2022,
        modelYear: 2022,
        mileageKm: null,
        askingPriceBRL: 35000,
        city: "SP",
        state: "SP",
        sellerType: "auction",
        fuel: "flex",
        transmission: "manual",
        bodyType: "hatch",
        color: "Prata",
        sourceUrl: "https://vitrinebradesco.com.br/auctions/onix-1",
        sourcePlatform: "Bradesco Vitrine",
        notes: "",
        photos: "[]",
        pipelineStage: "new_lead",
      },
    });

    const summary = await backfillCarSources(ctx.prisma);

    expect(summary.created).toBe(1);
    expect(summary.skipped).toBe(0);

    const sources = await ctx.prisma.carSource.findMany({ where: { carId: car.id } });
    expect(sources).toHaveLength(1);
    expect(sources[0]!.sourceUrl).toBe(car.sourceUrl);
    expect(sources[0]!.sourcePlatform).toBe("Bradesco Vitrine");
  });

  it("is idempotent — does not duplicate when CarSource already exists", async () => {
    const car = await ctx.prisma.car.create({
      data: {
        brand: "VW",
        model: "Gol",
        trim: "",
        year: 2021,
        modelYear: 2021,
        mileageKm: null,
        askingPriceBRL: 20000,
        city: "RJ",
        state: "RJ",
        sellerType: "auction",
        fuel: "flex",
        transmission: "manual",
        bodyType: "hatch",
        color: "Branco",
        sourceUrl: "https://example.com/gol-1",
        sourcePlatform: "VIP Leilões",
        notes: "",
        photos: "[]",
        pipelineStage: "new_lead",
      },
    });

    await ctx.prisma.carSource.create({
      data: {
        carId: car.id,
        sourceUrl: car.sourceUrl,
        sourcePlatform: car.sourcePlatform,
        lastSeenAt: new Date(),
      },
    });

    const summary = await backfillCarSources(ctx.prisma);
    expect(summary.created).toBe(0);
    expect(summary.skipped).toBe(1);

    const sources = await ctx.prisma.carSource.findMany({ where: { carId: car.id } });
    expect(sources).toHaveLength(1);
  });
});
