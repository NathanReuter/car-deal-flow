import { describe, expect, it } from "vitest";
import {
  getAuctionDisplayStatus,
  parseAuctionDateStamp,
  resolveAuctionSources,
} from "../auction-display";

const NOW = new Date("2026-07-16T15:00:00.000Z");

describe("parseAuctionDateStamp", () => {
  it("reads the harvest notes stamp", () => {
    const notes =
      "Bradesco retomado. Auction date=2026-07-15T10:00:00.000Z. askingPriceBRL = minimum bid.";
    expect(parseAuctionDateStamp(notes)?.toISOString()).toBe("2026-07-15T10:00:00.000Z");
  });

  it("returns null when stamp is absent", () => {
    expect(parseAuctionDateStamp("no date here")).toBeNull();
  });
});

describe("resolveAuctionSources", () => {
  it("keeps CarSource dates when present", () => {
    const sources = [{ auctionDate: new Date("2026-08-01T12:00:00.000Z") }];
    const resolved = resolveAuctionSources(sources, "Auction date=2026-07-01T00:00:00.000Z");
    expect(resolved.fromNotesFallback).toBe(false);
    expect(resolved.sources[0].auctionDate?.toISOString()).toBe("2026-08-01T12:00:00.000Z");
  });

  it("falls back to notes stamp when all source dates are null", () => {
    const resolved = resolveAuctionSources(
      [{ auctionDate: null }],
      "Auction date=2026-07-15T10:00:00.000Z. askingPriceBRL = minimum bid.",
    );
    expect(resolved.fromNotesFallback).toBe(true);
    expect(resolved.sources[0].auctionDate?.toISOString()).toBe("2026-07-15T10:00:00.000Z");
  });
});

describe("getAuctionDisplayStatus", () => {
  it("marks expired stage even when dates are unknown", () => {
    const status = getAuctionDisplayStatus([{ auctionDate: null }], {
      pipelineStage: "expired",
      now: NOW,
    });
    expect(status.urgency).toBe("expired_stage");
  });

  it("flags soon auctions within 48h", () => {
    const status = getAuctionDisplayStatus(
      [{ auctionDate: new Date("2026-07-17T12:00:00.000Z") }],
      { now: NOW },
    );
    expect(status.urgency).toBe("soon");
    expect(status.nextAuctionDate?.toISOString()).toBe("2026-07-17T12:00:00.000Z");
  });

  it("uses notes fallback for ended auctions", () => {
    const status = getAuctionDisplayStatus([{ auctionDate: null }], {
      notes: "Auction date=2026-07-15T10:00:00.000Z.",
      now: NOW,
    });
    expect(status.urgency).toBe("ended");
    expect(status.fromNotesFallback).toBe(true);
    expect(status.highlightDate?.toISOString()).toBe("2026-07-15T10:00:00.000Z");
  });
});
