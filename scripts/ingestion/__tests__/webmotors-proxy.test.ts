// Unit coverage for the env-driven anti-bot knobs added alongside residential
// proxy support: wmProxyForContext (proxy config + per-call {session} rotation),
// wmLaunchOptions (headful-by-default), and the warm-up wiring in
// warmWebmotorsContext (proxy → newContext, proxy-gated image/media abort).
import { afterEach, describe, expect, it } from "vitest";
import type { Browser, BrowserContext } from "playwright";
import {
  warmWebmotorsContext,
  wmLaunchOptions,
  wmProxyForContext,
} from "../webmotors-list";

const MANAGED_ENV = [
  "WM_PROXY_SERVER",
  "WM_PROXY_USERNAME",
  "WM_PROXY_PASSWORD",
  "WM_HEADLESS",
  "WM_LOAD_IMAGES",
] as const;

afterEach(() => {
  for (const key of MANAGED_ENV) delete process.env[key];
});

describe("wmProxyForContext", () => {
  it("returns undefined when WM_PROXY_SERVER is unset (direct connection)", () => {
    expect(wmProxyForContext()).toBeUndefined();
  });

  it("returns the server alone when no credentials are configured", () => {
    process.env.WM_PROXY_SERVER = "http://gate.example.com:7000";
    expect(wmProxyForContext()).toEqual({ server: "http://gate.example.com:7000" });
  });

  it("includes username and password when both are set", () => {
    process.env.WM_PROXY_SERVER = "http://gate.example.com:7000";
    process.env.WM_PROXY_USERNAME = "acct-user";
    process.env.WM_PROXY_PASSWORD = "s3cret";
    expect(wmProxyForContext()).toEqual({
      server: "http://gate.example.com:7000",
      username: "acct-user",
      password: "s3cret",
    });
  });

  it("omits password when only a username is set", () => {
    process.env.WM_PROXY_SERVER = "http://gate.example.com:7000";
    process.env.WM_PROXY_USERNAME = "acct-user";
    const proxy = wmProxyForContext();
    expect(proxy).toHaveProperty("username", "acct-user");
    expect(proxy).not.toHaveProperty("password");
  });

  it("substitutes a fresh {session} token per call so each rotation gets a new IP", () => {
    process.env.WM_PROXY_SERVER = "http://gate.example.com:7000";
    process.env.WM_PROXY_USERNAME = "acct-user-session-{session}";
    const first = wmProxyForContext()?.username;
    const second = wmProxyForContext()?.username;
    expect(first).toMatch(/^acct-user-session-[a-z0-9]+$/);
    expect(second).toMatch(/^acct-user-session-[a-z0-9]+$/);
    expect(first).not.toEqual(second);
  });

  it("replaces every {session} occurrence in the username", () => {
    process.env.WM_PROXY_SERVER = "http://gate.example.com:7000";
    process.env.WM_PROXY_USERNAME = "{session}-acct-{session}";
    const username = wmProxyForContext()?.username ?? "";
    expect(username).not.toContain("{session}");
    const [head, , tail] = username.split("-");
    expect(head).toBe(tail); // same token substituted on both sides
  });

  it("passes the username through unchanged when there is no {session} placeholder", () => {
    process.env.WM_PROXY_SERVER = "http://gate.example.com:7000";
    process.env.WM_PROXY_USERNAME = "static-user";
    expect(wmProxyForContext()?.username).toBe("static-user");
  });
});

describe("wmLaunchOptions", () => {
  it("defaults to headful (findings flagged headless-stealth as a tell)", () => {
    expect(wmLaunchOptions()).toEqual({ headless: false });
  });

  it("forces headless when WM_HEADLESS=1 (Linux/xvfb server escape hatch)", () => {
    process.env.WM_HEADLESS = "1";
    expect(wmLaunchOptions()).toEqual({ headless: true });
  });

  it("stays headful for any WM_HEADLESS value other than exactly '1'", () => {
    process.env.WM_HEADLESS = "true";
    expect(wmLaunchOptions()).toEqual({ headless: false });
  });
});

// ─── warm-up wiring ────────────────────────────────────────────────────────────

type RouteCall = { pattern: string; handler: (route: unknown) => unknown };

/** Fake Browser that records the options passed to newContext and any route()
 * registrations, and no-ops the page warm-up calls (goto/waitForTimeout). */
function fakeBrowser() {
  const contexts: Array<{ proxy: unknown }> = [];
  const routeCalls: RouteCall[] = [];
  const browser = {
    newContext: async (opts: { proxy?: unknown }) => {
      contexts.push({ proxy: opts?.proxy });
      const context: Partial<BrowserContext> = {
        newPage: async () =>
          ({ goto: async () => null, waitForTimeout: async () => {} }) as never,
        route: (async (pattern: string, handler: (route: unknown) => unknown) => {
          routeCalls.push({ pattern, handler });
        }) as never,
        close: async () => {},
      };
      return context as BrowserContext;
    },
    close: async () => {},
  };
  return { browser: browser as unknown as Browser, contexts, routeCalls };
}

/** Invoke a captured route handler with a fake request of the given type and
 * report which action it took. */
async function runRouteHandler(handler: (route: unknown) => unknown, resourceType: string) {
  const calls = { abort: 0, continue: 0 };
  const route = {
    request: () => ({ resourceType: () => resourceType }),
    abort: async () => {
      calls.abort++;
    },
    continue: async () => {
      calls.continue++;
    },
  };
  await handler(route);
  return calls;
}

describe("warmWebmotorsContext wiring", () => {
  it("passes no proxy to newContext on the free path (proxy unset)", async () => {
    const { browser, contexts, routeCalls } = fakeBrowser();
    await warmWebmotorsContext(browser);
    expect(contexts).toHaveLength(1);
    expect(contexts[0].proxy).toBeUndefined();
    // Free path must stay inert: no request interception at all.
    expect(routeCalls).toHaveLength(0);
  });

  it("routes newContext through a resolved proxy when WM_PROXY_SERVER is set", async () => {
    process.env.WM_PROXY_SERVER = "http://gate.example.com:7000";
    process.env.WM_PROXY_USERNAME = "acct-session-{session}";
    const { browser, contexts } = fakeBrowser();
    await warmWebmotorsContext(browser);
    expect(contexts[0].proxy).toMatchObject({ server: "http://gate.example.com:7000" });
    expect((contexts[0].proxy as { username: string }).username).toMatch(
      /^acct-session-[a-z0-9]+$/,
    );
  });

  it("mints a new {session} on each warm-up so rotation lands on a new IP", async () => {
    process.env.WM_PROXY_SERVER = "http://gate.example.com:7000";
    process.env.WM_PROXY_USERNAME = "acct-session-{session}";
    const { browser, contexts } = fakeBrowser();
    await warmWebmotorsContext(browser);
    await warmWebmotorsContext(browser);
    const u0 = (contexts[0].proxy as { username: string }).username;
    const u1 = (contexts[1].proxy as { username: string }).username;
    expect(u0).not.toEqual(u1);
  });

  it("aborts image/media but continues other requests on the proxy path", async () => {
    process.env.WM_PROXY_SERVER = "http://gate.example.com:7000";
    const { browser, routeCalls } = fakeBrowser();
    await warmWebmotorsContext(browser);
    expect(routeCalls).toHaveLength(1);
    const { handler } = routeCalls[0];
    expect(await runRouteHandler(handler, "image")).toEqual({ abort: 1, continue: 0 });
    expect(await runRouteHandler(handler, "media")).toEqual({ abort: 1, continue: 0 });
    expect(await runRouteHandler(handler, "document")).toEqual({ abort: 0, continue: 1 });
    expect(await runRouteHandler(handler, "fetch")).toEqual({ abort: 0, continue: 1 });
    expect(await runRouteHandler(handler, "font")).toEqual({ abort: 0, continue: 1 });
  });

  it("does not register request interception when WM_LOAD_IMAGES=1", async () => {
    process.env.WM_PROXY_SERVER = "http://gate.example.com:7000";
    process.env.WM_LOAD_IMAGES = "1";
    const { browser, routeCalls } = fakeBrowser();
    await warmWebmotorsContext(browser);
    expect(routeCalls).toHaveLength(0);
  });
});
