import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbContext } from "../../risk-checks/__tests__/test-db";
import { writeLead, WriteLeadError } from "../write-lead";
import type { RiskCheckItem } from "../../../src/lib/types";

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

describe("writeLead", () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createTestDb();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("rejects missing required fields", async () => {
    await expect(
      writeLead(ctx.prisma, { ...baseInput, brand: "" }),
    ).rejects.toThrow(WriteLeadError);
  });

  it("rejects missing bodyType", async () => {
    await expect(
      writeLead(ctx.prisma, { ...baseInput, bodyType: undefined as never }),
    ).rejects.toThrow(/bodyType/);
  });

  it("creates a lead with honest defaults and null FIPE/mileage", async () => {
    const result = await writeLead(ctx.prisma, {
      ...baseInput,
      mileageKm: null,
      editalUrl: "https://example.com/edital.pdf",
    });

    expect(result.created).toBe(true);
    const car = await ctx.prisma.car.findUnique({ where: { id: result.carId } });
    expect(car!.mileageKm).toBeNull();
    expect(car!.fipeValueBRL).toBeNull();
    expect(car!.trim).toBe("");
    expect(car!.pipelineStage).toBe("new_lead");
    expect(car!.notes).toContain("askingPriceBRL = minimum bid");
    expect(car!.city).toBe("Unknown");

    const risk = await ctx.prisma.riskCheck.findUnique({ where: { carId: result.carId } });
    const items = JSON.parse(risk!.items) as RiskCheckItem[];
    const mileage = items.find((i) => i.key === "mileage_inconsistency")!;
    expect(mileage.status).toBe("warning");
    expect(risk!.caixaApplicable).toBe(false);

    const attachments = await ctx.prisma.attachment.findMany({ where: { carId: result.carId } });
    expect(attachments).toHaveLength(1);
    expect(attachments[0].url).toBe("https://example.com/edital.pdf");
  });

  it("sets caixaApplicable when sellerType is caixa_recovery", async () => {
    const result = await writeLead(ctx.prisma, {
      ...baseInput,
      sourceUrl: "https://vipleiloes.com.br/lot/caixa-1",
      sellerType: "caixa_recovery",
    });
    const risk = await ctx.prisma.riskCheck.findUnique({ where: { carId: result.carId } });
    expect(risk!.caixaApplicable).toBe(true);
    expect(risk!.caixaHistoryClarity).toBe("unclear");
  });

  it("dedupes by sourceUrl and resets new_lead/parked stages", async () => {
    const first = await writeLead(ctx.prisma, baseInput);
    await ctx.prisma.car.update({
      where: { id: first.carId },
      data: { pipelineStage: "parked", stageReason: "old", askingPriceBRL: 100000 },
    });

    const second = await writeLead(ctx.prisma, {
      ...baseInput,
      askingPriceBRL: 88000,
    });

    expect(second.created).toBe(false);
    expect(second.carId).toBe(first.carId);
    const car = await ctx.prisma.car.findUnique({ where: { id: first.carId } });
    expect(car!.askingPriceBRL).toBe(88000);
    expect(car!.pipelineStage).toBe("new_lead");
    expect(car!.stageReason).toBeNull();
  });

  it("does not reset advanced pipeline stages on re-harvest", async () => {
    const first = await writeLead(ctx.prisma, baseInput);
    await ctx.prisma.car.update({
      where: { id: first.carId },
      data: { pipelineStage: "researching", stageReason: "manual" },
    });

    await writeLead(ctx.prisma, { ...baseInput, askingPriceBRL: 91000 });

    const car = await ctx.prisma.car.findUnique({ where: { id: first.carId } });
    expect(car!.askingPriceBRL).toBe(91000);
    expect(car!.pipelineStage).toBe("researching");
    expect(car!.stageReason).toBe("manual");
  });

  it("preserves prior notes on re-harvest when --notes is omitted", async () => {
    const first = await writeLead(ctx.prisma, {
      ...baseInput,
      notes: "Custom agent note about edital discrepancy.",
    });
    await writeLead(ctx.prisma, { ...baseInput, askingPriceBRL: 90000 });

    const car = await ctx.prisma.car.findUnique({ where: { id: first.carId } });
    expect(car!.notes).toContain("Custom agent note about edital discrepancy.");
    expect(car!.notes).toContain("askingPriceBRL = minimum bid");
  });

  it("syncs mileage warning and caixaApplicable on re-harvest", async () => {
    const first = await writeLead(ctx.prisma, {
      ...baseInput,
      mileageKm: null,
      sellerType: "auction",
    });
    await writeLead(ctx.prisma, {
      ...baseInput,
      mileageKm: 42000,
      sellerType: "caixa_recovery",
    });

    const risk = await ctx.prisma.riskCheck.findUnique({ where: { carId: first.carId } });
    const items = JSON.parse(risk!.items) as RiskCheckItem[];
    const mileage = items.find((i) => i.key === "mileage_inconsistency")!;
    expect(mileage.status).toBe("pending");
    expect(risk!.caixaApplicable).toBe(true);
  });

  it("rejects non-finite mileage", async () => {
    await expect(
      writeLead(ctx.prisma, { ...baseInput, mileageKm: Number.NaN }),
    ).rejects.toThrow(/mileageKm/);
  });

  it("rejects non-http source URLs", async () => {
    await expect(
      writeLead(ctx.prisma, { ...baseInput, sourceUrl: "javascript:alert(1)" }),
    ).rejects.toThrow(/http/);
  });

  it("creates a CarSource row for the primary URL on create", async () => {
    const result = await writeLead(ctx.prisma, baseInput);
    const sources = await ctx.prisma.carSource.findMany({ where: { carId: result.carId } });
    expect(sources).toHaveLength(1);
    expect(sources[0]!.sourceUrl).toBe(baseInput.sourceUrl);
    expect(sources[0]!.sourcePlatform).toBe("Bradesco Vitrine");
    expect(result.merged).toBe(false);
  });

  it("merges a second source URL when chassis matches (first-wins primary)", async () => {
    const first = await writeLead(ctx.prisma, {
      ...baseInput,
      chassis: "9BWZZZ377AT000001",
      mileageKm: null,
    });

    const second = await writeLead(ctx.prisma, {
      ...baseInput,
      sourceUrl: "https://bidchain.com.br/lote/creta-dup",
      sourcePlatform: "BIDchain",
      askingPriceBRL: 90000,
      chassis: "9bw-zzz-377-at-000001",
      mileageKm: 41000,
      sellerType: "auction",
    });

    expect(second.merged).toBe(true);
    expect(second.created).toBe(false);
    expect(second.carId).toBe(first.carId);

    const car = await ctx.prisma.car.findUnique({ where: { id: first.carId } });
    expect(car!.sourceUrl).toBe(baseInput.sourceUrl);
    expect(car!.sourcePlatform).toBe("Bradesco Vitrine");
    expect(car!.mileageKm).toBe(41000);

    const sources = await ctx.prisma.carSource.findMany({
      where: { carId: first.carId },
      orderBy: { firstSeenAt: "asc" },
    });
    expect(sources).toHaveLength(2);
    expect(sources.map((s) => s.sourcePlatform).sort()).toEqual(["BIDchain", "Bradesco Vitrine"]);
  });

  it("merges by normalized plate when chassis is absent", async () => {
    const first = await writeLead(ctx.prisma, {
      ...baseInput,
      sourceUrl: "https://vipleiloes.com.br/lot/a",
      sourcePlatform: "VIP Leilões",
      plate: "ABC-1D23",
    });

    const second = await writeLead(ctx.prisma, {
      ...baseInput,
      sourceUrl: "https://leiloespb.com.br/lot/b",
      sourcePlatform: "Leilões PB",
      plate: "abc1d23",
      askingPriceBRL: 91000,
    });

    expect(second.merged).toBe(true);
    expect(second.carId).toBe(first.carId);
    const car = await ctx.prisma.car.findUnique({ where: { id: first.carId } });
    expect(car!.sourcePlatform).toBe("VIP Leilões");
  });

  it("does not merge on brand+model+year alone", async () => {
    const first = await writeLead(ctx.prisma, baseInput);
    const second = await writeLead(ctx.prisma, {
      ...baseInput,
      sourceUrl: "https://mgl.com.br/lot/other-creta",
      sourcePlatform: "MGL",
    });

    expect(second.created).toBe(true);
    expect(second.merged).toBe(false);
    expect(second.carId).not.toBe(first.carId);
    expect(await ctx.prisma.car.count()).toBe(2);
  });

  it("does not downgrade researching stage on cross-source merge", async () => {
    const first = await writeLead(ctx.prisma, {
      ...baseInput,
      chassis: "CHASSISMERGE001",
    });
    await ctx.prisma.car.update({
      where: { id: first.carId },
      data: { pipelineStage: "researching", stageReason: "deep dive" },
    });

    await writeLead(ctx.prisma, {
      ...baseInput,
      sourceUrl: "https://bidchain.com.br/lote/merge-stage",
      sourcePlatform: "BIDchain",
      chassis: "CHASSISMERGE001",
    });

    const car = await ctx.prisma.car.findUnique({ where: { id: first.carId } });
    expect(car!.pipelineStage).toBe("researching");
    expect(car!.stageReason).toBe("deep dive");
  });
});
