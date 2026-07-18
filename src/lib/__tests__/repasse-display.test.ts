import { describe, it, expect } from "vitest";
import {
  resolveDealPhase,
  phaseBadge,
  urgencyBadge,
  matchesPhase,
} from "@/lib/repasse-display";
import type { Car, DealPhase } from "@/lib/types";

const car = (dealPhase?: DealPhase) => ({ dealPhase }) as Car;

describe("resolveDealPhase", () => {
  it("defaults undefined to auction (legacy rows)", () => {
    expect(resolveDealPhase(undefined)).toBe("auction");
  });
  it("passes through explicit phases", () => {
    expect(resolveDealPhase("pre_repossession")).toBe("pre_repossession");
    expect(resolveDealPhase("auction")).toBe("auction");
  });
});

describe("phaseBadge", () => {
  it("labels auction as Leilão", () => {
    expect(phaseBadge("auction")).toEqual({ label: "Leilão", variant: "neutral" });
  });
  it("labels pre_repossession as Pré-apreensão with a distinct variant", () => {
    expect(phaseBadge("pre_repossession")).toEqual({
      label: "Pré-apreensão",
      variant: "outline",
    });
  });
  it("treats undefined as auction", () => {
    expect(phaseBadge(undefined).label).toBe("Leilão");
  });
});

describe("urgencyBadge", () => {
  it("returns null when urgency is null (nothing to show)", () => {
    expect(urgencyBadge(null)).toBeNull();
  });
  it("returns null when urgency is undefined", () => {
    expect(urgencyBadge(undefined)).toBeNull();
  });
  it("maps high to danger (red)", () => {
    expect(urgencyBadge("high")).toEqual({ label: "Urgência alta", variant: "danger" });
  });
  it("maps medium to warning (amber)", () => {
    expect(urgencyBadge("medium")).toEqual({ label: "Urgência média", variant: "warning" });
  });
  it("maps low to neutral", () => {
    expect(urgencyBadge("low")).toEqual({ label: "Urgência baixa", variant: "neutral" });
  });
});

describe("matchesPhase", () => {
  it("matches everything when filter is 'all'", () => {
    expect(matchesPhase(car("pre_repossession"), "all")).toBe(true);
    expect(matchesPhase(car("auction"), "all")).toBe(true);
    expect(matchesPhase(car(undefined), "all")).toBe(true);
  });
  it("matches auction, treating legacy undefined as auction", () => {
    expect(matchesPhase(car("auction"), "auction")).toBe(true);
    expect(matchesPhase(car(undefined), "auction")).toBe(true);
    expect(matchesPhase(car("pre_repossession"), "auction")).toBe(false);
  });
  it("matches pre_repossession only", () => {
    expect(matchesPhase(car("pre_repossession"), "pre_repossession")).toBe(true);
    expect(matchesPhase(car("auction"), "pre_repossession")).toBe(false);
    expect(matchesPhase(car(undefined), "pre_repossession")).toBe(false);
  });
});
