import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseClubeRepasseCards,
  parseCompracertaItems,
  type ClubeRepasseCard,
  type CompracertaItem,
} from "../storefront-parse";

const fixturesDir = join(__dirname, "fixtures");

const clubeHtml = readFileSync(
  join(fixturesDir, "storefront-cluberepasse-snippet.html"),
  "utf8",
);

// The Compra Certa fixture file holds a JSON array (despite the .html extension)
const compracertaRaw = readFileSync(
  join(fixturesDir, "storefront-compracerta-snippet.html"),
  "utf8",
);

// ---------------------------------------------------------------------------
// Clube Repasse — HTML parse
// ---------------------------------------------------------------------------
describe("parseClubeRepasseCards", () => {
  let cards: ClubeRepasseCard[];

  it("parses all three cards from the fixture", () => {
    cards = parseClubeRepasseCards(clubeHtml);
    expect(cards).toHaveLength(3);
  });

  it("extracts brand, model, year and price from first card (Hyundai I30)", () => {
    cards = parseClubeRepasseCards(clubeHtml);
    const card = cards[0]!;
    expect(card.brand).toBe("Hyundai");
    expect(card.model).toMatch(/i30/i);
    expect(card.year).toBe(2011);
    expect(card.askingPriceBRL).toBe(40500);
  });

  it("extracts below-FIPE percentage from first card", () => {
    cards = parseClubeRepasseCards(clubeHtml);
    expect(cards[0]!.belowFipePct).toBeCloseTo(15.45, 1);
  });

  it("extracts the card detail URL for the first card", () => {
    cards = parseClubeRepasseCards(clubeHtml);
    expect(cards[0]!.detailPath).toMatch(/\/detalhe\//);
  });

  it("parses second card (Ford EcoSport) correctly", () => {
    cards = parseClubeRepasseCards(clubeHtml);
    const card = cards[1]!;
    expect(card.brand).toMatch(/ford/i);
    expect(card.model).toMatch(/ecosport/i);
    expect(card.year).toBe(2010);
    expect(card.askingPriceBRL).toBe(28900);
    expect(card.belowFipePct).toBeCloseTo(24.8, 1);
  });

  it("parses third card (Audi A3 Sedan) correctly", () => {
    cards = parseClubeRepasseCards(clubeHtml);
    const card = cards[2]!;
    expect(card.brand).toMatch(/audi/i);
    expect(card.model).toMatch(/a3/i);
    expect(card.year).toBe(2018);
    expect(card.askingPriceBRL).toBe(82900);
  });

  it("returns empty array for HTML without cards", () => {
    expect(parseClubeRepasseCards("<html><body>nothing</body></html>")).toHaveLength(0);
  });

  it("skips cards missing price (fail closed)", () => {
    const noPriceHtml = `
      <div class="bg-white rounded-2xl border">
        <h2 title="Foo">Foo</h2>
        <p>Brand Bar 2020, sem preço</p>
      </div>`;
    const result = parseClubeRepasseCards(noPriceHtml);
    expect(result).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Compra Certa — JSON parse
// ---------------------------------------------------------------------------
describe("parseCompracertaItems", () => {
  let items: CompracertaItem[];

  it("parses all three items from the fixture", () => {
    items = parseCompracertaItems(compracertaRaw);
    expect(items).toHaveLength(3);
  });

  it("extracts brand, model, year, km and price from first item (Toyota Hilux)", () => {
    items = parseCompracertaItems(compracertaRaw);
    const item = items[0]!;
    expect(item.brand).toBe("Toyota");
    expect(item.model).toMatch(/hilux/i);
    expect(item.year).toBe(2022);
    expect(item.mileageKm).toBe(90000);
    expect(item.askingPriceBRL).toBe(129990);
  });

  it("computes belowFipePct from fipe and preco", () => {
    items = parseCompracertaItems(compracertaRaw);
    const item = items[0]!;
    // (1 - 129990/170270) * 100 ≈ 23.66
    expect(item.belowFipePct).toBeGreaterThan(20);
    expect(item.belowFipePct).toBeLessThan(30);
  });

  it("parses second item (Volkswagen Gol)", () => {
    items = parseCompracertaItems(compracertaRaw);
    const item = items[1]!;
    expect(item.brand).toBe("Volkswagen");
    expect(item.model).toMatch(/gol/i);
    expect(item.year).toBe(2023);
    expect(item.askingPriceBRL).toBe(49990);
  });

  it("returns empty array for invalid JSON", () => {
    expect(parseCompracertaItems("not json")).toHaveLength(0);
  });

  it("skips items missing required fields (fail closed)", () => {
    const partial = JSON.stringify([{ id: "1", marca: "Foo" }]); // no modelo, ano, preco
    expect(parseCompracertaItems(partial)).toHaveLength(0);
  });
});
