import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbContext } from "./test-db";
import { listTargets } from "../list-targets";
import { writeResult } from "../write-result";
import { writeLead } from "../../ingestion/write-lead";

async function seedRepasseCar(ctx: TestDbContext, url: string, plate?: string) {
  const result = await writeLead(ctx.prisma, {
    brand: "Fiat",
    model: "Argo",
    year: 2023,
    sourceUrl: url,
    sourcePlatform: "OLX",
    sellerType: "repasse",
    bodyType: "hatch",
    dealPhase: "pre_repossession",
    entryAskBRL: 15000,
    outstandingDebtBRL: 42000,
    plate,
  });
  return result.carId;
}

describe("phase-1 verification (repasse qualification gate)", () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createTestDb();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  it("listTargets --phase pre returns only plated pre_repossession cars, lien+judicial keys only", async () => {
    const plated = await seedRepasseCar(ctx, "https://olx.com.br/ad/1", "ABC1D23");
    await seedRepasseCar(ctx, "https://olx.com.br/ad/2"); // no plate

    const targets = await listTargets(ctx.prisma, { phase: "pre" });
    expect(targets.length).toBeGreaterThan(0);
    expect(new Set(targets.map((t) => t.carId))).toEqual(new Set([plated]));
    expect(new Set(targets.map((t) => t.key))).toEqual(
      new Set(["financing_lien", "judicial_restriction"]),
    );
  });

  it("gravame confirmed (financing_lien verified) promotes the lead to researching", async () => {
    const carId = await seedRepasseCar(ctx, "https://olx.com.br/ad/3", "ABC1D23");

    await writeResult(ctx.prisma, {
      carId,
      key: "financing_lien",
      status: "verified",
      severity: "low",
      notes: "Gravame ativo: Banco X, alienação fiduciária.",
    });

    const car = await ctx.prisma.car.findUnique({ where: { id: carId } });
    expect(car!.pipelineStage).toBe("researching");
    expect(car!.stageReason).toMatch(/gravame/i);
  });

  it("no gravame found (financing_lien warning) keeps the lead in new_lead", async () => {
    const carId = await seedRepasseCar(ctx, "https://olx.com.br/ad/4", "ABC1D23");

    await writeResult(ctx.prisma, {
      carId,
      key: "financing_lien",
      status: "warning",
      severity: "high",
      notes: "Nenhum gravame encontrado — possível golpe do repasse.",
    });

    const car = await ctx.prisma.car.findUnique({ where: { id: carId } });
    expect(car!.pipelineStage).toBe("new_lead");
  });

  it("judicial restriction found bumps repasseUrgency to high", async () => {
    const carId = await seedRepasseCar(ctx, "https://olx.com.br/ad/5", "ABC1D23");

    await writeResult(ctx.prisma, {
      carId,
      key: "judicial_restriction",
      status: "failed",
      severity: "high",
      notes: "Restrição RENAJUD ativa.",
    });

    const car = await ctx.prisma.car.findUnique({ where: { id: carId } });
    expect(car!.repasseUrgency).toBe("high");
  });

  it("auction cars get no repasse side effects from the same writes", async () => {
    const result = await writeLead(ctx.prisma, {
      brand: "Fiat",
      model: "Argo",
      year: 2023,
      askingPriceBRL: 52000,
      sourceUrl: "https://vitrinebradesco.com.br/lot/argo-1",
      sourcePlatform: "Bradesco Vitrine",
      sellerType: "bank_recovery",
      bodyType: "hatch",
      plate: "XYZ9A88",
    });

    await writeResult(ctx.prisma, {
      carId: result.carId,
      key: "financing_lien",
      status: "verified",
      severity: "low",
      notes: "Sem gravame (leilão quitado).",
    });

    const car = await ctx.prisma.car.findUnique({ where: { id: result.carId } });
    expect(car!.pipelineStage).toBe("new_lead");
    expect(car!.repasseUrgency).toBeNull();
  });
});
