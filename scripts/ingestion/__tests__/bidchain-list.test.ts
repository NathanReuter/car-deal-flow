import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractBidchainLotsFromHtml,
  extractBidchainLotId,
  extractBidchainPaginationUrls,
  filterBidchainListLot,
  normalizeBidchainLotUrl,
} from "../bidchain-list";

describe("extractBidchainLotsFromHtml", () => {
  it("extracts lot urls from listing html", () => {
    const html = readFileSync(
      join(__dirname, "fixtures/bidchain-list-snippet.html"),
      "utf8",
    );
    const lots = extractBidchainLotsFromHtml(html, "https://bidchain.com.br/por-categoria/4");
    expect(lots.map((l) => l.id).sort()).toEqual(["78224", "82439", "90001", "90002"]);
    expect(extractBidchainLotId(lots[0].url)).toBe("78224");
  });
});

describe("normalizeBidchainLotUrl", () => {
  it("rejects non-allowlisted hosts", () => {
    expect(
      normalizeBidchainLotUrl("https://evil.example/lote/1/x", "https://bidchain.com.br/"),
    ).toBeNull();
  });

  it("strips the descriptive slug suffix the site 404s on, keeping only /lote/{id}", () => {
    expect(
      normalizeBidchainLotUrl("/lote/78224/x", "https://bidchain.com.br/por-categoria/4"),
    ).toBe("https://bidchain.com.br/lote/78224");
    expect(
      normalizeBidchainLotUrl(
        "https://bidchain.com.br/lote/72348/2%C2%AA%20Vara%20-%20Jardim%2FMS%20-%20Autom%C3%B3vel",
        "https://bidchain.com.br/",
      ),
    ).toBe("https://bidchain.com.br/lote/72348");
  });
});

describe("extractBidchainPaginationUrls", () => {
  it("finds page links in listing html", () => {
    const html = `
      <a href="/por-categoria/4?page=2">2</a>
      <a href="https://bidchain.com.br/por-categoria/4?page=3">Next</a>
    `;
    const urls = extractBidchainPaginationUrls(html, "https://bidchain.com.br/por-categoria/4");
    expect(urls.length).toBeGreaterThanOrEqual(1);
    expect(urls.some((u) => u.includes("page=2"))).toBe(true);
  });
});

describe("filterBidchainListLot", () => {
  it("skips sucata and moto at list level", () => {
    expect(
      filterBidchainListLot({
        id: "1",
        url: "https://bidchain.com.br/lote/1/x",
        title: "VW sucata",
        host: "bidchain.com.br",
      }).keep,
    ).toBe(false);
    expect(
      filterBidchainListLot({
        id: "2",
        url: "https://bidchain.com.br/lote/2/x",
        title: "Honda CG 160",
        host: "bidchain.com.br",
      }).keep,
    ).toBe(false);
  });

  it("requires a positive vehicle signal, rejecting land/farm/container lots", () => {
    const result = filterBidchainListLot({
      id: "3",
      url: "https://bidchain.com.br/lote/3",
      title: "FAZENDA JATOBÁ COM 440,95 HECTARES EM BARRA DO OURO/TO",
      host: "bidchain.com.br",
    });
    expect(result.keep).toBe(false);
    expect(result.reason).toBe("non_vehicle");
  });

  it("keeps lots with vehicle identifiers (PLACA/RENAVAM/CHASSI) even without an explicit body-type word", () => {
    expect(
      filterBidchainListLot({
        id: "4",
        url: "https://bidchain.com.br/lote/4",
        title: "VW GOL 1.0, 2012/2013, VERMELHO, FLEX PLACA: OML1246 RENAVAM: 494831537 CHASSI: 9BWAA05U8DT195773",
        host: "bidchain.com.br",
      }).keep,
    ).toBe(true);
  });
});
