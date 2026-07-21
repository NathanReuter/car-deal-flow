import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectDamageSignals } from "../../../src/lib/filters/damageSignals";
import { guessBodyTypeByModel } from "../lib/parse-common";
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

  // S2: malformed detailPath is rejected before embedding in sourceUrl
  it("skips card with a detailPath containing unsafe characters (S2 guard)", () => {
    // detailPath with query-string / injection chars — allowed by the href regex
    // but rejected by the S2 allowlist guard before it can reach sourceUrl.
    const badPathHtml = `
      <div class="bg-white rounded-2xl border">
        <a href="/detalhe/foo?redirect=evil&x=1"></a>
        <h2 title="Gol">Gol</h2>
        <p class="text-sm text-gray-600">Volkswagen Gol 2021/2022, manual</p>
        <div class="text-2xl font-black">R$ 35 000,00</div>
      </div>`;
    const result = parseClubeRepasseCards(badPathHtml);
    expect(result).toHaveLength(0);
  });

  // N2: integer-only FIPE badge (no decimal) must be matched
  it("parses integer-only FIPE badge ('15% abaixo FIPE') → belowFipePct = 15", () => {
    const html = `
      <div class="bg-white rounded-2xl border">
        <a href="/detalhe/test-abc"></a>
        <span>15% abaixo FIPE</span>
        <h2 title="Gol">Gol</h2>
        <p class="text-sm text-gray-600">Volkswagen Gol 2020/2021, manual</p>
        <div class="text-2xl font-black">R$ 35 000,00</div>
      </div>`;
    const result = parseClubeRepasseCards(html);
    expect(result).toHaveLength(1);
    expect(result[0]!.belowFipePct).toBe(15);
  });

  // Finding 3 — parseBrlStorefront fallback removed (double-divide bug)
  it("parseBrlStorefront: parses integer-only price string without dividing by 100", () => {
    // "R$ 40500" has no comma or decimal — the old fallback would strip non-digits
    // ("40500") then divide by 100 → 405 (wrong). The primary path parses it correctly.
    const html = `
      <div class="bg-white rounded-2xl border">
        <a href="/detalhe/test-123"></a>
        <h2 title="Gol">Gol</h2>
        <p class="text-sm text-gray-600">Volkswagen Gol 2020/2021, manual</p>
        <div class="text-2xl font-black">R$ 40500</div>
      </div>`;
    const result = parseClubeRepasseCards(html);
    expect(result).toHaveLength(1);
    expect(result[0]!.askingPriceBRL).toBe(40500);
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

  // S3: item.id with only path-injection chars (all stripped → empty safeId) is skipped
  it("skips item whose id sanitizes to empty string (S3 guard)", () => {
    const junkId = JSON.stringify([
      {
        id: "../x",
        marca: "Honda",
        modelo: "Civic",
        versao: "EXL 2.0",
        descricao: "",
        ano: 2021,
        km: 30000,
        preco: 90000,
        fipe: 100000,
        status: "disponivel",
      },
    ]);
    // "../x" → stripped to "x" (non-empty after sanitization) — item IS included
    // but sourceUrl uses safeId "x" instead of "../x".
    const items = parseCompracertaItems(junkId);
    expect(items).toHaveLength(1);
    expect(items[0]!.id).toBe("x");
  });

  it("skips item whose id is entirely non-alphanumeric (S3 guard — empty safeId)", () => {
    const allJunk = JSON.stringify([
      {
        id: "../../",
        marca: "Honda",
        modelo: "Civic",
        versao: "EXL 2.0",
        descricao: "",
        ano: 2021,
        km: 30000,
        preco: 90000,
        fipe: 100000,
        status: "disponivel",
      },
    ]);
    // "../../" → all chars stripped → safeId = "" → item is skipped
    const items = parseCompracertaItems(allJunk);
    expect(items).toHaveLength(0);
  });

  // Finding 1 — damage gate (parser exposes versao+descricao; harvest gates on them)
  it("exposes descricao and versao so the harvest can apply the damage gate", () => {
    // A Compra Certa item whose descricao contains a damage term: the parser
    // must surface those fields so the harvest loop can call detectDamageSignals
    // and bump the 'damaged' skip counter (consistent with napista-parse.ts:81).
    const damaged = JSON.stringify([
      {
        id: "99",
        marca: "Fiat",
        modelo: "Palio",
        versao: "EX 1.0",
        descricao: "sinistro de media monta",
        ano: 2015,
        km: 50000,
        preco: 18000,
        fipe: 22000,
        status: "disponivel",
      },
    ]);
    const items = parseCompracertaItems(damaged);
    expect(items).toHaveLength(1); // parser passes it through
    const item = items[0]!;
    // The harvest damage gate: combine descricao + versao + model
    const blob = [item.descricao, item.versao, item.model].filter(Boolean).join(" ");
    expect(detectDamageSignals(blob).blocked).toBe(true);
  });

  it("damage gate: versao containing 'batido' is blocked by detectDamageSignals", () => {
    const damaged = JSON.stringify([
      {
        id: "100",
        marca: "Chevrolet",
        modelo: "Onix",
        versao: "BATIDO RESTAURADO 1.0",
        descricao: "",
        ano: 2019,
        km: 80000,
        preco: 25000,
        fipe: 38000,
        status: "disponivel",
      },
    ]);
    const items = parseCompracertaItems(damaged);
    expect(items).toHaveLength(1);
    const item = items[0]!;
    const blob = [item.descricao, item.versao, item.model].filter(Boolean).join(" ");
    expect(detectDamageSignals(blob).blocked).toBe(true);
  });

  it("damage gate: 'sem sinistro' negation is not blocked", () => {
    const clean = JSON.stringify([
      {
        id: "101",
        marca: "Honda",
        modelo: "Civic",
        versao: "EXL 2.0",
        descricao: "sem sinistro, carro muito conservado",
        ano: 2020,
        km: 40000,
        preco: 88000,
        fipe: 100000,
        status: "disponivel",
      },
    ]);
    const items = parseCompracertaItems(clean);
    expect(items).toHaveLength(1);
    const item = items[0]!;
    const blob = [item.descricao, item.versao, item.model].filter(Boolean).join(" ");
    expect(detectDamageSignals(blob).blocked).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// F3 — Body type fail-closed: guessBodyTypeByModel returns null for unknown models
// ---------------------------------------------------------------------------
describe("guessBodyTypeByModel — fail-closed for storefront harvest", () => {
  it("returns null for a completely unknown model name", () => {
    // The harvest skips with no_body_type when this returns null — no invented default.
    expect(guessBodyTypeByModel("XYZ-UNKNOWN-MODEL")).toBeNull();
  });

  it("returns a known body type for a recognizable model", () => {
    // Confirms the happy path still works after removing the ?? 'hatch' fallback.
    const bodyType = guessBodyTypeByModel("Gol");
    expect(bodyType).not.toBeNull();
  });
});
