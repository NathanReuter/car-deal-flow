import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createTestDb, type TestDbContext } from "./test-db";
import { listTargets } from "../list-targets";
import type { RiskCheckItem } from "../../../src/lib/types";

describe("listTargets", () => {
  let ctx: TestDbContext;

  async function makeCar(id: string, stage: string, items: RiskCheckItem[]) {
    await ctx.prisma.car.create({
      data: {
        id, brand: "Fiat", model: "Argo", trim: "Drive", year: 2021, modelYear: 2021,
        mileageKm: 1000, askingPriceBRL: 50000, city: "SP", state: "SP",
        sellerType: "owner", fuel: "flex", transmission: "manual", bodyType: "hatch",
        color: "White", sourceUrl: `https://example.com/${id}`, sourcePlatform: "OLX", notes: "",
        photos: "[]", pipelineStage: stage, fipeValueBRL: 50000,
      },
    });
    await ctx.prisma.riskCheck.create({
      data: {
        carId: id, items: JSON.stringify(items),
        caixaApplicable: false, caixaEditalReviewed: false, caixaHiddenTransferCosts: 0,
        caixaResaleStigmaNote: "", caixaHistoryClarity: "clear", caixaLegalTransferRisk: "",
      },
    });
  }

  const pendingItem: RiskCheckItem = { key: "recall_status", status: "pending", severity: "low", notes: "" };
  const verifiedManualItem: RiskCheckItem = { key: "financing_lien", status: "verified", severity: "low", notes: "" };
  const staleAgentItem: RiskCheckItem = {
    key: "judicial_restriction", status: "verified", severity: "low", notes: "",
    checkedBy: "agent", checkedAt: new Date(Date.now() - 40 * 24 * 60 * 60 * 1000).toISOString(),
  };
  const freshAgentItem: RiskCheckItem = {
    key: "overdue_taxes_fines", status: "verified", severity: "low", notes: "",
    checkedBy: "agent", checkedAt: new Date().toISOString(),
  };
  const manualVerifiedNeverTouch: RiskCheckItem = {
    key: "chassis_consistency", status: "warning", severity: "medium", notes: "user note",
  };
  const nonAutomatableKey: RiskCheckItem = { key: "service_records", status: "pending", severity: "low", notes: "" };

  beforeAll(async () => {
    ctx = createTestDb();
    await makeCar("active-with-pending", "researching", [pendingItem, verifiedManualItem]);
    await makeCar("active-stale-agent", "inspected", [staleAgentItem, freshAgentItem]);
    await makeCar("active-manual-only", "new_lead", [manualVerifiedNeverTouch]);
    await makeCar("rejected-car", "rejected", [pendingItem]);
    await makeCar("bought-car", "bought", [pendingItem]);
    await makeCar("active-non-automatable", "new_lead", [nonAutomatableKey]);
  });

  afterAll(async () => {
    await ctx.cleanup();
  });

  it("includes pending items on active-stage cars", async () => {
    const targets = await listTargets(ctx.prisma);
    expect(targets.some((t) => t.carId === "active-with-pending" && t.key === "recall_status")).toBe(true);
  });

  it("excludes verified manual items", async () => {
    const targets = await listTargets(ctx.prisma);
    expect(targets.some((t) => t.carId === "active-with-pending" && t.key === "financing_lien")).toBe(false);
  });

  it("includes stale agent-checked items but not fresh ones", async () => {
    const targets = await listTargets(ctx.prisma);
    expect(targets.some((t) => t.carId === "active-stale-agent" && t.key === "judicial_restriction")).toBe(true);
    expect(targets.some((t) => t.carId === "active-stale-agent" && t.key === "overdue_taxes_fines")).toBe(false);
  });

  it("excludes cars in rejected/bought stages by default", async () => {
    const targets = await listTargets(ctx.prisma);
    expect(targets.some((t) => t.carId === "rejected-car")).toBe(false);
    expect(targets.some((t) => t.carId === "bought-car")).toBe(false);
  });

  it("includes a rejected car when explicitly targeted by --car", async () => {
    const targets = await listTargets(ctx.prisma, { carId: "rejected-car" });
    expect(targets.some((t) => t.carId === "rejected-car" && t.key === "recall_status")).toBe(true);
  });

  it("ignores keys not in the automatable set", async () => {
    const targets = await listTargets(ctx.prisma);
    expect(targets.some((t) => t.carId === "active-non-automatable")).toBe(false);
  });
});
