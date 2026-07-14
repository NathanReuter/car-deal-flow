import { describe, it, expect } from "vitest";
import { assertAllowedBidchainUrl, BidchainFetchError } from "../bidchain-fetch";

describe("assertAllowedBidchainUrl", () => {
  it("allows bidchain and known white-label hosts", () => {
    expect(() =>
      assertAllowedBidchainUrl("https://bidchain.com.br/lote/78224/SAVEIRO"),
    ).not.toThrow();
    expect(() =>
      assertAllowedBidchainUrl("https://www.adrileiloes.com.br/lote/82439"),
    ).not.toThrow();
    expect(() =>
      assertAllowedBidchainUrl("https://www.canaldeleiloes.net/lote/78224"),
    ).not.toThrow();
  });

  it("rejects non-http(s) and unknown hosts", () => {
    expect(() => assertAllowedBidchainUrl("javascript:alert(1)")).toThrow(
      BidchainFetchError,
    );
    expect(() =>
      assertAllowedBidchainUrl("https://evil.example/lote/1"),
    ).toThrow(/host not allowed/);
  });
});
