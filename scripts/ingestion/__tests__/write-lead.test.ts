import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createTestDb, type TestDbContext } from "../../risk-checks/__tests__/test-db";
import { writeLead, WriteLeadError, defaultChannelForPlatform } from "../write-lead";
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

  it("rejects leads with collision / monta in notes", async () => {
    await expect(
      writeLead(ctx.prisma, {
        ...baseInput,
        sourceUrl: "https://example.com/damaged-1",
        notes: "Sinistro: COLISÃO\nMonta: MEDIA MONTA",
      }),
    ).rejects.toThrow(/damage\/sinistro/i);
  });

  it("allows damaged notes with --force-damaged", async () => {
    const result = await writeLead(ctx.prisma, {
      ...baseInput,
      sourceUrl: "https://example.com/damaged-force",
      notes: "Sinistro: COLISÃO\nMonta: MEDIA MONTA",
      forceDamaged: true,
    });
    expect(result.created).toBe(true);
    const risk = await ctx.prisma.riskCheck.findUnique({ where: { carId: result.carId } });
    const items = JSON.parse(risk!.items) as RiskCheckItem[];
    const accident = items.find((i) => i.key === "accident_flags")!;
    expect(accident.status).toBe("failed");
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

  it("preserves plate and chassis when omitted on same-URL re-harvest", async () => {
    const first = await writeLead(ctx.prisma, {
      ...baseInput,
      plate: "ABC1D23",
      chassis: "KEEPCHASSIS001",
    });

    await writeLead(ctx.prisma, {
      ...baseInput,
      askingPriceBRL: 93000,
      // plate/chassis intentionally omitted
    });

    const car = await ctx.prisma.car.findUnique({ where: { id: first.carId } });
    expect(car!.plate).toBe("ABC1D23");
    expect(car!.chassis).toBe("KEEPCHASSIS001");
    expect(car!.askingPriceBRL).toBe(93000);
  });

  it("does not plate-merge on weak/partial plates", async () => {
    const first = await writeLead(ctx.prisma, {
      ...baseInput,
      sourceUrl: "https://a.example/weak-1",
      plate: "FINAL3",
    });
    const second = await writeLead(ctx.prisma, {
      ...baseInput,
      sourceUrl: "https://b.example/weak-2",
      sourcePlatform: "BIDchain",
      plate: "final3",
    });

    expect(second.created).toBe(true);
    expect(second.merged).toBe(false);
    expect(second.carId).not.toBe(first.carId);
  });

  it("rejects same-URL update when chassis already belongs to another car", async () => {
    await writeLead(ctx.prisma, {
      ...baseInput,
      sourceUrl: "https://a.example/owner",
      chassis: "SHAREDCHASSIS99",
    });
    await writeLead(ctx.prisma, {
      ...baseInput,
      sourceUrl: "https://b.example/other",
      sourcePlatform: "BIDchain",
    });

    await expect(
      writeLead(ctx.prisma, {
        ...baseInput,
        sourceUrl: "https://b.example/other",
        sourcePlatform: "BIDchain",
        chassis: "SHAREDCHASSIS99",
      }),
    ).rejects.toThrow(/already belongs/);
  });

  it("updates CarSource platform on same-URL re-harvest", async () => {
    await writeLead(ctx.prisma, {
      ...baseInput,
      sourcePlatform: "Wrong Label",
    });
    await writeLead(ctx.prisma, {
      ...baseInput,
      sourcePlatform: "Bradesco Vitrine",
    });

    const sources = await ctx.prisma.carSource.findMany({
      where: { sourceUrl: baseInput.sourceUrl },
    });
    expect(sources).toHaveLength(1);
    expect(sources[0]!.sourcePlatform).toBe("Bradesco Vitrine");
  });

  it("persists auctionDate onto the CarSource row on create", async () => {
    const auctionDate = new Date("2026-08-01T14:00:00-03:00");
    const result = await writeLead(ctx.prisma, { ...baseInput, auctionDate });

    const source = await ctx.prisma.carSource.findUnique({ where: { sourceUrl: baseInput.sourceUrl } });
    expect(source!.auctionDate).toEqual(auctionDate);
    expect(result.created).toBe(true);
  });

  it("defaults CarSource.auctionDate to null when omitted", async () => {
    const result = await writeLead(ctx.prisma, baseInput);
    const source = await ctx.prisma.carSource.findUnique({ where: { sourceUrl: baseInput.sourceUrl } });
    expect(source!.auctionDate).toBeNull();
    expect(result.created).toBe(true);
  });

  it("refreshes CarSource.auctionDate on re-harvest of the same source", async () => {
    await writeLead(ctx.prisma, { ...baseInput, auctionDate: new Date("2026-08-01T14:00:00-03:00") });
    await writeLead(ctx.prisma, { ...baseInput, auctionDate: new Date("2026-09-15T14:00:00-03:00") });

    const source = await ctx.prisma.carSource.findUnique({ where: { sourceUrl: baseInput.sourceUrl } });
    expect(source!.auctionDate).toEqual(new Date("2026-09-15T14:00:00-03:00"));
  });

  it("resets an expired car to new_lead when the re-harvested source has a future auctionDate", async () => {
    const first = await writeLead(ctx.prisma, { ...baseInput, auctionDate: new Date("2026-01-01T00:00:00Z") });
    await ctx.prisma.car.update({
      where: { id: first.carId },
      data: { pipelineStage: "expired", stageReason: "Auction date(s) passed." },
    });

    const future = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    const second = await writeLead(ctx.prisma, { ...baseInput, auctionDate: future });

    expect(second.carId).toBe(first.carId);
    const car = await ctx.prisma.car.findUnique({ where: { id: first.carId } });
    expect(car!.pipelineStage).toBe("new_lead");
    expect(car!.stageReason).toBeNull();
  });

  it("keeps an expired car expired when the re-harvested source still has no future auctionDate", async () => {
    const first = await writeLead(ctx.prisma, { ...baseInput, auctionDate: new Date("2026-01-01T00:00:00Z") });
    await ctx.prisma.car.update({
      where: { id: first.carId },
      data: { pipelineStage: "expired", stageReason: "Auction date(s) passed." },
    });

    await writeLead(ctx.prisma, { ...baseInput, auctionDate: new Date("2026-01-02T00:00:00Z") });

    const car = await ctx.prisma.car.findUnique({ where: { id: first.carId } });
    expect(car!.pipelineStage).toBe("expired");
    expect(car!.stageReason).toBe("Auction date(s) passed.");
  });
});

describe("writeLead repasse (pre_repossession)", () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createTestDb();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  const repasseInput = {
    brand: "Fiat",
    model: "Argo",
    year: 2023,
    sourceUrl: "https://olx.com.br/anuncio/argo-repasse-1",
    sourcePlatform: "OLX",
    sellerType: "repasse" as const,
    bodyType: "hatch" as const,
    dealPhase: "pre_repossession" as const,
  };

  it("derives askingPriceBRL = entrada + saldo and stamps the breakdown", async () => {
    const result = await writeLead(ctx.prisma, {
      ...repasseInput,
      entryAskBRL: 15000,
      outstandingDebtBRL: 42000,
      installmentBRL: 1250,
      installmentsRemaining: 30,
      sellerContact: "+55 83 99999-0000",
    });
    expect(result.created).toBe(true);

    const car = await ctx.prisma.car.findUnique({ where: { id: result.carId } });
    expect(car!.dealPhase).toBe("pre_repossession");
    expect(car!.askingPriceBRL).toBe(57000);
    expect(car!.entryAskBRL).toBe(15000);
    expect(car!.outstandingDebtBRL).toBe(42000);
    expect(car!.installmentBRL).toBe(1250);
    expect(car!.installmentsRemaining).toBe(30);
    expect(car!.sellerContact).toBe("+55 83 99999-0000");
    expect(car!.notes).toMatch(/entrada R\$ ?15\.?000/i);
    expect(car!.notes).toMatch(/saldo devedor R\$ ?42\.?000/i);
    // LGPD: contact lives only in its column, never in notes.
    expect(car!.notes).not.toContain("99999-0000");
    // Auction lance-mínimo semantics do not apply to repasse leads.
    expect(car!.notes).not.toContain("lance mínimo");
  });

  it("writes with entrada only and flags undisclosed saldo devedor", async () => {
    const result = await writeLead(ctx.prisma, {
      ...repasseInput,
      sourceUrl: "https://olx.com.br/anuncio/argo-repasse-2",
      entryAskBRL: 18000,
      outstandingDebtBRL: null,
    });
    expect(result.created).toBe(true);

    const car = await ctx.prisma.car.findUnique({ where: { id: result.carId } });
    expect(car!.askingPriceBRL).toBe(18000);
    expect(car!.outstandingDebtBRL).toBeNull();
    expect(car!.notes).toMatch(/saldo devedor não informado/i);
  });

  it("rejects a repasse lead with no entrada (no price anchor)", async () => {
    await expect(
      writeLead(ctx.prisma, {
        ...repasseInput,
        sourceUrl: "https://olx.com.br/anuncio/argo-repasse-3",
        entryAskBRL: null,
        outstandingDebtBRL: 42000,
      }),
    ).rejects.toThrow(WriteLeadError);
  });

  it("rejects a supplied askingPriceBRL on a repasse lead (price is derived)", async () => {
    await expect(
      writeLead(ctx.prisma, {
        ...repasseInput,
        sourceUrl: "https://olx.com.br/anuncio/argo-repasse-5",
        askingPriceBRL: 57000,
        entryAskBRL: 15000,
        outstandingDebtBRL: 42000,
      }),
    ).rejects.toThrow(/derive/i);
  });

  it("rejects an invalid repasseUrgency value", async () => {
    await expect(
      writeLead(ctx.prisma, {
        ...repasseInput,
        sourceUrl: "https://olx.com.br/anuncio/argo-repasse-6",
        entryAskBRL: 15000,
        repasseUrgency: "banana" as never,
      }),
    ).rejects.toThrow(/repasseUrgency/);
  });

  it("refreshes repasse economics when the same ad URL is re-harvested", async () => {
    const url = "https://olx.com.br/anuncio/argo-repasse-7";
    const first = await writeLead(ctx.prisma, {
      ...repasseInput,
      sourceUrl: url,
      entryAskBRL: 15000,
      outstandingDebtBRL: null,
    });

    const second = await writeLead(ctx.prisma, {
      ...repasseInput,
      sourceUrl: url,
      entryAskBRL: 14000,
      outstandingDebtBRL: 40000,
    });

    expect(second.carId).toBe(first.carId);
    const car = await ctx.prisma.car.findUnique({ where: { id: first.carId } });
    expect(car!.entryAskBRL).toBe(14000);
    expect(car!.outstandingDebtBRL).toBe(40000);
    expect(car!.askingPriceBRL).toBe(54000);
  });

  it("merges a later auction write into an existing repasse car and stamps window closed", async () => {
    const first = await writeLead(ctx.prisma, {
      ...repasseInput,
      sourceUrl: "https://olx.com.br/anuncio/argo-repasse-4",
      entryAskBRL: 15000,
      outstandingDebtBRL: 42000,
      plate: "ABC1D23",
    });

    const second = await writeLead(ctx.prisma, {
      brand: "Fiat",
      model: "Argo",
      year: 2023,
      askingPriceBRL: 52000,
      sourceUrl: "https://vitrinebradesco.com.br/lot/argo-9",
      sourcePlatform: "Bradesco Vitrine",
      sellerType: "bank_recovery",
      bodyType: "hatch",
      plate: "ABC1D23",
    });

    expect(second.merged).toBe(true);
    expect(second.carId).toBe(first.carId);

    const car = await ctx.prisma.car.findUnique({ where: { id: first.carId } });
    expect(car!.dealPhase).toBe("auction");
    expect(car!.notes).toMatch(/reapareceu em leilão/i);
  });
});

describe("writeLead sourceChannel/confidence", () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createTestDb();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  const baseAuction = {
    brand: "Hyundai",
    model: "Creta",
    year: 2022,
    askingPriceBRL: 95000,
    sourcePlatform: "Bradesco Vitrine",
    sellerType: "bank_recovery" as const,
    bodyType: "suv" as const,
  };

  it("rejects invalid sourceChannel (WriteLeadError)", async () => {
    await expect(
      writeLead(ctx.prisma, {
        ...baseAuction,
        sourceUrl: "https://vitrinebradesco.com.br/lot/ch-reject-1",
        sourceChannel: "social_media" as never,
      }),
    ).rejects.toThrow(WriteLeadError);
  });

  it("rejects invalid confidence (WriteLeadError)", async () => {
    await expect(
      writeLead(ctx.prisma, {
        ...baseAuction,
        sourceUrl: "https://vitrinebradesco.com.br/lot/ch-reject-2",
        confidence: "very_high" as never,
      }),
    ).rejects.toThrow(WriteLeadError);
  });

  it("create with explicit sourceChannel/confidence persists them", async () => {
    const result = await writeLead(ctx.prisma, {
      ...baseAuction,
      sourceUrl: "https://vitrinebradesco.com.br/lot/ch-explicit-1",
      sourceChannel: "auction_house",
      confidence: "medium",
    });
    expect(result.created).toBe(true);
    const car = await ctx.prisma.car.findUnique({ where: { id: result.carId } });
    expect(car!.sourceChannel).toBe("auction_house");
    expect(car!.confidence).toBe("medium");
  });

  it("OLX platform defaults to classifieds/high; MGL defaults to auction_house/high", async () => {
    const olxResult = await writeLead(ctx.prisma, {
      ...baseAuction,
      sourceUrl: "https://olx.com.br/anuncio/creta-1",
      sourcePlatform: "OLX",
    });
    const olxCar = await ctx.prisma.car.findUnique({ where: { id: olxResult.carId } });
    expect(olxCar!.sourceChannel).toBe("classifieds");
    expect(olxCar!.confidence).toBe("high");

    const mglResult = await writeLead(ctx.prisma, {
      ...baseAuction,
      sourceUrl: "https://mgl.com.br/lot/creta-2",
      sourcePlatform: "MGL",
    });
    const mglCar = await ctx.prisma.car.findUnique({ where: { id: mglResult.carId } });
    expect(mglCar!.sourceChannel).toBe("auction_house");
    expect(mglCar!.confidence).toBe("high");
  });

  it("defaultChannelForPlatform: auction platforms → auction_house; OLX/other → classifieds", () => {
    expect(defaultChannelForPlatform("Bradesco Vitrine")).toBe("auction_house");
    expect(defaultChannelForPlatform("VIP Leilões")).toBe("auction_house");
    expect(defaultChannelForPlatform("BIDchain")).toBe("auction_house");
    expect(defaultChannelForPlatform("MGL")).toBe("auction_house");
    expect(defaultChannelForPlatform("Santander Retomados")).toBe("auction_house");
    expect(defaultChannelForPlatform("OLX")).toBe("classifieds");
    expect(defaultChannelForPlatform("SomeUnknownPlatform")).toBe("classifieds");
  });

  it("URL-dedup update does not overwrite existing sourceChannel/confidence", async () => {
    const first = await writeLead(ctx.prisma, {
      ...baseAuction,
      sourceUrl: "https://vitrinebradesco.com.br/lot/ch-dedup-1",
      sourceChannel: "auction_house",
      confidence: "medium",
    });
    expect(first.created).toBe(true);

    // Re-harvest the same URL without specifying channel/confidence — defaults would be auction_house/high
    const second = await writeLead(ctx.prisma, {
      ...baseAuction,
      sourceUrl: "https://vitrinebradesco.com.br/lot/ch-dedup-1",
      askingPriceBRL: 90000,
      // No sourceChannel or confidence — do not overwrite
    });
    expect(second.updated).toBe(true);
    expect(second.carId).toBe(first.carId);

    const car = await ctx.prisma.car.findUnique({ where: { id: first.carId } });
    expect(car!.sourceChannel).toBe("auction_house");
    expect(car!.confidence).toBe("medium");
  });
});

describe("writeLead market phase", () => {
  let ctx: TestDbContext;

  beforeEach(() => {
    ctx = createTestDb();
  });

  afterEach(async () => {
    await ctx.cleanup();
  });

  const marketInput = {
    brand: "Volkswagen",
    model: "Nivus",
    year: 2023,
    askingPriceBRL: 82000,
    sourceUrl: "https://napista.com.br/anuncio/nivus-1",
    sourcePlatform: "NaPista",
    sellerType: "dealer" as const,
    bodyType: "suv" as const,
    dealPhase: "market" as const,
  };

  it("creates a market lead with askingPriceBRL and persists dealPhase 'market'", async () => {
    const result = await writeLead(ctx.prisma, marketInput);
    expect(result.created).toBe(true);

    const car = await ctx.prisma.car.findUnique({ where: { id: result.carId } });
    expect(car!.dealPhase).toBe("market");
    expect(car!.askingPriceBRL).toBe(82000);
  });

  it("rejects a market lead that carries entryAskBRL (repasse fields forbidden)", async () => {
    await expect(
      writeLead(ctx.prisma, {
        ...marketInput,
        sourceUrl: "https://napista.com.br/anuncio/nivus-2",
        entryAskBRL: 20000,
      }),
    ).rejects.toThrow(WriteLeadError);
  });

  it("rejects a market lead missing askingPriceBRL", async () => {
    await expect(
      writeLead(ctx.prisma, {
        ...marketInput,
        sourceUrl: "https://napista.com.br/anuncio/nivus-3",
        askingPriceBRL: undefined,
      }),
    ).rejects.toThrow(WriteLeadError);
  });
});
