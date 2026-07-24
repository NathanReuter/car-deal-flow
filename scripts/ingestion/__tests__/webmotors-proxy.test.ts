// Unit coverage for the env-driven anti-bot knobs added alongside residential
// proxy support: wmProxyForContext (proxy config + per-call {session} rotation),
// wmLaunchOptions (headful-by-default), and warmWebmotorsContext wiring
// (proxy into newContext + image/media abort gated on proxy).
import { afterEach, describe, expect, it } from "vitest";
import type { Browser, BrowserContext, Page, Route } from "playwright";
import {
  warmWebmotorsContext,
  wmLaunchOptions,
  wmProxyForContext,
} from "../webmotors-list";

const PROXY_ENV = [
  "WM_PROXY_SERVER",
  "WM_PROXY_USERNAME",
  "WM_PROXY_PASSWORD",
  "WM_HEADLESS",
  "WM_LOAD_IMAGES",
] as const;

afterEach(() => {
  for (const key of PROXY_ENV) delete process.env[key];
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

describe("warmWebmotorsContext proxy + bandwidth wiring", () => {
  type WarmFake = {
    browser: Browser;
    newContextOpts: unknown[];
    routeCalls: number;
    usernames: Array<string | undefined>;
  };

  function fakeWarmBrowser(): WarmFake {
    const newContextOpts: unknown[] = [];
    const usernames: Array<string | undefined> = [];
    let routeCalls = 0;
    const page = {
      goto: async () => null,
      waitForTimeout: async () => {},
    } as unknown as Page;
    const browser = {
      newContext: async (opts: unknown) => {
        newContextOpts.push(opts);
        const proxy = (opts as { proxy?: { username?: string } } | undefined)?.proxy;
        usernames.push(proxy?.username);
        const context: Partial<BrowserContext> = {
          newPage: async () => page,
          route: async () => {
            routeCalls++;
          },
          close: async () => {},
        };
        return context as BrowserContext;
      },
    };
    return {
      browser: browser as unknown as Browser,
      newContextOpts,
      get routeCalls() {
        return routeCalls;
      },
      usernames,
    };
  }

  it("passes proxy into newContext and installs image/media abort when proxy is set", async () => {
    process.env.WM_PROXY_SERVER = "http://gate.example.com:7000";
    process.env.WM_PROXY_USERNAME = "acct-user";
    const fake = fakeWarmBrowser();

    await warmWebmotorsContext(fake.browser);

    expect(fake.newContextOpts).toEqual([
      {
        locale: "pt-BR",
        proxy: { server: "http://gate.example.com:7000", username: "acct-user" },
      },
    ]);
    expect(fake.routeCalls).toBe(1);
  });

  it("skips image/media abort on the free path (proxy unset) so fingerprint stays inert", async () => {
    const fake = fakeWarmBrowser();

    await warmWebmotorsContext(fake.browser);

    expect(fake.newContextOpts).toEqual([{ locale: "pt-BR", proxy: undefined }]);
    expect(fake.routeCalls).toBe(0);
  });

  it("skips image/media abort when WM_LOAD_IMAGES=1 even with a proxy", async () => {
    process.env.WM_PROXY_SERVER = "http://gate.example.com:7000";
    process.env.WM_LOAD_IMAGES = "1";
    const fake = fakeWarmBrowser();

    await warmWebmotorsContext(fake.browser);

    expect(fake.routeCalls).toBe(0);
  });

  it("mints a fresh {session} username on each warm-up (new IP per rotation)", async () => {
    process.env.WM_PROXY_SERVER = "http://gate.example.com:7000";
    process.env.WM_PROXY_USERNAME = "acct-user-session-{session}";
    const fake = fakeWarmBrowser();

    await warmWebmotorsContext(fake.browser);
    await warmWebmotorsContext(fake.browser);

    expect(fake.usernames).toHaveLength(2);
    expect(fake.usernames[0]).toMatch(/^acct-user-session-[a-z0-9]+$/);
    expect(fake.usernames[1]).toMatch(/^acct-user-session-[a-z0-9]+$/);
    expect(fake.usernames[0]).not.toEqual(fake.usernames[1]);
  });

  it("aborts image and media routes, continues everything else", async () => {
    process.env.WM_PROXY_SERVER = "http://gate.example.com:7000";
    let handler: ((route: Route) => unknown) | undefined;
    const page = {
      goto: async () => null,
      waitForTimeout: async () => {},
    } as unknown as Page;
    const browser = {
      newContext: async () =>
        ({
          newPage: async () => page,
          route: async (_pattern: string, fn: (route: Route) => unknown) => {
            handler = fn;
          },
          close: async () => {},
        }) as unknown as BrowserContext,
    } as unknown as Browser;

    await warmWebmotorsContext(browser);
    expect(handler).toBeTypeOf("function");

    const outcomes: Array<"abort" | "continue"> = [];
    for (const type of ["image", "media", "document", "stylesheet", "script", "font", "xhr"] as const) {
      const route = {
        request: () => ({ resourceType: () => type }),
        abort: async () => {
          outcomes.push("abort");
        },
        continue: async () => {
          outcomes.push("continue");
        },
      } as unknown as Route;
      await handler!(route);
    }
    expect(outcomes).toEqual([
      "abort",
      "abort",
      "continue",
      "continue",
      "continue",
      "continue",
      "continue",
    ]);
  });
});
