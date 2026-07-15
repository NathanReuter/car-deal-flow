import { describe, expect, it } from "vitest";
import {
  isBatidosAuction,
  isBradescoSinistrado,
  isInsurerComitente,
  shouldSkipListing,
} from "../lib/listing-filters";

describe("isBatidosAuction", () => {
  it("detects batidos auction slug", () => {
    expect(
      isBatidosAuction(
        "https://www.mgl.com.br/leilao/leilao-de-veiculos-batidos-localiza-e-parceiros/7157/",
        "",
      ),
    ).toBe(true);
  });

  it("allows corp repasse auction", () => {
    expect(
      isBatidosAuction(
        "https://www.mgl.com.br/leilao/repasse-de-veiculos-corporativos/7186/",
        "Repasse de Veículos Corporativos",
      ),
    ).toBe(false);
  });
});

describe("isInsurerComitente", () => {
  it("detects Mapfre", () => {
    expect(isInsurerComitente("MAPFRE SEGUROS GERAIS - 1")).toBe(true);
  });

  it("allows Bradesco bank comitente", () => {
    expect(isInsurerComitente("BANCO BRADESCO S.A.")).toBe(false);
  });
});

describe("isBradescoSinistrado", () => {
  it("detects Sinistrado recovery type", () => {
    expect(isBradescoSinistrado("Sinistrado")).toBe(true);
  });

  it("allows Retomado recovery type", () => {
    expect(isBradescoSinistrado("Retomado")).toBe(false);
  });
});

describe("shouldSkipListing", () => {
  it("skips batidos auction with reason", () => {
    expect(
      shouldSkipListing({
        url: "https://www.mgl.com.br/leilao/leilao-de-veiculos-batidos-localiza-e-parceiros/7157/",
        title: "",
      }),
    ).toEqual({ skip: true, reason: "batidos_auction" });
  });

  it("skips insurer comitente when excludeInsurer is true", () => {
    expect(
      shouldSkipListing({
        comitente: "MAPFRE SEGUROS GERAIS",
        excludeInsurer: true,
      }),
    ).toEqual({ skip: true, reason: "insurer_comitente" });
  });

  it("skips Bradesco sinistrado recovery", () => {
    expect(
      shouldSkipListing({
        recoveryType: "Sinistrado",
      }),
    ).toEqual({ skip: true, reason: "sinistrado_recovery" });
  });

  it("allows clean bank repossession listing", () => {
    expect(
      shouldSkipListing({
        url: "https://www.mgl.com.br/leilao/repasse-de-veiculos-corporativos/7186/",
        title: "Repasse Corporativo",
        comitente: "BANCO BRADESCO S.A.",
        recoveryType: "Retomado",
      }),
    ).toEqual({ skip: false });
  });
});
