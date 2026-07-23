// Regression coverage for the context-rotation state machine (PR #19 review
// finding: this branch only runs when harvestWebmotors/listWebmotorsAds own
// the browser, which the existing fake-Page tests never exercise since they
// always inject options.page). Mocks playwright-extra's chromium.launch so
// the "owns the browser" path runs against a fake Browser/BrowserContext
// instead of a real one — no network, no real Playwright process.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Browser, BrowserContext, Page } from "playwright";

vi.mock("playwright-extra", () => ({
  chromium: { use: vi.fn(), launch: vi.fn() },
}));

const { chromium } = await import("playwright-extra");
const { harvestWebmotors } = await import("../webmotors-harvest");
const { listWebmotorsAds } = await import("../webmotors-list");

type RawPage = { ok: boolean; status: number; contentType: string; body: string };

const mkResult = (id: number) => ({
  UniqueId: id,
  Seller: {},
  Specification: {},
  Prices: {},
});
const okBody = (results: unknown[]) => JSON.stringify({ SearchResults: results });
const OK_PAGE = (results: unknown[]): RawPage => ({
  ok: true,
  status: 200,
  contentType: "application/json",
  body: okBody(results),
});
const EMPTY_PAGE: RawPage = OK_PAGE([]);

/** A fake Page that serves one scripted raw API response per fetchApiPage
 * call, and no-ops the warm-up calls (goto/waitForTimeout) warmWebmotorsContext
 * makes on every new context. */
function scriptedPage(sequence: RawPage[]): Page {
  let i = 0;
  return {
    evaluate: async () => sequence[Math.min(i++, sequence.length - 1)],
    goto: async () => null,
    waitForTimeout: async () => {},
  } as unknown as Page;
}

/** A fake Browser whose newContext() hands out one scripted page per call, in
 * order — so context N's page serves exactly the fetches made while that
 * context is "current". Tracks how many contexts were opened/closed so tests
 * can assert rotation actually happened, not just that pagination worked. */
function fakeBrowser(pageSequences: RawPage[][]) {
  let ctxIndex = 0;
  const closedOrder: number[] = [];
  const opened: number[] = [];
  const browser = {
    newContext: async () => {
      const myIndex = ctxIndex++;
      opened.push(myIndex);
      const page = scriptedPage(pageSequences[myIndex] ?? []);
      const context: Partial<BrowserContext> = {
        newPage: async () => page,
        close: async () => {
          closedOrder.push(myIndex);
        },
        cookies: async () => [],
      };
      return context as BrowserContext;
    },
    close: async () => {},
  };
  return { browser: browser as unknown as Browser, opened, closedOrder };
}

describe("context rotation (harvestWebmotors, owns the browser)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rotates to a fresh context before crossing the page ceiling, and closes the old one", async () => {
    const { browser, opened, closedOrder } = fakeBrowser([
      [OK_PAGE([mkResult(1)]), OK_PAGE([mkResult(2)])], // context 0: pages 1-2
      [EMPTY_PAGE], // context 1 (post-rotation): page 3 ends pagination
    ]);
    vi.mocked(chromium.launch).mockResolvedValue(browser);

    const summary = await harvestWebmotors({
      queries: ["repasse"],
      maxPagesPerQuery: 3,
      rotateEveryPages: 2,
      dryRun: true,
      applyGoalFilter: false,
    });

    expect(opened).toEqual([0, 1]); // exactly one rotation: initial warm + 1 fresh context
    expect(closedOrder).toEqual([0]); // the pre-rotation context was closed before the run ended
    expect(summary.scanned).toBe(2); // both results (pages 1-2) were still processed across the rotation
  });

  it("does not rotate when the run stays under the page ceiling", async () => {
    const { browser, opened, closedOrder } = fakeBrowser([[EMPTY_PAGE]]);
    vi.mocked(chromium.launch).mockResolvedValue(browser);

    await harvestWebmotors({
      queries: ["repasse"],
      maxPagesPerQuery: 3,
      rotateEveryPages: 5,
      dryRun: true,
      applyGoalFilter: false,
    });

    expect(opened).toEqual([0]); // only the initial warm-up context — no rotation needed
    expect(closedOrder).toEqual([]); // browser.close() (not context.close()) tears this one down
  });
});

describe("context rotation (listWebmotorsAds, owns the browser)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("rotates to a fresh context before crossing the page ceiling, and closes the old one", async () => {
    // listWebmotorsAds doesn't warm its own initial page — the CLI's main()
    // does that externally and hands both `page` + `browser` in. So only the
    // rotation-created context comes from fakeBrowser's newContext(); the
    // initial page is constructed directly here, serving fetches 1-2 before
    // rotation hands off to fakeBrowser's context 0 for fetch 3.
    const { browser, opened, closedOrder } = fakeBrowser([[EMPTY_PAGE]]);
    const initialContext: Partial<BrowserContext> = {
      close: async () => {
        closedOrder.push(-1);
      },
    };
    const initialPage = {
      ...scriptedPage([OK_PAGE([mkResult(1)]), OK_PAGE([mkResult(2)])]),
      context: () => initialContext as BrowserContext,
    } as unknown as Page;

    const result = await listWebmotorsAds({
      queries: ["repasse"],
      maxPagesPerQuery: 3,
      page: initialPage,
      browser,
      rotateEveryPages: 2,
    });

    expect(opened).toEqual([0]); // one rotation-created context
    expect(closedOrder).toEqual([-1, 0]); // pre-rotation (initial) context closed, then the rotated one at run end
    expect(result.ads).toHaveLength(2); // both results (pages 1-2) survived the rotation boundary
  });
});
