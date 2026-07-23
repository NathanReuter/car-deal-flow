// Diagnostic probe for the Webmotors PerimeterX (HUMAN Security) 403 block.
//
// Its whole job is to answer, cheaply and without hammering the site, WHICH
// gate is firing so the antibot bypass decision can be made on evidence
// instead of guesses. It fires a handful of single requests, never paginates
// deeply, and reports a matrix + a plain-language interpretation.
//
// It answers three questions (see the ADHD design handoff /
// docs/superpowers/specs/2026-07-22-webmotors-antibot-camoufox-design.md):
//
//   1. SURFACE   — is the same inventory reachable from a differently-protected
//                  surface (desktop SSR HTML, iCarros sister-brand)? One raw
//                  GET each, classified for PerimeterX markers vs real listing
//                  data (__NEXT_DATA__ / JSON-LD).
//   2. PORTABILITY — mint a real PerimeterX session cookie in a browser, then
//                  replay page 1 of the internal API TWO ways: in-browser
//                  (page.evaluate fetch, the baseline that works today) vs a
//                  raw Node fetch carrying the SAME cookies + headers. If the
//                  in-browser call succeeds but the raw one is blocked, the
//                  token is bound to the browser's TLS/H2 fingerprint — the
//                  "mint in Chromium, spend in curl" family only works with
//                  byte-perfect impersonation (curl-impersonate). If both
//                  succeed, the cookie is portable and that family is easy.
//   3. COOKIES   — which _px* cookies actually get set on a warm homepage
//                  visit (sanity check the mint worked at all).
//
// Reuses issue #8's classifier as the single source of truth for "is this a
// block?" — same logic the live harvester fails closed on.
//
//   ./node_modules/.bin/tsx scripts/ingestion/webmotors-probe.ts \
//     [--out /tmp/webmotors-probe/report.json] [--ssr-url <url>] [--icarros-url <url>]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright-extra";
import type { BrowserContext } from "playwright";
import stealth from "puppeteer-extra-plugin-stealth";
import { assertAllowedUrl, assertSafeOutPath, isCliEntry } from "./fetch-guards";
import {
  buildApiUrl,
  classifyWmApiResponse,
  WM_HOMEPAGE,
  type WmApiOutcome,
} from "./webmotors-list";

chromium.use(stealth());

// ─── Constants ────────────────────────────────────────────────────────────────

/** A current, realistic desktop Chrome UA for the raw-fetch surface probes. */
const DESKTOP_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

/** Hosts this probe is allowed to touch (defence-in-depth, matches fetch-guards). */
const ALLOWED_HOSTS = new Set([
  "webmotors.com.br",
  "www.webmotors.com.br",
  "icarros.com.br",
  "www.icarros.com.br",
]);

/** Default candidate surfaces. Paths are best-effort SEO guesses; the probe
 * classifies whatever comes back, so a wrong path still yields a useful signal. */
const DEFAULT_SSR_URL =
  "https://www.webmotors.com.br/carros/estoque?tipoveiculo=carros&q=repasse";
const DEFAULT_ICARROS_URL =
  "https://www.icarros.com.br/comprar/carros/repasse/todos-os-estados";

// ─── Report shape ───────────────────────────────────────────────────────────────

type SurfaceAttempt = {
  via: "undici" | "browser";
  ok: boolean;
  status: number | null;
  contentType: string;
  outcome: WmApiOutcome["kind"] | "fetch-error";
  reason?: string;
  hasNextData: boolean;
  hasJsonLd: boolean;
  pxMarkers: string[];
  bodyBytes: number;
  error?: string;
};

// Each surface is fetched two ways: raw undici (cheap, but its wire fingerprint
// is rejected — see the portability result) and via the browser (the real test
// of whether the surface is reachable + carries data). The undici attempt is
// kept only as a per-surface confirmation of the fingerprint gap.
type SurfaceProbe = {
  label: string;
  url: string;
  undici?: SurfaceAttempt;
  browser?: SurfaceAttempt;
  note?: string;
};

type PortabilityProbe = {
  cookiesAfterWarmup: string[];
  pxCookiesPresent: string[];
  inBrowser: { outcome: WmApiOutcome["kind"]; reason?: string; status: number };
  rawNode: {
    outcome: WmApiOutcome["kind"] | "fetch-error";
    reason?: string;
    status: number | null;
    error?: string;
  };
};

export type WebmotorsProbeReport = {
  generatedAt: string;
  surfaces: SurfaceProbe[];
  portability: PortabilityProbe;
  interpretation: string[];
};

// ─── PerimeterX markers for raw HTML surfaces ────────────────────────────────────

/** Same intent as WM_BLOCK_MARKERS but reported individually so the operator
 * sees exactly which tell fired. Kept in sync with webmotors-list's markers. */
const PX_MARKERS: Array<[string, RegExp]> = [
  ["access-denied", /access to this page has been denied/i],
  ["px-captcha", /px-captcha/i],
  ["_pxhd", /_pxhd/i],
  ["perimeterx", /perimeterx/i],
  ["px-cloud", /px-cloud\.net|px-cdn|human-security/i],
];

function detectPxMarkers(body: string): string[] {
  return PX_MARKERS.filter(([, re]) => re.test(body)).map(([name]) => name);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Part 1: surface probes (single GET each, via undici AND browser) ────────────

/** Classify a fetched body/status into a SurfaceAttempt. */
function classifyBody(
  via: SurfaceAttempt["via"],
  ok: boolean,
  status: number,
  contentType: string,
  body: string,
): SurfaceAttempt {
  const outcome = classifyWmApiResponse({ ok, status, contentType, body });
  return {
    via,
    ok,
    status,
    contentType,
    outcome: outcome.kind,
    reason: outcome.kind === "blocked" ? outcome.reason : undefined,
    hasNextData: /__NEXT_DATA__|__NUXT__|window\.__INITIAL_STATE__/.test(body),
    hasJsonLd: /application\/ld\+json/i.test(body),
    pxMarkers: detectPxMarkers(body),
    bodyBytes: body.length,
  };
}

const fetchErrorAttempt = (via: SurfaceAttempt["via"], error: unknown): SurfaceAttempt => ({
  via,
  ok: false,
  status: null,
  contentType: "",
  outcome: "fetch-error",
  hasNextData: false,
  hasJsonLd: false,
  pxMarkers: [],
  bodyBytes: 0,
  error: error instanceof Error ? error.message : String(error),
});

/** Raw undici GET — cheap, but its TLS/H2 fingerprint is the rejected one. */
async function fetchSurfaceUndici(url: string): Promise<SurfaceAttempt> {
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": DESKTOP_UA,
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        "Upgrade-Insecure-Requests": "1",
      },
      redirect: "follow",
    });
    return classifyBody(
      "undici",
      resp.ok,
      resp.status,
      resp.headers.get("content-type") ?? "",
      await resp.text(),
    );
  } catch (error) {
    return fetchErrorAttempt("undici", error);
  }
}

/** Browser GET — the real test of whether the surface is reachable + carries data. */
async function fetchSurfaceBrowser(
  context: BrowserContext,
  url: string,
): Promise<SurfaceAttempt> {
  const page = await context.newPage();
  try {
    const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(2500);
    const body = await page.content();
    const headers = resp ? await resp.allHeaders() : {};
    return classifyBody(
      "browser",
      resp ? resp.ok() : false,
      resp?.status() ?? 0,
      headers["content-type"] ?? "",
      body,
    );
  } catch (error) {
    return fetchErrorAttempt("browser", error);
  } finally {
    await page.close();
  }
}

async function probeSurface(
  context: BrowserContext,
  label: string,
  rawUrl: string,
): Promise<SurfaceProbe> {
  const url = assertAllowedUrl(rawUrl, ALLOWED_HOSTS, `surface:${label}`).toString();
  const undici = await fetchSurfaceUndici(url);
  await sleep(1500);
  const browser = await fetchSurfaceBrowser(context, url);
  return { label, url, undici, browser };
}

// ─── Part 2: mint a cookie, test whether it survives leaving the browser ─────────

async function probePortability(context: BrowserContext): Promise<PortabilityProbe> {
  const page = await context.newPage();
  await page.goto(WM_HOMEPAGE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  await page.waitForTimeout(4000); // let the PX sensor run + set cookies

  const cookies = await context.cookies();
  const cookieNames = cookies.map((c) => c.name);
  const pxCookies = cookieNames.filter((n) => /^_?px/i.test(n));

  const apiUrl = buildApiUrl("repasse", 1);

  // (a) baseline: fetch from inside the warmed browser context.
  const inBrowserRaw = await page.evaluate(async (u: string) => {
    const resp = await fetch(u, {
      headers: { Accept: "application/json" },
      credentials: "include",
    });
    return {
      ok: resp.ok,
      status: resp.status,
      contentType: resp.headers.get("content-type") ?? "",
      body: await resp.text(),
    };
  }, apiUrl);
  const inBrowser = classifyWmApiResponse(inBrowserRaw);

  await sleep(1500);

  // (b) portability: replay the SAME request from Node (undici TLS/H2 stack,
  // NOT Chrome's) carrying the minted cookies + closely-matched headers. A block
  // here while (a) succeeds implicates the wire fingerprint, not the cookie.
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const uaFromBrowser = await page.evaluate(() => navigator.userAgent);
  let rawNode: PortabilityProbe["rawNode"];
  try {
    const resp = await fetch(apiUrl, {
      headers: {
        Accept: "application/json",
        "User-Agent": uaFromBrowser,
        "Accept-Language": "pt-BR,pt;q=0.9,en;q=0.8",
        Referer: WM_HOMEPAGE,
        Origin: "https://www.webmotors.com.br",
        Cookie: cookieHeader,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
      },
    });
    const body = await resp.text();
    const outcome = classifyWmApiResponse({
      ok: resp.ok,
      status: resp.status,
      contentType: resp.headers.get("content-type") ?? "",
      body,
    });
    rawNode = {
      outcome: outcome.kind,
      reason: outcome.kind === "blocked" ? outcome.reason : undefined,
      status: resp.status,
    };
  } catch (error) {
    rawNode = {
      outcome: "fetch-error",
      status: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  await page.close();
  return {
    cookiesAfterWarmup: cookieNames,
    pxCookiesPresent: pxCookies,
    inBrowser: {
      outcome: inBrowser.kind,
      reason: inBrowser.kind === "blocked" ? inBrowser.reason : undefined,
      status: inBrowserRaw.status,
    },
    rawNode,
  };
}

// ─── Interpretation: map outcomes → which bypass branch is unlocked ──────────────

function interpret(report: Omit<WebmotorsProbeReport, "interpretation">): string[] {
  const notes: string[] = [];
  const { surfaces, portability } = report;

  for (const s of surfaces) {
    // The browser attempt is authoritative — undici's fingerprint is rejected
    // regardless, so a bare 403 there proves nothing about the surface.
    const b = s.browser;
    if (s.note) {
      notes.push(`SURFACE ${s.label}: ${s.note}`);
      continue;
    }
    if (!b || b.outcome === "fetch-error") {
      notes.push(`SURFACE ${s.label}: browser fetch errored (${b?.error}) — inconclusive.`);
      continue;
    }
    const fpGap =
      s.undici && s.undici.outcome === "blocked" && b.outcome !== "blocked"
        ? " (undici blocked but browser ok — confirms the fingerprint gap on this surface too)"
        : "";
    const unguarded = b.outcome !== "blocked" && b.pxMarkers.length === 0;
    const hasData = b.hasNextData || b.hasJsonLd || b.outcome === "ok";
    if (unguarded && hasData) {
      notes.push(
        `SURFACE ${s.label}: UNGUARDED to a browser + carries data (nextData=${b.hasNextData} jsonLd=${b.hasJsonLd})${fpGap} — strong candidate; validate the data is the PF/repasse set you want before committing.`,
      );
    } else if (b.pxMarkers.length > 0 || b.outcome === "blocked") {
      notes.push(
        `SURFACE ${s.label}: GUARDED even to a browser (${b.reason ?? b.pxMarkers.join(",")}) — anti-bot is in this path; not a free win.`,
      );
    } else {
      notes.push(
        `SURFACE ${s.label}: reachable by browser but no embedded data (nextData=${b.hasNextData} jsonLd=${b.hasJsonLd})${fpGap} — may be JS-hydrated only or a wrong URL path; try a different --ssr-url.`,
      );
    }
  }

  const cfCookies = portability.cookiesAfterWarmup.filter((n) => /^__cf/i.test(n));
  if (cfCookies.length > 0) {
    notes.push(
      `EDGE: Cloudflare Bot Management is in the path (${cfCookies.join(",")}). __cf_bm is fingerprint-bound and short-lived — the impersonation target is likely Cloudflare's JA3/JA4, not (only) PerimeterX. Any raw-HTTP spender must byte-match a real browser's TLS/H2.`,
    );
  }
  if (portability.pxCookiesPresent.length === 0) {
    notes.push(
      "PORTABILITY: no readable _px* cookies after the warm homepage visit — either PerimeterX sets them later/httpOnly-on-a-subpath, or the edge here is Cloudflare-first. The in-browser API call still succeeded, so the mint works; the binding just isn't a cookie undici can copy.",
    );
  }

  const a = portability.inBrowser.outcome;
  const b = portability.rawNode.outcome;
  if (a !== "blocked" && b !== "blocked" && b !== "fetch-error") {
    notes.push(
      "PORTABILITY: cookie SURVIVED leaving the browser (in-browser ok, raw Node ok) — the token is portable; the mint-and-spend token-economy family is viable even without curl-impersonate. Highest-leverage branch is unblocked.",
    );
  } else if (a !== "blocked" && b === "blocked") {
    notes.push(
      "PORTABILITY: cookie DID NOT survive (in-browser ok, raw Node blocked) — the token is bound to the browser's TLS/H2 fingerprint (or another header undici can't match). 'Mint in Chromium, spend in curl' only works with byte-perfect impersonation (curl-impersonate/curl_cffi). Prefer the warm-cookie-once-then-same-context replay, or the surface-switch branch.",
    );
  } else if (a === "blocked") {
    notes.push(
      "PORTABILITY: even the in-browser page-1 fetch was blocked — the block is not a portability question at this moment (fresh session already flagged: likely IP reputation or an already-degraded home IP). Re-run later / from a rotated IP before drawing conclusions.",
    );
  }

  return notes;
}

// ─── CLI ─────────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  let out = "/tmp/webmotors-probe/report.json";
  let ssrUrl = DEFAULT_SSR_URL;
  let icarrosUrl = DEFAULT_ICARROS_URL;
  let headful = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" && argv[i + 1]) out = argv[++i]!;
    else if (a === "--ssr-url" && argv[i + 1]) ssrUrl = argv[++i]!;
    else if (a === "--icarros-url" && argv[i + 1]) icarrosUrl = argv[++i]!;
    else if (a === "--headful") headful = true;
  }
  return { out, ssrUrl, icarrosUrl, headful };
}

export async function runWebmotorsProbe(opts: {
  ssrUrl: string;
  icarrosUrl: string;
  headful?: boolean;
}): Promise<WebmotorsProbeReport> {
  const browser = await chromium.launch({ headless: !opts.headful });
  try {
    const context = await browser.newContext({ locale: "pt-BR" });
    const surfaces: SurfaceProbe[] = [];
    surfaces.push(await probeSurface(context, "webmotors-ssr", opts.ssrUrl));
    await sleep(1500);
    surfaces.push(await probeSurface(context, "icarros", opts.icarrosUrl));
    surfaces.push({
      label: "webmotors-mobile-api",
      url: "(unknown host — requires mitmproxy capture on an Android emulator)",
      note: "Not auto-probed: the mobile app host + app-signed headers must be captured once via mitmproxy before this can be tested (see spec, surface #1).",
    });

    // Fresh context for the mint so surface navigations don't pre-warm it.
    const mintContext = await browser.newContext({ locale: "pt-BR" });
    const portability = await probePortability(mintContext);

    const base = { generatedAt: new Date().toISOString(), surfaces, portability };
    return { ...base, interpretation: interpret(base) };
  } finally {
    await browser.close();
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = assertSafeOutPath(args.out);
  const report = await runWebmotorsProbe({
    ssrUrl: args.ssrUrl,
    icarrosUrl: args.icarrosUrl,
    headful: args.headful,
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.error(`\nProbe report written to ${out}`);
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
