import { describe, it, expect } from "vitest";
import {
  classifyWmApiResponse,
  WebmotorsBlockError,
} from "../webmotors-list";

function ok(body: string, contentType = "application/json") {
  return { ok: true, status: 200, contentType, body };
}

describe("classifyWmApiResponse", () => {
  it("returns ok with results for a populated SearchResults array", () => {
    const outcome = classifyWmApiResponse(
      ok(JSON.stringify({ SearchResults: [{ UniqueId: 1 }, { UniqueId: 2 }] })),
    );
    expect(outcome.kind).toBe("ok");
    if (outcome.kind === "ok") expect(outcome.results).toHaveLength(2);
  });

  it("returns empty for an empty SearchResults array (genuine end-of-results)", () => {
    const outcome = classifyWmApiResponse(ok(JSON.stringify({ SearchResults: [] })));
    expect(outcome.kind).toBe("empty");
  });

  it("returns empty when SearchResults is missing from a valid object", () => {
    const outcome = classifyWmApiResponse(ok(JSON.stringify({ Pagination: { PageTotal: 0 } })));
    expect(outcome.kind).toBe("empty");
  });

  it("returns blocked on a non-OK HTTP status (403 PerimeterX)", () => {
    const outcome = classifyWmApiResponse({
      ok: false,
      status: 403,
      contentType: "text/html",
      body: "",
    });
    expect(outcome.kind).toBe("blocked");
    if (outcome.kind === "blocked") expect(outcome.reason).toContain("403");
  });

  it("returns blocked on a non-OK 429 rate-limit", () => {
    const outcome = classifyWmApiResponse({
      ok: false,
      status: 429,
      contentType: "application/json",
      body: "{}",
    });
    expect(outcome.kind).toBe("blocked");
    if (outcome.kind === "blocked") expect(outcome.reason).toContain("429");
  });

  it("returns blocked on an HTTP-200 anti-bot HTML page", () => {
    const outcome = classifyWmApiResponse(
      ok(
        '<!doctype html><html><head><title>Access to this page has been denied</title></head><body><div id="px-captcha"></div></body></html>',
        "text/html; charset=utf-8",
      ),
    );
    expect(outcome.kind).toBe("blocked");
  });

  it("returns blocked when the body matches a PerimeterX marker despite a JSON content-type", () => {
    const outcome = classifyWmApiResponse(
      ok("Access to this page has been denied.", "application/json"),
    );
    expect(outcome.kind).toBe("blocked");
  });

  it("returns blocked on an unparseable (non-JSON) body", () => {
    const outcome = classifyWmApiResponse(ok("not json at all", "application/json"));
    expect(outcome.kind).toBe("blocked");
  });

  it("returns blocked when JSON parses to a non-object (unexpected shape)", () => {
    const outcome = classifyWmApiResponse(ok("42"));
    expect(outcome.kind).toBe("blocked");
  });
});

describe("WebmotorsBlockError", () => {
  it("is an Error subclass carrying its reason as the message", () => {
    const err = new WebmotorsBlockError("HTTP 403 for https://example");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("WebmotorsBlockError");
    expect(err.message).toContain("403");
  });
});
