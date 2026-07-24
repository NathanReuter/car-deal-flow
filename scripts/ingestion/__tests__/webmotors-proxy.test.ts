// Unit coverage for the env-driven anti-bot knobs added alongside residential
// proxy support: wmProxyForContext (proxy config + per-call {session} rotation)
// and wmLaunchOptions (headful-by-default). Both are pure functions of the
// environment, so we drive them by setting/clearing env vars.
import { afterEach, describe, expect, it } from "vitest";
import { wmLaunchOptions, wmProxyForContext } from "../webmotors-list";

const PROXY_ENV = [
  "WM_PROXY_SERVER",
  "WM_PROXY_USERNAME",
  "WM_PROXY_PASSWORD",
  "WM_HEADLESS",
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
