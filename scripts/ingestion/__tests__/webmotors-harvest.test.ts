import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, it, expect } from "vitest";
import type { Page } from "playwright";
import { harvestWebmotors } from "../webmotors-harvest";
import { WebmotorsBlockError } from "../webmotors-list";

type RawPage = { ok: boolean; status: number; contentType: string; body: string };

/** Minimal result with the objects parseWebmotorsResult dereferences. It skips
 * on "no financing signal" — fine; these tests exercise loop flow, not writes. */
const mkResult = (id: number) => ({
  UniqueId: id,
  Seller: {},
  Specification: {},
  Prices: {},
});

const okBody = (results: unknown[]) =>
  JSON.stringify({ SearchResults: results });

const OK_PAGE = (results: unknown[]): RawPage => ({
  ok: true,
  status: 200,
  contentType: "application/json",
  body: okBody(results),
});
const EMPTY_PAGE: RawPage = OK_PAGE([]);
const BLOCK_PAGE: RawPage = {
  ok: false,
  status: 403,
  contentType: "text/html",
  body: "Access to this page has been denied",
};

/** Fake Page yielding a scripted sequence of raw API responses (one per
 * fetchApiPage call), so the harvest loop runs with no real browser. */
function scriptedPage(sequence: RawPage[]): Page {
  let i = 0;
  return {
    evaluate: async () => sequence[Math.min(i++, sequence.length - 1)],
  } as unknown as Page;
}

describe("harvestWebmotors — anti-bot fail-closed", () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });
  const tmpSummary = () => {
    const dir = mkdtempSync(join(tmpdir(), "wm-harvest-"));
    dirs.push(dir);
    return join(dir, "summary.json");
  };

  it("aborts and records skipped.blocked when a block appears mid-pagination", async () => {
    const summaryOut = tmpSummary();
    // keyword 1: page 1 has a result, page 2 is blocked.
    const page = scriptedPage([OK_PAGE([mkResult(1)]), BLOCK_PAGE]);

    await expect(
      harvestWebmotors({
        queries: ["repasse"],
        maxPagesPerQuery: 5,
        dryRun: true,
        page,
        summaryOut,
      }),
    ).rejects.toBeInstanceOf(WebmotorsBlockError);

    const saved = JSON.parse(readFileSync(summaryOut, "utf8"));
    expect(saved.skipped.blocked).toBe(1);
    expect(saved.errors.length).toBeGreaterThan(0);
    expect(saved.errors[0].error).toContain("403");
  });

  it("aborts when the whole default run yields zero raw results (probable silent block)", async () => {
    const page = scriptedPage([EMPTY_PAGE]);
    await expect(
      harvestWebmotors({ dryRun: true, page }),
    ).rejects.toBeInstanceOf(WebmotorsBlockError);
  });

  it("does NOT abort on zero results when custom queries are supplied", async () => {
    const page = scriptedPage([EMPTY_PAGE]);
    const summary = await harvestWebmotors({
      queries: ["some-narrow-query"],
      dryRun: true,
      page,
    });
    expect(summary.source).toBe("Webmotors");
    expect(summary.skipped.blocked ?? 0).toBe(0);
  });

  it("flags low_yield (without aborting) when yield is suspiciously low", async () => {
    // Default 3 queries; only the first returns a single result, rest empty.
    const page = scriptedPage([OK_PAGE([mkResult(7)]), EMPTY_PAGE]);
    const summary = await harvestWebmotors({ dryRun: true, page });
    expect(summary.skipped.low_yield).toBe(1);
    expect(summary.skipped.blocked ?? 0).toBe(0);
  });

  it("completes normally on a genuine empty page (end-of-results, no block)", async () => {
    // Healthy yield: each of the 3 default queries returns a full page then empties.
    const page = scriptedPage([OK_PAGE(Array.from({ length: 24 }, (_, i) => mkResult(i))), EMPTY_PAGE]);
    const summary = await harvestWebmotors({ dryRun: true, page });
    expect(summary.skipped.blocked ?? 0).toBe(0);
    expect(summary.skipped.low_yield ?? 0).toBe(0);
  });
});
