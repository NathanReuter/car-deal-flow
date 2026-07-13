import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDbContext } from "./test-db";
import { writeResult, WriteResultError } from "../write-result";
import type { RiskCheckItem } from "../../../src/lib/types";

describe("writeResult", () => {
  let ctx: TestDbContext;

  const baseItems: RiskCheckItem[] = [
    { key: "recall_status", status: "pending", severity: "low", notes: "" },
    { key: "financing_lien", status: "pending", severity: "low", notes: "" },
  ];

  beforeAll(async () => {
    ctx = createTestDb();
    await ctx.prisma.car.create({
      data: {
        id: "test-car-1",
        brand: "Fiat", model: "Argo", trim: "Drive", year: 2021, modelYear: 2021,
        mileageKm: 1000, askingPriceBRL: 50000, city: "SP", state: "SP",
        sellerType: "owner", fuel: "flex", transmission: "manual", bodyType: "hatch",
        color: "White", sourceUrl: "https://x", sourcePlatform: "OLX", notes: "",
        photos: "[]", pipelineStage: "new_lead", fipeValueBRL: 50000,
      },
    });
    await ctx.prisma.riskCheck.create({
      data: {
        carId: "test-car-1",
        items: JSON.stringify(baseItems),
        caixaApplicable: false, caixaEditalReviewed: false, caixaHiddenTransferCosts: 0,
        caixaResaleStigmaNote: "", caixaHistoryClarity: "clear", caixaLegalTransferRisk: "",
      },
    });
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("rejects an invalid status", async () => {
    await expect(
      writeResult(ctx.prisma, {
        carId: "test-car-1", key: "recall_status", status: "bogus" as never,
        severity: "low", notes: "x",
      }),
    ).rejects.toThrow(WriteResultError);
  });

  it("rejects an invalid severity", async () => {
    await expect(
      writeResult(ctx.prisma, {
        carId: "test-car-1", key: "recall_status", status: "verified",
        severity: "bogus" as never, notes: "x",
      }),
    ).rejects.toThrow(WriteResultError);
  });

  it("rejects a car with no RiskCheck row", async () => {
    await expect(
      writeResult(ctx.prisma, {
        carId: "does-not-exist", key: "recall_status", status: "verified",
        severity: "low", notes: "x",
      }),
    ).rejects.toThrow(/No RiskCheck row/);
  });

  it("writes a confident result with agent provenance, leaving other items untouched", async () => {
    await writeResult(ctx.prisma, {
      carId: "test-car-1", key: "recall_status", status: "verified",
      severity: "low", notes: "No pending recalls found.",
      evidenceUrl: "https://portalservicos.senatran.serpro.gov.br/x",
    });

    const row = await ctx.prisma.riskCheck.findUnique({ where: { carId: "test-car-1" } });
    const items = JSON.parse(row!.items) as RiskCheckItem[];
    const recall = items.find((i) => i.key === "recall_status")!;
    const lien = items.find((i) => i.key === "financing_lien")!;

    expect(recall.status).toBe("verified");
    expect(recall.checkedBy).toBe("agent");
    expect(typeof recall.checkedAt).toBe("string");
    expect(lien.status).toBe("pending");
    expect(lien.checkedBy).toBeUndefined();
  });
});
