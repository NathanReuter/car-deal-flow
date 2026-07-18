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

  it("evicts a rejected fetch so the next call retries", async () => {
    const realFetch = globalThis.fetch;
    let calls = 0;
    const spy = vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("network down");
      return new Response(JSON.stringify({ ok: true }));
    });
    globalThis.fetch = spy as unknown as typeof fetch;
    uninstall = installCachedFetch();

    await expect(fetch("https://fipe.test/brands")).rejects.toThrow("network down");
    const retried = await (await fetch("https://fipe.test/brands")).json();

    expect(retried).toEqual({ ok: true });
    expect(spy).toHaveBeenCalledTimes(2);

    uninstall();
    uninstall = undefined;
    globalThis.fetch = realFetch;
  });
});
