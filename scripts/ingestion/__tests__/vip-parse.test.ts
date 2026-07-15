import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractFinanceiraEventIds,
  extractVipDetailFromHtml,
  parseVipLead,
} from "../vip-parse";

describe("extractFinanceiraEventIds", () => {
  it("extracts financeiras event ids from agenda html", () => {
    const html = `
      <a href="/evento/detalhes/150726bspa">SP</a>
      <a href="/evento/detalhes/170726prefpilar">Other</a>
      <a href="https://www.vipleiloes.com.br/evento/detalhes/160726bsma">MA</a>
    `;
    expect(extractFinanceiraEventIds(html).sort()).toEqual(["150726bspa", "160726bsma"]);
  });

  it("includes financeiras-labeled events without bs slug", () => {
    const html = `
      <div>Financeiras</div>
      <a href="/evento/detalhes/170726prefpilar">Pilar</a>
    `;
    expect(extractFinanceiraEventIds(html)).toContain("170726prefpilar");
  });
});

describe("extractVipDetailFromHtml", () => {
  it("parses table fields from lot html snippet", () => {
    const html = readFileSync(
      join(__dirname, "fixtures/vip-lot-snippet.html"),
      "utf8",
    );
    const detail = extractVipDetailFromHtml(
      html,
      "https://www.vipleiloes.com.br/evento/anuncio/test-12345",
      "150726bspa",
    );
    expect(detail.fields["Veículo"]).toContain("Volkswagen");
    expect(detail.ofertaInicial).toBeTruthy();
  });
});

describe("parseVipLead", () => {
  it("skips insurer comitente when excludeInsurer is true", () => {
    const parsed = parseVipLead(
      {
        event: "x",
        url: "https://www.vipleiloes.com.br/evento/anuncio/x-12345",
        title: "VW T-Cross",
        fields: {
          Veículo: "Volkswagen - T-Cross",
          Ano: "2022/2022",
          Comitente: "MAPFRE SEGUROS GERAIS",
          Procedência: "Retomado",
        },
        ofertaInicial: "47.900,00",
        valorAtual: null,
        editalUrl: null,
      },
      { excludeInsurer: true },
    );
    expect(parsed.skip).toBe("insurer_comitente");
  });

  it("parses integral bank lot", () => {
    const parsed = parseVipLead({
      event: "x",
      url: "https://www.vipleiloes.com.br/evento/anuncio/x-12345",
      title: "VW Gol",
      fields: {
        Veículo: "Volkswagen - Gol",
        Ano: "2022/2022",
        Comitente: "BANCO BRADESCO S.A.",
        Procedência: "Retomado",
        KM: "45000",
      },
      ofertaInicial: "29.000,00",
      valorAtual: null,
      editalUrl: null,
    });
    expect(parsed.input?.brand).toBe("Volkswagen");
    expect(parsed.input?.sellerType).toBe("bank_recovery");
  });
});
