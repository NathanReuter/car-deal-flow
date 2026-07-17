import { describe, expect, it } from "vitest";
import {
  isShortlistEligible,
  isShortlistHighlight,
  isShortlistReportCandidate,
  SHORTLIST_ADVANCED_STAGES,
} from "../shortlist";
import type { PipelineStage, Verdict } from "../types";

const NOW = new Date("2026-07-17T12:00:00.000Z");
const PAST = "2026-06-01T12:00:00.000Z";
const PAST_LATER = "2026-07-01T12:00:00.000Z";
const FUTURE = "2026-08-01T12:00:00.000Z";

function car(opts: {
  pipelineStage: PipelineStage;
  auctionDates?: (string | null)[];
  notes?: string;
}) {
  return {
    pipelineStage: opts.pipelineStage,
    notes: opts.notes ?? "",
    sources: (opts.auctionDates ?? []).map((auctionDate, i) => ({
      url: `https://example.com/${i}`,
      platform: "test",
      isPrimary: i === 0,
      auctionDate,
    })),
  };
}

function bundle(opts: {
  pipelineStage: PipelineStage;
  verdict: Verdict;
  auctionDates?: (string | null)[];
}) {
  return {
    car: car({ pipelineStage: opts.pipelineStage, auctionDates: opts.auctionDates ?? [FUTURE] }),
    decision: { verdict: opts.verdict },
  };
}

describe("SHORTLIST_ADVANCED_STAGES", () => {
  it("includes waiting_docs and inspected as engaged stages", () => {
    expect(SHORTLIST_ADVANCED_STAGES).toEqual(
      expect.arrayContaining(["waiting_docs", "inspected", "negotiating", "approved"]),
    );
  });

  it("excludes early and terminal stages", () => {
    expect(SHORTLIST_ADVANCED_STAGES).not.toContain("new_lead");
    expect(SHORTLIST_ADVANCED_STAGES).not.toContain("researching");
    expect(SHORTLIST_ADVANCED_STAGES).not.toContain("expired");
  });
});

describe("isShortlistEligible", () => {
  it("excludes rejected, parked, bought, and expired stages", () => {
    for (const pipelineStage of ["rejected", "parked", "bought", "expired"] as PipelineStage[]) {
      expect(isShortlistEligible(car({ pipelineStage, auctionDates: [FUTURE] }), NOW)).toBe(false);
    }
  });

  it("includes live early-stage leads", () => {
    expect(
      isShortlistEligible(car({ pipelineStage: "new_lead", auctionDates: [FUTURE] }), NOW),
    ).toBe(true);
    expect(
      isShortlistEligible(car({ pipelineStage: "researching", auctionDates: [FUTURE] }), NOW),
    ).toBe(true);
  });

  it("hides date-expired cars in early stages", () => {
    expect(
      isShortlistEligible(car({ pipelineStage: "new_lead", auctionDates: [PAST] }), NOW),
    ).toBe(false);
    expect(
      isShortlistEligible(car({ pipelineStage: "researching", auctionDates: [PAST] }), NOW),
    ).toBe(false);
  });

  it("keeps date-expired cars that are already in advanced stages", () => {
    for (const pipelineStage of SHORTLIST_ADVANCED_STAGES) {
      expect(
        isShortlistEligible(car({ pipelineStage, auctionDates: [PAST] }), NOW),
        pipelineStage,
      ).toBe(true);
    }
  });

  it("does not treat unknown auction dates as expired", () => {
    expect(
      isShortlistEligible(car({ pipelineStage: "new_lead", auctionDates: [null] }), NOW),
    ).toBe(true);
    expect(
      isShortlistEligible(car({ pipelineStage: "researching", auctionDates: [] }), NOW),
    ).toBe(true);
  });

  it("uses notes auction stamp when source dates are missing", () => {
    expect(
      isShortlistEligible(
        car({
          pipelineStage: "new_lead",
          auctionDates: [null],
          notes: `Auction date=${PAST}`,
        }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isShortlistEligible(
        car({
          pipelineStage: "waiting_docs",
          auctionDates: [null],
          notes: `Auction date=${PAST}`,
        }),
        NOW,
      ),
    ).toBe(true);
  });

  it("uses notes stamp when there are no source rows at all", () => {
    expect(
      isShortlistEligible(
        {
          pipelineStage: "new_lead",
          notes: `Auction date=${PAST}`,
          sources: [],
        },
        NOW,
      ),
    ).toBe(false);
  });

  it("hides early-stage cars only when every source date is past", () => {
    expect(
      isShortlistEligible(
        car({ pipelineStage: "new_lead", auctionDates: [PAST, PAST_LATER] }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isShortlistEligible(
        car({ pipelineStage: "new_lead", auctionDates: [PAST, FUTURE] }),
        NOW,
      ),
    ).toBe(true);
  });
});

describe("shortlist verdict helpers", () => {
  it("highlight requires safe_buy or good_deal_verify", () => {
    expect(
      isShortlistHighlight(bundle({ pipelineStage: "researching", verdict: "safe_buy" }), NOW),
    ).toBe(true);
    expect(
      isShortlistHighlight(
        bundle({ pipelineStage: "researching", verdict: "good_deal_verify" }),
        NOW,
      ),
    ).toBe(true);
    expect(
      isShortlistHighlight(bundle({ pipelineStage: "researching", verdict: "avoid" }), NOW),
    ).toBe(false);
  });

  it("report candidate excludes Avoid but keeps other verdicts", () => {
    expect(
      isShortlistReportCandidate(
        bundle({ pipelineStage: "researching", verdict: "only_if_negotiated" }),
        NOW,
      ),
    ).toBe(true);
    expect(
      isShortlistReportCandidate(bundle({ pipelineStage: "researching", verdict: "avoid" }), NOW),
    ).toBe(false);
  });

  it("highlight and report still respect expiry eligibility", () => {
    expect(
      isShortlistHighlight(
        bundle({ pipelineStage: "new_lead", verdict: "safe_buy", auctionDates: [PAST] }),
        NOW,
      ),
    ).toBe(false);
    expect(
      isShortlistReportCandidate(
        bundle({
          pipelineStage: "new_lead",
          verdict: "only_if_negotiated",
          auctionDates: [PAST],
        }),
        NOW,
      ),
    ).toBe(false);
  });
});
