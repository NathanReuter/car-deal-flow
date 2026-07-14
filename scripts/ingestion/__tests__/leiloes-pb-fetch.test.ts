import { describe, it, expect } from "vitest";
import { assertLeiloesPbUrl } from "../leiloes-pb-fetch";

describe("assertLeiloesPbUrl", () => {
  it("allows leiloespb.com.br hosts", () => {
    expect(() =>
      assertLeiloesPbUrl(
        "https://leiloespb.com.br/lote/40329/volkswagen-t-cross",
      ),
    ).not.toThrow();
    expect(() =>
      assertLeiloesPbUrl(
        "https://www.leiloespb.com.br/eventos/leilao/2013/leilao-mapfre-seguros",
      ),
    ).not.toThrow();
  });

  it("rejects non-http(s) and unknown hosts", () => {
    expect(() => assertLeiloesPbUrl("javascript:alert(1)")).toThrow(
      /Invalid URL|Unsupported protocol/,
    );
    expect(() =>
      assertLeiloesPbUrl("https://evil.example/lote/1"),
    ).toThrow(/Host not allowed/);
  });
});
