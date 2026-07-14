import { describe, it, expect } from "vitest";
import { assertAllowedMglUrl, MglFetchError } from "../mgl-fetch";

describe("assertAllowedMglUrl", () => {
  it("allows mgl.com.br hosts", () => {
    expect(() =>
      assertAllowedMglUrl(
        "https://www.mgl.com.br/lote/leilao-de-veiculos-batidos-localiza-e-parceiros/161739/",
      ),
    ).not.toThrow();
    expect(() =>
      assertAllowedMglUrl(
        "https://mgl.com.br/lote/leilao-judicial-de-veiculos/157839/",
      ),
    ).not.toThrow();
  });

  it("rejects non-http(s) and unknown hosts", () => {
    expect(() => assertAllowedMglUrl("javascript:alert(1)")).toThrow(
      MglFetchError,
    );
    expect(() => assertAllowedMglUrl("https://evil.example/lote/1")).toThrow(
      /host not allowed/,
    );
  });
});
