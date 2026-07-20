// TDD for webmotors-parse.ts — written before the implementation.
// Uses the API fixture (no network). Includes one repasse-POSITIVE case
// (has financing-transfer signal → becomes a lead) and one repasse-NEGATIVE
// case (plain sale → skipped). ≥5 assertions each.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  parseWebmotorsResult,
  webmotorsToWriteLead,
  hasFinancingSignal,
  type WebmotorsSearchResult,
} from "../webmotors-parse";

const fixtureRaw = readFileSync(
  join(__dirname, "fixtures/webmotors-search-snippet.json"),
  "utf8",
);
const fixture = JSON.parse(fixtureRaw) as { SearchResults: WebmotorsSearchResult[] };

// Use the VW Voyage as the base (first entry in fixture).
const baseResult = fixture.SearchResults[0]!;

// ── helpers ────────────────────────────────────────────────────────────────

/** Build a result with a repasse signal embedded in LongComment. */
function repasseResult(overrides: Partial<WebmotorsSearchResult> = {}): WebmotorsSearchResult {
  return {
    ...baseResult,
    LongComment:
      "Repasse de financiamento! Entrada R$ 15.000, saldo devedor R$ 18.000. " +
      "48x de R$ 1.100. Contato Whatsapp (11) 99999-1234.",
    ...overrides,
  };
}

/** Build a result with no repasse signal (plain sale). */
function plainSaleResult(overrides: Partial<WebmotorsSearchResult> = {}): WebmotorsSearchResult {
  return {
    ...baseResult,
    LongComment:
      "VOLKSWAGEN VOYAGE TREND 1.6 8v em excelente estado, único dono, IPVA pago, licenciado.",
    ...overrides,
  };
}

// ── hasFinancingSignal ──────────────────────────────────────────────────────

describe("hasFinancingSignal", () => {
  it("matches repasse and assumo financiamento phrasings", () => {
    expect(hasFinancingSignal("Repasse de financiamento")).toBe(true);
    expect(hasFinancingSignal("assumo financiamento do carro")).toBe(true);
    expect(hasFinancingSignal("passo financiamento, entrada 15 mil")).toBe(true);
    expect(hasFinancingSignal("quitar e transferir financiamento")).toBe(true);
  });

  it("rejects plain-sale text with no financing-transfer signal", () => {
    expect(hasFinancingSignal("Carro quitado, único dono, IPVA pago")).toBe(false);
    expect(hasFinancingSignal("Vendo VOYAGE TREND em excelente estado")).toBe(false);
  });
});

// ── parseWebmotorsResult ────────────────────────────────────────────────────

describe("parseWebmotorsResult", () => {
  it("extracts identity fields from the fixture entry", () => {
    const parsed = parseWebmotorsResult(baseResult);
    expect(parsed.uniqueId).toBe("74596138");
    expect(parsed.brand).toBe("VOLKSWAGEN");
    expect(parsed.model).toBe("VOYAGE");
    expect(parsed.year).toBe(2014);
    expect(parsed.mileageKm).toBe(103379);
    expect(parsed.priceBRL).toBe(34000);
  });

  it("extracts seller location from Localization array", () => {
    const parsed = parseWebmotorsResult(baseResult);
    expect(parsed.city).toBe("Rio de Janeiro");
    expect(parsed.state).toBe("RJ");
  });

  it("extracts photos and transmission", () => {
    const parsed = parseWebmotorsResult(baseResult);
    expect(parsed.photos.length).toBeGreaterThan(0);
    expect(parsed.transmission).toBe("Semi-automática");
  });

  it("builds a valid sourceUrl for the ad", () => {
    const parsed = parseWebmotorsResult(baseResult);
    expect(parsed.sourceUrl).toMatch(/webmotors\.com\.br/);
    expect(parsed.sourceUrl).toContain("74596138");
  });

  it("falls back gracefully when Localization is empty", () => {
    const noLoc = {
      ...baseResult,
      Seller: { ...baseResult.Seller, Localization: [] },
    };
    const parsed = parseWebmotorsResult(noLoc);
    // City/state come from Seller.City/State when Localization is empty
    expect(parsed.city).toBe("Rio de Janeiro");
    expect(parsed.state).toBeTruthy();
  });
});

// ── webmotorsToWriteLead — REPASSE-POSITIVE ─────────────────────────────────

describe("webmotorsToWriteLead — repasse-positive case", () => {
  const positiveResult = repasseResult();

  it("returns a WriteLeadInput (does not skip)", () => {
    const { input, skipReason } = webmotorsToWriteLead(positiveResult);
    expect(skipReason).toBeUndefined();
    expect(input).toBeDefined();
  });

  it("sets dealPhase pre_repossession and sellerType repasse", () => {
    const { input } = webmotorsToWriteLead(positiveResult);
    expect(input!.dealPhase).toBe("pre_repossession");
    expect(input!.sellerType).toBe("repasse");
    expect(input!.sourceChannel).toBe("classifieds");
    expect(input!.confidence).toBe("medium");
  });

  it("does NOT supply askingPriceBRL — uses entryAskBRL instead", () => {
    const { input } = webmotorsToWriteLead(positiveResult);
    expect(input!.askingPriceBRL).toBeUndefined();
    expect(input!.entryAskBRL).toBe(15000);
    expect(input!.outstandingDebtBRL).toBe(18000);
  });

  it("extracts installments and contact from the ad text", () => {
    const { input } = webmotorsToWriteLead(positiveResult);
    expect(input!.installmentBRL).toBe(1100);
    expect(input!.installmentsRemaining).toBe(48);
    expect(input!.sellerContact).toMatch(/99999/);
  });

  it("maps brand, model, year and mileage correctly", () => {
    const { input } = webmotorsToWriteLead(positiveResult);
    expect(input!.brand).toBe("Volkswagen");
    expect(input!.model).toBe("Voyage");
    expect(input!.year).toBe(2014);
    expect(input!.mileageKm).toBe(103379);
  });

  it("sets sourcePlatform to Webmotors", () => {
    const { input } = webmotorsToWriteLead(positiveResult);
    expect(input!.sourcePlatform).toBe("Webmotors");
  });
});

// ── webmotorsToWriteLead — REPASSE-NEGATIVE ─────────────────────────────────

describe("webmotorsToWriteLead — repasse-negative case (plain sale)", () => {
  const negativeResult = plainSaleResult();

  it("skips ads with no financing-transfer signal", () => {
    const { input, skipReason } = webmotorsToWriteLead(negativeResult);
    expect(input).toBeUndefined();
    expect(skipReason).toBe("no_financing_signal");
  });

  it("does not produce any output fields when skipped", () => {
    const result = webmotorsToWriteLead(negativeResult);
    expect(result.input).toBeUndefined();
    expect(result.skipReason).toBeTruthy();
  });
});

// ── webmotorsToWriteLead — edge cases ──────────────────────────────────────

describe("webmotorsToWriteLead — edge cases", () => {
  it("skips when there is a financing signal but no entrada price", () => {
    const noPrice = repasseResult({
      LongComment: "Repasse de financiamento, chama no chat para negociar",
      Prices: { Price: 0, SearchPrice: 0 },
    });
    const { skipReason } = webmotorsToWriteLead(noPrice);
    expect(skipReason).toBe("no_entry_price");
  });

  it("skips damaged ads even when financing signal is present", () => {
    const damaged = repasseResult({
      LongComment:
        "Repasse de financiamento! Entrada R$ 10.000. Carro batido, sinistro de colisão.",
    });
    const { skipReason } = webmotorsToWriteLead(damaged);
    expect(skipReason).toBe("damage_signals");
  });

  it("uses the listed price as entryAskBRL when economics cannot extract entrada", () => {
    const noEntrada = repasseResult({
      LongComment: "Repasse de financiamento! 48x de R$ 1.100.",
      Prices: { Price: 20000, SearchPrice: 20000 },
    });
    const { input, skipReason } = webmotorsToWriteLead(noEntrada);
    expect(skipReason).toBeUndefined();
    expect(input!.entryAskBRL).toBe(20000);
  });
});
