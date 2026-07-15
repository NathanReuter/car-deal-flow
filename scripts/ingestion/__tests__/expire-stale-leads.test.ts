import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbContext } from "../../risk-checks/__tests__/test-db";
import { writeLead } from "../write-lead";
import { expireStaleLeads } from "../expire-stale-leads";

const NOW = new Date("2026-07-15T12:00:00Z");
const PAST = new Date("2026-07-01T12:00:00Z");
const FUTURE = new Date("2026-08-01T12:00:00Z");

const baseInput = {
  brand: "Hyundai",
  model: "Creta",
  year: 2022,
  askingPriceBRL: 95000,
  sourceUrl: "https://vitrinebradesco.com.br/lot/creta-1",
  sourcePlatform: "Bradesco Vitrine",
  sellerType: "bank_recovery" as const,
  bodyType: "suv" as const,
};

describe("expireStaleLeads", () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createTestDb();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("expires a new_lead car whose single source auction date has passed", async () => {
    const lead = await writeLead(ctx.prisma, { ...baseInput, auctionDate: PAST });

    const summary = await expireStaleLeads(ctx.prisma, NOW);

    expect(summary.evaluated).toBe(1);
    expect(summary.expired).toBe(1);
    const car = await ctx.prisma.car.findUnique({ where: { id: lead.carId } });
    expect(car!.pipelineStage).toBe("expired");
    expect(car!.stageReason).toContain("Bradesco Vitrine");
  });

  it("leaves a car untouched when its source has a future auction date", async () => {
    const lead = await writeLead(ctx.prisma, { ...baseInput, auctionDate: FUTURE });

    const summary = await expireStaleLeads(ctx.prisma, NOW);

    expect(summary.expired).toBe(0);
    const car = await ctx.prisma.car.findUnique({ where: { id: lead.carId } });
    expect(car!.pipelineStage).toBe("new_lead");
  });

  it("leaves a car untouched when its source has no known auction date", async () => {
    const lead = await writeLead(ctx.prisma, baseInput);

    const summary = await expireStaleLeads(ctx.prisma, NOW);

    expect(summary.expired).toBe(0);
    const car = await ctx.prisma.car.findUnique({ where: { id: lead.carId } });
    expect(car!.pipelineStage).toBe("new_lead");
  });

  it("leaves a parked car with a mix of past and future sources untouched", async () => {
    const lead = await writeLead(ctx.prisma, {
      ...baseInput,
      chassis: "MIXSOURCE0001",
      auctionDate: PAST,
    });
    await ctx.prisma.car.update({ where: { id: lead.carId }, data: { pipelineStage: "parked" } });
    await writeLead(ctx.prisma, {
      ...baseInput,
      sourceUrl: "https://bidchain.com.br/lote/creta-dup",
      sourcePlatform: "BIDchain",
      chassis: "mix-source-0001",
      auctionDate: FUTURE,
    });

    const summary = await expireStaleLeads(ctx.prisma, NOW);

    expect(summary.expired).toBe(0);
    const car = await ctx.prisma.car.findUnique({ where: { id: lead.carId } });
    expect(car!.pipelineStage).toBe("parked");
  });

  it("does not touch cars in advanced pipeline stages even with all-past dates", async () => {
    const lead = await writeLead(ctx.prisma, { ...baseInput, auctionDate: PAST });
    await ctx.prisma.car.update({
      where: { id: lead.carId },
      data: { pipelineStage: "negotiating" },
    });

    const summary = await expireStaleLeads(ctx.prisma, NOW);

    expect(summary.evaluated).toBe(0);
    const car = await ctx.prisma.car.findUnique({ where: { id: lead.carId } });
    expect(car!.pipelineStage).toBe("negotiating");
  });

  it("is idempotent — a second run finds nothing left to expire", async () => {
    await writeLead(ctx.prisma, { ...baseInput, auctionDate: PAST });

    await expireStaleLeads(ctx.prisma, NOW);
    const second = await expireStaleLeads(ctx.prisma, NOW);

    expect(second.evaluated).toBe(0);
    expect(second.expired).toBe(0);
  });
});
