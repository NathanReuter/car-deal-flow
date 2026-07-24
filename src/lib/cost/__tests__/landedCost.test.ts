import { describe, expect, it } from "vitest";
import { computeLandedCost } from "../landedCost";
import {
  AUCTION_COMMISSION_RATE,
  DETRAN_TRANSFER_SC_MID_BRL,
  POST_ARREMATE_BUFFER_BRL,
} from "../auctionFees";

describe("computeLandedCost", () => {
  it("returns null when ask is missing or non-positive", () => {
    expect(
      computeLandedCost({
        askingPriceBRL: 0,
        city: "SP",
        state: "SP",
        dealPhase: "market",
      }).landedCostBRL,
    ).toBeNull();
    expect(
      computeLandedCost({
        askingPriceBRL: -1,
        city: "SP",
        state: "SP",
        dealPhase: "auction",
      }).landedCostBRL,
    ).toBeNull();
  });

  it("market out of SC: ask + frete only", () => {
    const r = computeLandedCost({
      askingPriceBRL: 100_000,
      dealPhase: "market",
      city: "São Paulo",
      state: "SP",
    });
    expect(r.baseCashBRL).toBe(100_000);
    expect(r.components.freteBRL).toBe(1098);
    expect(r.components.auctionCommissionBRL).toBe(0);
    expect(r.components.detranTransferBRL).toBe(0);
    expect(r.components.postArremateBufferBRL).toBe(0);
    expect(r.landedCostBRL).toBe(101_098);
  });

  it("auction in SC: fees + buffer, frete 0", () => {
    const lance = 50_000;
    const r = computeLandedCost({
      askingPriceBRL: lance,
      dealPhase: "auction",
      city: "Florianópolis",
      state: "SC",
    });
    expect(r.components.freteBRL).toBe(0);
    expect(r.components.auctionCommissionBRL).toBe(lance * AUCTION_COMMISSION_RATE);
    expect(r.components.detranTransferBRL).toBe(DETRAN_TRANSFER_SC_MID_BRL);
    expect(r.components.postArremateBufferBRL).toBe(POST_ARREMATE_BUFFER_BRL);
    expect(r.landedCostBRL).toBe(lance + 2500 + 1200 + 1700);
  });

  it("golden: Goiânia auction all-in", () => {
    const lance = 33_000;
    const r = computeLandedCost({
      askingPriceBRL: lance,
      dealPhase: "auction",
      city: "Goiânia",
      state: "GO",
    });
    // frete 2600 + 5%*33000=1650 + DETRAN 1200 + buffer 1700
    expect(r.landedCostBRL).toBe(33_000 + 2600 + 1650 + 1200 + 1700);
    expect(r.meta.freteSource).toBe("city");
  });

  it("repasse: base is asking only (no debt double-count) + frete if out of SC", () => {
    const r = computeLandedCost({
      askingPriceBRL: 90_000, // already entry+saldo per write-lead
      dealPhase: "pre_repossession",
      city: "Brasília",
      state: "DF",
    });
    expect(r.baseCashBRL).toBe(90_000);
    expect(r.components.freteBRL).toBe(2750);
    expect(r.components.auctionCommissionBRL).toBe(0);
    expect(r.landedCostBRL).toBe(92_750);
  });

  it("defaults undefined dealPhase to auction (legacy)", () => {
    const r = computeLandedCost({
      askingPriceBRL: 10_000,
      city: "Curitiba",
      state: "PR",
    });
    expect(r.components.auctionCommissionBRL).toBe(500);
    expect(r.landedCostBRL).toBe(10_000 + 775 + 500 + 1200 + 1700);
  });
});
