import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractMglAuctionsFromHtml,
  filterMglAuction,
} from "../mgl-list-auctions";

describe("extractMglAuctionsFromHtml", () => {
  it("extracts auction links from index html", () => {
    const html = readFileSync(
      join(__dirname, "fixtures/mgl-auction-index-snippet.html"),
      "utf8",
    );
    const auctions = extractMglAuctionsFromHtml(html, "https://www.mgl.com.br/leiloes");
    expect(auctions.map((a) => a.id).sort()).toEqual([7157, 7186, 7237]);
  });
});

describe("filterMglAuction", () => {
  it("excludes batidos and non-corp repasse", () => {
    expect(
      filterMglAuction({
        id: 7157,
        url: "https://www.mgl.com.br/leilao/leilao-de-veiculos-batidos-localiza-e-parceiros/7157/",
        title: "Batidos",
        slug: "leilao-de-veiculos-batidos-localiza-e-parceiros",
      }).keep,
    ).toBe(false);
    expect(
      filterMglAuction({
        id: 7186,
        url: "https://www.mgl.com.br/leilao/repasse-de-veiculos-corporativos/7186/",
        title: "Repasse Corporativos",
        slug: "repasse-de-veiculos-corporativos",
      }).keep,
    ).toBe(true);
    expect(
      filterMglAuction({
        id: 7237,
        url: "https://www.mgl.com.br/leilao/leilao-judicial-de-veiculos/7237/",
        title: "Judicial",
        slug: "leilao-judicial-de-veiculos",
      }).keep,
    ).toBe(false);
  });
});
