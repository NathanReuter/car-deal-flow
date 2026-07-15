import { describe, it, expect } from "vitest";
import { getNextAuctionDate, isFullyExpired } from "../auction";

const NOW = new Date("2026-07-15T12:00:00Z");
const PAST = new Date("2026-07-01T12:00:00Z");
const PAST_LATER = new Date("2026-07-10T12:00:00Z");
const FUTURE_SOON = new Date("2026-07-20T12:00:00Z");
const FUTURE_LATER = new Date("2026-08-01T12:00:00Z");

describe("getNextAuctionDate", () => {
  it("returns null when there are no sources", () => {
    expect(getNextAuctionDate([], NOW)).toBeNull();
  });

  it("returns null when every source has an unknown (null) date", () => {
    expect(getNextAuctionDate([{ auctionDate: null }, { auctionDate: null }], NOW)).toBeNull();
  });

  it("returns null when every known date is in the past", () => {
    expect(
      getNextAuctionDate([{ auctionDate: PAST }, { auctionDate: PAST_LATER }], NOW),
    ).toBeNull();
  });

  it("returns the soonest future date among mixed past/future/null sources", () => {
    expect(
      getNextAuctionDate(
        [
          { auctionDate: PAST },
          { auctionDate: null },
          { auctionDate: FUTURE_LATER },
          { auctionDate: FUTURE_SOON },
        ],
        NOW,
      ),
    ).toEqual(FUTURE_SOON);
  });
});

describe("isFullyExpired", () => {
  it("is false when there are no sources (nothing to expire)", () => {
    expect(isFullyExpired([], NOW)).toBe(false);
  });

  it("is false when any source has an unknown (null) date", () => {
    expect(isFullyExpired([{ auctionDate: PAST }, { auctionDate: null }], NOW)).toBe(false);
  });

  it("is false when any source has a future date", () => {
    expect(isFullyExpired([{ auctionDate: PAST }, { auctionDate: FUTURE_SOON }], NOW)).toBe(false);
  });

  it("is true when every source has a known, past date", () => {
    expect(isFullyExpired([{ auctionDate: PAST }, { auctionDate: PAST_LATER }], NOW)).toBe(true);
  });
});
