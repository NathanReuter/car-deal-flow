import { describe, it, expect } from "vitest";
import {
  resolveDealPhase,
  phaseBadge,
  urgencyBadge,
  confidenceBadge,
  matchesPhase,
  formatRepasseBRL,
  formatInstallmentPlan,
  formatContact,
  anchorPriceLabel,
} from "@/lib/repasse-display";
import { formatBRL } from "@/lib/format";
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
  it("labels market as Mercado (abaixo da FIPE) with a distinct variant", () => {
    const badge = phaseBadge("market");
    expect(badge.label).toBe("Mercado (abaixo da FIPE)");
    expect(badge.variant).not.toBe("neutral");
    expect(badge.variant).not.toBe("outline");
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

describe("confidenceBadge", () => {
  it("returns non-null with a distinct variant for 'low'", () => {
    const badge = confidenceBadge("low");
    expect(badge).not.toBeNull();
    expect(badge!.variant).not.toBe("neutral");
  });
  it("returns non-null for 'medium'", () => {
    const badge = confidenceBadge("medium");
    expect(badge).not.toBeNull();
  });
  it("returns null for 'high' (high is the default/uninteresting)", () => {
    expect(confidenceBadge("high")).toBeNull();
  });
  it("returns null for undefined", () => {
    expect(confidenceBadge(undefined)).toBeNull();
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

describe("formatRepasseBRL", () => {
  it("renders null/undefined as 'não informado', never 0", () => {
    expect(formatRepasseBRL(null)).toBe("não informado");
    expect(formatRepasseBRL(undefined)).toBe("não informado");
  });
  it("formats a real value via formatBRL", () => {
    expect(formatRepasseBRL(15000)).toBe(formatBRL(15000));
  });
  it("renders an explicit disclosed zero as R$ 0 (0 is real, distinct from null)", () => {
    expect(formatRepasseBRL(0)).toBe(formatBRL(0));
  });
});

describe("formatInstallmentPlan", () => {
  it("both known -> count × value", () => {
    expect(formatInstallmentPlan(1250, 48)).toBe(`48× de ${formatBRL(1250)}`);
  });
  it("only count known", () => {
    expect(formatInstallmentPlan(null, 30)).toBe("30 parcelas restantes");
  });
  it("only value known", () => {
    expect(formatInstallmentPlan(1250, null)).toBe(`${formatBRL(1250)} por parcela`);
  });
  it("neither known -> não informado", () => {
    expect(formatInstallmentPlan(null, null)).toBe("não informado");
  });
});

describe("formatContact", () => {
  it("renders null/undefined/blank as 'não informado'", () => {
    expect(formatContact(null)).toBe("não informado");
    expect(formatContact(undefined)).toBe("não informado");
    expect(formatContact("   ")).toBe("não informado");
  });
  it("trims and returns the handle", () => {
    expect(formatContact("  @vendedor ")).toBe("@vendedor");
  });
});

describe("anchorPriceLabel", () => {
  it("claims entrada + saldo when outstanding debt is known", () => {
    expect(anchorPriceLabel(42_000)).toBe("Preço-âncora (entrada + saldo)");
  });
  it("does not claim saldo is included when outstanding debt is unknown", () => {
    expect(anchorPriceLabel(null)).toBe("Preço-âncora (entrada; saldo não informado)");
    expect(anchorPriceLabel(undefined)).toBe("Preço-âncora (entrada; saldo não informado)");
  });
  it("treats an explicit zero debt as known (paid off)", () => {
    expect(anchorPriceLabel(0)).toBe("Preço-âncora (entrada + saldo)");
  });
});
