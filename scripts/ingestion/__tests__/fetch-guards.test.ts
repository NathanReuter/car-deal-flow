import { describe, it, expect } from "vitest";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import {
  assertAllowedUrl,
  assertFinalUrlAllowed,
  assertHttpOk,
  assertNotCloudflareBlock,
  assertSafeOutPath,
} from "../fetch-guards";

const hosts = new Set(["example.com", "www.example.com"]);

describe("assertAllowedUrl", () => {
  it("allows listed hosts case-insensitively", () => {
    expect(() =>
      assertAllowedUrl("https://Example.COM/lote/1", hosts, "test"),
    ).not.toThrow();
    expect(() =>
      assertAllowedUrl("https://WWW.example.com/x", hosts, "test"),
    ).not.toThrow();
  });

  it("rejects foreign hosts, subdomains, and bad protocols", () => {
    expect(() =>
      assertAllowedUrl("https://evil.example/lote/1", hosts, "test"),
    ).toThrow(/host not allowed/);
    expect(() =>
      assertAllowedUrl("https://evil.example.com/lote/1", hosts, "test"),
    ).toThrow(/host not allowed/);
    expect(() => assertAllowedUrl("javascript:alert(1)", hosts, "test")).toThrow(
      /Invalid URL|Only http/,
    );
  });
});

describe("assertFinalUrlAllowed", () => {
  it("rejects redirect target outside allowlist", () => {
    expect(() =>
      assertFinalUrlAllowed("http://127.0.0.1:8080/secret", hosts, "test"),
    ).toThrow(/host not allowed/);
  });
});

describe("assertHttpOk / Cloudflare", () => {
  it("rejects non-OK responses", () => {
    expect(() =>
      assertHttpOk({ ok: () => false, status: () => 403 }, "https://x"),
    ).toThrow(/HTTP 403/);
  });

  it("rejects Cloudflare interstitial HTML", () => {
    expect(() =>
      assertNotCloudflareBlock(
        "<title>Attention Required! | Cloudflare</title>",
        "https://x",
      ),
    ).toThrow(/Cloudflare blocked/);
  });
});

describe("assertSafeOutPath", () => {
  it("allows OS tmp and project tmp/", () => {
    expect(assertSafeOutPath(resolve(tmpdir(), "lot.html"))).toContain(
      "lot.html",
    );
    expect(assertSafeOutPath(resolve(process.cwd(), "tmp", "lot.html"))).toContain(
      `${resolve(process.cwd(), "tmp")}`,
    );
  });

  it("rejects paths outside allowed roots", () => {
    expect(() =>
      assertSafeOutPath(resolve(process.cwd(), ".env.local")),
    ).toThrow(/--out must be under/);
  });
});
