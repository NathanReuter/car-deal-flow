import { describe, it, expect } from "vitest";
import {
  assertLeiloesPbUrl,
  LeiloesPbFetchError,
} from "../leiloes-pb-fetch";

describe("assertLeiloesPbUrl", () => {
  it("allows leiloespb.com.br hosts case-insensitively", () => {
    expect(() =>
      assertLeiloesPbUrl(
        "https://leiloespb.com.br/lote/40329/volkswagen-t-cross",
      ),
    ).not.toThrow();
    expect(() =>
      assertLeiloesPbUrl(
        "https://WWW.LeiloesPB.com.br/eventos/leilao/2013/leilao-mapfre-seguros",
      ),
    ).not.toThrow();
  });

  it("rejects non-http(s), unknown hosts, and subdomain spoofs", () => {
    expect(() => assertLeiloesPbUrl("javascript:alert(1)")).toThrow(
      LeiloesPbFetchError,
    );
    expect(() =>
      assertLeiloesPbUrl("https://evil.example/lote/1"),
    ).toThrow(/host not allowed/);
    expect(() =>
      assertLeiloesPbUrl("https://evil.leiloespb.com.br/lote/1"),
    ).toThrow(/host not allowed/);
  });
});
