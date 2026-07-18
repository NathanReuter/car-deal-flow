import { afterEach, describe, expect, it, vi } from "vitest";
import { installCachedFetch } from "../fipe-sync";

describe("installCachedFetch", () => {
  let uninstall: (() => void) | undefined;
  afterEach(() => uninstall?.());

  it("dedupes identical GET urls and restores fetch on uninstall", async () => {
    const realFetch = globalThis.fetch;
    const spy = vi.fn(async () => new Response(JSON.stringify({ ok: true })));
    globalThis.fetch = spy as unknown as typeof fetch;
    uninstall = installCachedFetch();

    await (await fetch("https://fipe.test/brands")).json();
    const second = await (await fetch("https://fipe.test/brands")).json();
    await fetch("https://fipe.test/other");

    expect(spy).toHaveBeenCalledTimes(2); // brands cached, other fetched
    expect(second).toEqual({ ok: true });

    uninstall();
    uninstall = undefined;
    expect(globalThis.fetch).toBe(spy);
    globalThis.fetch = realFetch;
  });
});
