import { describe, expect, it } from "vitest";
import type { Page } from "playwright";
import { discoverFinanceiraEventIds, VipDiscoveryError } from "../vip-list-financeiras";

/** Minimal fake Page: goto/waitForTimeout are no-ops, content() returns the
 * given HTML, and locator() is intentionally missing so dismissCookies()
 * no-ops via its own try/catch (matches its real-world behavior when the
 * cookie banner selector isn't present). */
function fakePage(html: string): Page {
  return {
    goto: async () => undefined,
    waitForTimeout: async () => undefined,
    content: async () => html,
  } as unknown as Page;
}

describe("discoverFinanceiraEventIds", () => {
  it("returns financeira event ids when the page loaded normally", async () => {
    const html = `
      <a href="/evento/detalhes/150726bspa">SP</a>
      <a href="/evento/detalhes/170726prefpilar">Other</a>
    `;
    const ids = await discoverFinanceiraEventIds(fakePage(html));
    expect(ids).toEqual(["150726bspa"]);
  });

  it("throws VipDiscoveryError instead of a silent empty result when zero event links are found", async () => {
    // A page with no /evento/detalhes links of any kind is never a genuine
    // empty catalog for this site — it's a sign of a block or layout drift,
    // and must fail closed rather than report totalLots: 0 as success.
    const html = "<html><body>Access Denied</body></html>";
    await expect(discoverFinanceiraEventIds(fakePage(html))).rejects.toBeInstanceOf(
      VipDiscoveryError,
    );
  });

  it("returns an empty array (genuine empty catalog) when events exist but none are financeira", async () => {
    const html = `<a href="/evento/detalhes/170726prefpilar">Municipality auction</a>`;
    const ids = await discoverFinanceiraEventIds(fakePage(html));
    expect(ids).toEqual([]);
  });
});
