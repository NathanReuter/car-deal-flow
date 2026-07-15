import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbContext } from "../../risk-checks/__tests__/test-db";
import { writeLead } from "../write-lead";
import { checkBrokenLinks, type LinkCheckResult } from "../check-broken-links";

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

function stubChecker(result: LinkCheckResult) {
  return async () => result;
}

describe("checkBrokenLinks", () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createTestDb();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("expires a car when its source URL returns 404", async () => {
    const lead = await writeLead(ctx.prisma, baseInput);

    const summary = await checkBrokenLinks(ctx.prisma, {
      checkUrl: stubChecker({ ok: true, status: 404 }),
      delayMs: 0,
    });

    expect(summary.expired).toBe(1);
    const car = await ctx.prisma.car.findUnique({ where: { id: lead.carId } });
    expect(car!.pipelineStage).toBe("expired");
    expect(car!.stageReason).toContain("404");
  });

  it("expires a car when its source URL returns 410", async () => {
    const lead = await writeLead(ctx.prisma, baseInput);

    const summary = await checkBrokenLinks(ctx.prisma, {
      checkUrl: stubChecker({ ok: true, status: 410 }),
      delayMs: 0,
    });

    expect(summary.expired).toBe(1);
    const car = await ctx.prisma.car.findUnique({ where: { id: lead.carId } });
    expect(car!.pipelineStage).toBe("expired");
  });

  it("leaves a car untouched when its source URL returns 200", async () => {
    const lead = await writeLead(ctx.prisma, baseInput);

    const summary = await checkBrokenLinks(ctx.prisma, {
      checkUrl: stubChecker({ ok: true, status: 200 }),
      delayMs: 0,
    });

    expect(summary.expired).toBe(0);
    expect(summary.inconclusive).toBe(1);
    const car = await ctx.prisma.car.findUnique({ where: { id: lead.carId } });
    expect(car!.pipelineStage).toBe("new_lead");
  });

  it("treats a 403 (likely Cloudflare) as inconclusive, not broken", async () => {
    const lead = await writeLead(ctx.prisma, baseInput);

    const summary = await checkBrokenLinks(ctx.prisma, {
      checkUrl: stubChecker({ ok: true, status: 403 }),
      delayMs: 0,
    });

    expect(summary.expired).toBe(0);
    expect(summary.inconclusive).toBe(1);
    const car = await ctx.prisma.car.findUnique({ where: { id: lead.carId } });
    expect(car!.pipelineStage).toBe("new_lead");
  });

  it("treats a network error/timeout as inconclusive, not broken", async () => {
    const lead = await writeLead(ctx.prisma, baseInput);

    const summary = await checkBrokenLinks(ctx.prisma, {
      checkUrl: stubChecker({ ok: false, error: "timeout" }),
      delayMs: 0,
    });

    expect(summary.expired).toBe(0);
    expect(summary.inconclusive).toBe(1);
    const car = await ctx.prisma.car.findUnique({ where: { id: lead.carId } });
    expect(car!.pipelineStage).toBe("new_lead");
  });

  it("only checks new_lead and parked cars", async () => {
    const lead = await writeLead(ctx.prisma, baseInput);
    await ctx.prisma.car.update({ where: { id: lead.carId }, data: { pipelineStage: "researching" } });

    const summary = await checkBrokenLinks(ctx.prisma, {
      checkUrl: stubChecker({ ok: true, status: 404 }),
      delayMs: 0,
    });

    expect(summary.evaluated).toBe(0);
    const car = await ctx.prisma.car.findUnique({ where: { id: lead.carId } });
    expect(car!.pipelineStage).toBe("researching");
  });

  it("does not re-check cars already marked expired", async () => {
    const lead = await writeLead(ctx.prisma, baseInput);
    await ctx.prisma.car.update({
      where: { id: lead.carId },
      data: { pipelineStage: "expired", stageReason: "Auction date(s) passed." },
    });

    const summary = await checkBrokenLinks(ctx.prisma, {
      checkUrl: stubChecker({ ok: true, status: 404 }),
      delayMs: 0,
    });

    expect(summary.evaluated).toBe(0);
    const car = await ctx.prisma.car.findUnique({ where: { id: lead.carId } });
    expect(car!.stageReason).toBe("Auction date(s) passed.");
  });
});
