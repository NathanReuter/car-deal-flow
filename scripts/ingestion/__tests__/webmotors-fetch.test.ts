import { describe, it, expect } from "vitest";
import type { Page } from "playwright";
import {
  classifyWmApiResponse,
  fetchApiPage,
  listWebmotorsAds,
  WebmotorsBlockError,
} from "../webmotors-list";

/** Minimal fake Page whose evaluate() returns canned raw API materials,
 * bypassing the real browser fetch. */
function fakePage(raw: {
  ok: boolean;
  status: number;
  contentType: string;
  body: string;
}): Page {
  return { evaluate: async () => raw } as unknown as Page;
}

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

describe("fetchApiPage", () => {
  it("returns the results array when the response is ok", async () => {
    const page = fakePage({
      ok: true,
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ SearchResults: [{ UniqueId: 1 }] }),
    });
    const results = await fetchApiPage(page, "repasse", 1);
    expect(results).toHaveLength(1);
  });

  it("returns an empty array on a genuine empty page", async () => {
    const page = fakePage({
      ok: true,
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ SearchResults: [] }),
    });
    const results = await fetchApiPage(page, "repasse", 9);
    expect(results).toEqual([]);
  });

  it("throws WebmotorsBlockError on a blocked response", async () => {
    const page = fakePage({
      ok: false,
      status: 403,
      contentType: "text/html",
      body: "Access to this page has been denied",
    });
    await expect(fetchApiPage(page, "repasse", 2)).rejects.toBeInstanceOf(
      WebmotorsBlockError,
    );
  });

  it("throws WebmotorsBlockError instead of hanging forever on a silently-held-open connection", async () => {
    // Simulates the in-page fetch's own AbortController firing: status 0,
    // no content-type, body carrying the abort reason. A connection that
    // never resolves must still fail closed within a bounded time rather
    // than block the whole harvest indefinitely.
    const page = fakePage({
      ok: false,
      status: 0,
      contentType: "",
      body: "fetch failed: AbortError: signal is aborted",
    });
    await expect(fetchApiPage(page, "repasse", 3)).rejects.toBeInstanceOf(
      WebmotorsBlockError,
    );
  });
});

describe("listWebmotorsAds — fail-closed", () => {
  it("propagates WebmotorsBlockError instead of returning a truncated list", async () => {
    const page = fakePage({
      ok: false,
      status: 403,
      contentType: "text/html",
      body: "Access to this page has been denied",
    });
    await expect(
      listWebmotorsAds({ queries: ["repasse"], maxPagesPerQuery: 3, page }),
    ).rejects.toBeInstanceOf(WebmotorsBlockError);
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
