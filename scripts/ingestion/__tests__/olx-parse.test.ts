import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import { parseOlxSearchCards } from "../olx-list";
import { hasFinancingSignal, olxToWriteLead, parseOlxDetail } from "../olx-parse";

const searchHtml = readFileSync(join(__dirname, "fixtures/olx-search-snippet.html"), "utf8");
const detailHtml = readFileSync(join(__dirname, "fixtures/olx-detail-snippet.html"), "utf8");

describe("parseOlxSearchCards", () => {
  it("extracts url, listId, title, price and posted label from ad cards", () => {
    const cards = parseOlxSearchCards(searchHtml);
    expect(cards.length).toBe(3);
    for (const card of cards) {
      expect(card.url).toMatch(/^https:\/\/[a-z]{2}\.olx\.com\.br\//);
      expect(card.listId).toMatch(/^\d{9,}$/);
      expect(card.title.length).toBeGreaterThan(0);
    }
    expect(cards.some((c) => c.priceBRL !== null)).toBe(true);
  });
});

describe("parseOlxDetail", () => {
  it("decodes the initial-data JSON into structured fields", () => {
    const ad = parseOlxDetail(detailHtml)!;
    expect(ad).not.toBeNull();
    expect(ad.subject).toMatch(/Repasse de financiamento Chevrolet Onix/i);
    expect(ad.priceValueBRL).toBe(30000);
    expect(ad.brand).toBe("Chevrolet");
    expect(ad.year).toBe(2024);
    expect(ad.mileageKm).toBe(41000);
    expect(ad.fuel).toBe("Flex");
    expect(ad.gearbox).toBe("Manual");
    expect(ad.uf).toBe("PA");
    expect(ad.municipality).toBe("Ananindeua");
    expect(ad.body).toContain("30 mil de parte");
  });

  it("returns null for HTML without initial-data", () => {
    expect(parseOlxDetail("<html><body>nothing</body></html>")).toBeNull();
  });
});

describe("hasFinancingSignal", () => {
  it("matches transfer phrasings and rejects plain sales", () => {
    expect(hasFinancingSignal("Repasse de financiamento")).toBe(true);
    expect(hasFinancingSignal("Assumo financiamento de Onix")).toBe(true);
    expect(hasFinancingSignal("quem quiser assumir financiamento me chama")).toBe(true);
    expect(hasFinancingSignal("Vendo carro quitado, doc ok")).toBe(false);
  });
});

describe("olxToWriteLead", () => {
  it("builds a pre_repossession WriteLeadInput from the fixture ad", () => {
    const ad = parseOlxDetail(detailHtml)!;
    const { input, skipReason } = olxToWriteLead(ad);
    expect(skipReason).toBeUndefined();
    expect(input).toBeDefined();
    expect(input!.dealPhase).toBe("pre_repossession");
    expect(input!.sellerType).toBe("repasse");
    expect(input!.brand).toBe("Chevrolet");
    expect(input!.year).toBe(2024);
    // "30 mil de parte" in the body wins over the listed price (they agree here).
    expect(input!.entryAskBRL).toBe(30000);
    // "48x2600" → installments.
    expect(input!.installmentsRemaining).toBe(48);
    expect(input!.installmentBRL).toBe(2600);
    // "Wtpp <number>" → contact, and it must never leak into notes.
    expect(input!.sellerContact).toContain("91999990000");
    expect(input!.notes).not.toContain("91999990000");
    expect(input!.askingPriceBRL).toBeUndefined();
  });

  it("skips ads without a financing signal", () => {
    const ad = parseOlxDetail(detailHtml)!;
    const plain = { ...ad, subject: "Vendo Onix quitado", body: "Carro quitado, sem financiamento." };
    expect(olxToWriteLead(plain).skipReason).toBe("no_financing_signal");
  });

  it("skips damaged ads at parse level", () => {
    const ad = parseOlxDetail(detailHtml)!;
    const damaged = { ...ad, body: ad.body + " Carro batido, sinistro de colisão." };
    expect(olxToWriteLead(damaged).skipReason).toBe("damage_signals");
  });

  it("skips ads with no entrada anywhere (text or listed price)", () => {
    const ad = parseOlxDetail(detailHtml)!;
    const noPrice = { ...ad, body: "Repasse de financiamento, chama no chat", priceValueBRL: null };
    expect(olxToWriteLead(noPrice).skipReason).toBe("no_entry_price");
  });

  it("skips ads missing identity fields", () => {
    const ad = parseOlxDetail(detailHtml)!;
    expect(olxToWriteLead({ ...ad, year: null }).skipReason).toBe("missing_identity_fields");
  });
});
