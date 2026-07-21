import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  parseNapistaCard,
  napistaToWriteLead,
  type NapistaCard,
} from "../napista-parse";

const searchFixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures/napista-search-snippet.json"), "utf8"),
) as { searchResult: { offers: NapistaCard[] } };

const cards = searchFixture.searchResult.offers;

describe("parseNapistaCard", () => {
  it("parses brand from the first card (Land Rover Discovery Sport)", () => {
    const result = parseNapistaCard(cards[0]!)!;
    expect(result.brand).toBe("Land Rover");
  });

  it("parses model from the first card", () => {
    const result = parseNapistaCard(cards[0]!)!;
    expect(result.model).toMatch(/discovery sport/i);
  });

  it("parses year from the first card", () => {
    const result = parseNapistaCard(cards[0]!)!;
    expect(result.year).toBe(2022);
  });

  it("parses price from the first card", () => {
    const result = parseNapistaCard(cards[0]!)!;
    expect(result.askingPriceBRL).toBe(199900);
  });

  it("parses city from the first card", () => {
    const result = parseNapistaCard(cards[0]!)!;
    expect(result.city).toBe("São Paulo");
  });

  it("parses state (uf) from the first card", () => {
    const result = parseNapistaCard(cards[0]!)!;
    expect(result.state).toBe("SP");
  });

  it("parses mileageKm from the first card", () => {
    const result = parseNapistaCard(cards[0]!)!;
    expect(result.mileageKm).toBe(56166);
  });

  it("parses the Chevrolet Onix card", () => {
    const result = parseNapistaCard(cards[1]!)!;
    expect(result.brand).toBe("Chevrolet");
    expect(result.model).toMatch(/onix/i);
    expect(result.year).toBe(2022);
    expect(result.askingPriceBRL).toBe(63999);
    expect(result.mileageKm).toBe(125000);
  });

  it("parses the Toyota Hilux card", () => {
    const result = parseNapistaCard(cards[2]!)!;
    expect(result.brand).toBe("Toyota");
    expect(result.model).toMatch(/hilux/i);
    expect(result.askingPriceBRL).toBe(155900);
  });

  it("fails closed when makeName is missing — returns null", () => {
    const bad = { ...cards[0]!, makeName: undefined } as unknown as NapistaCard;
    expect(parseNapistaCard(bad)).toBeNull();
  });

  it("fails closed when modelName is missing — returns null", () => {
    const bad = { ...cards[0]!, modelName: undefined } as unknown as NapistaCard;
    expect(parseNapistaCard(bad)).toBeNull();
  });

  it("fails closed when modelYear is missing — returns null", () => {
    const bad = { ...cards[0]!, modelYear: undefined } as unknown as NapistaCard;
    expect(parseNapistaCard(bad)).toBeNull();
  });

  it("fails closed when price is missing — returns null", () => {
    const bad = { ...cards[0]!, price: undefined } as unknown as NapistaCard;
    expect(parseNapistaCard(bad)).toBeNull();
  });
});

describe("napistaToWriteLead", () => {
  it("builds a market WriteLeadInput with correct metadata from the first card", () => {
    const parsed = parseNapistaCard(cards[0]!)!;
    const { input, skipReason } = napistaToWriteLead(parsed, cards[0]!.id);
    expect(skipReason).toBeUndefined();
    expect(input).toBeDefined();
    expect(input!.dealPhase).toBe("market");
    expect(input!.sellerType).toBe("dealer");
    expect(input!.sourceChannel).toBe("aggregator");
    expect(input!.confidence).toBe("high");
    expect(input!.askingPriceBRL).toBe(199900);
    expect(input!.entryAskBRL).toBeUndefined();
    expect(input!.sourcePlatform).toBe("NaPista");
    expect(input!.sourceUrl).toContain("e36ac616");
  });

  it("infers bodyType for Land Rover Discovery Sport → suv", () => {
    const parsed = parseNapistaCard(cards[0]!)!;
    const { input } = napistaToWriteLead(parsed, cards[0]!.id);
    expect(input!.bodyType).toBe("suv");
  });

  it("infers bodyType for Toyota Hilux → pickup", () => {
    const parsed = parseNapistaCard(cards[2]!)!;
    const { input } = napistaToWriteLead(parsed, cards[2]!.id);
    expect(input!.bodyType).toBe("pickup");
  });

  it("skips when bodyType cannot be inferred", () => {
    const parsed = parseNapistaCard(cards[0]!)!;
    // Override brand+model to something unrecognizable
    const ambiguous = { ...parsed, brand: "Obscura", model: "Unknown X999" };
    const { skipReason } = napistaToWriteLead(ambiguous, "test-id");
    expect(skipReason).toBe("no_body_type");
  });
});
