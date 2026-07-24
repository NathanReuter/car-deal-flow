// Discovers Webmotors individual-seller (PF) car listings via their internal
// JSON API. Uses Playwright+stealth to bypass PerimeterX, mirrors the
// olx-list.ts / olx-harvest.ts pattern. Never logs in.
//
// Strategy:
//   1. Warm up the Webmotors homepage so PerimeterX grants a session cookie.
//   2. For each keyword pass, hit /api/search/car with tipovendedor=PF.
//   3. Paginate until SearchResults is empty (Pagination.PageTotal is always 0).
//   4. Deduplicate by UniqueId and write a JSON list file.
//
//   ./node_modules/.bin/tsx scripts/ingestion/webmotors-list.ts \
//     --out /tmp/webmotors-harvest/list.json [--max-pages 10] [--dry-run]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright-extra";
import type { Browser, BrowserContext, Page } from "playwright";
import stealth from "puppeteer-extra-plugin-stealth";
import { assertSafeOutPath, isCliEntry } from "./fetch-guards";
import { throttleFetch } from "./lib/harvest-runner";
import type { WebmotorsSearchResult } from "./webmotors-parse";

chromium.use(stealth());

// ─── Constants ──────────────────────────────────────────────────────────────

export const WM_HOMEPAGE = "https://www.webmotors.com.br/";
export const WM_API_BASE = "https://www.webmotors.com.br/api/search/car";

/** Repasse-signal keywords — relevance filter, not exact-match. Re-checked at parse. */
export const WM_QUERIES = ["repasse", "assumo+financiamento", "financiado"];

export const DEFAULT_MAX_PAGES = 10;

// Anti-bot pacing/rotation (measured 2026-07-23: a fresh warm session clears ~6
// API pages before Cloudflare/PerimeterX 403s, and a constant interval is itself
// a bot tell). Jitter each request and rotate the browser context — dropping the
// session cookie and re-warming the homepage — before hitting that page ceiling.
// Opt-in from the CLI entrypoints only; the exported functions default to the
// fixed delay so unit tests (which inject a fake Page) stay fast.
export const WM_PACING = { minMs: 1500, maxMs: 4000 };
export const WM_ROTATE_EVERY_PAGES = 5;

/**
 * Chromium launch options for the CLIs. Runs **headful by default**: the
 * 2026-07-23 antibot findings flagged headless-stealth as itself a likely bot
 * tell, and this project's harvest runs locally on a Mac with a real display.
 * Set `WM_HEADLESS=1` to force headless (e.g. a Linux server, where headful
 * needs xvfb). Unit tests inject their own Page and never hit launch, so this
 * only affects real runs.
 */
export function wmLaunchOptions(): { headless: boolean } {
  return { headless: process.env.WM_HEADLESS === "1" };
}

/**
 * Per-context residential-proxy config, read from env (inert when unset). The
 * 2026-07 findings identified IP reputation — not fingerprint — as the block
 * ceiling: a healthy IP clears ~6 API pages, a degraded one clamps to ~1.
 * Rotating the *cookie* alone doesn't help because it re-warms from the same
 * IP; rotating the *IP* recovers instantly. So each warm-up mints a fresh
 * proxy session, and since {@link warmWebmotorsContext} runs once at start and
 * again on every context rotation, each rotation lands on a new residential IP.
 *
 *   WM_PROXY_SERVER    e.g. http://gate.provider.com:7000  (required to enable)
 *   WM_PROXY_USERNAME  provider username; a literal `{session}` placeholder is
 *                      replaced with a fresh token per call so sticky-session
 *                      providers hand out a new IP each warm-up. Omit the
 *                      placeholder for gateways that rotate per connection.
 *   WM_PROXY_PASSWORD  provider password
 */
export function wmProxyForContext():
  | { server: string; username?: string; password?: string }
  | undefined {
  const server = process.env.WM_PROXY_SERVER;
  if (!server) return undefined;
  const rawUser = process.env.WM_PROXY_USERNAME;
  const token = Math.random().toString(36).slice(2, 12);
  const username = rawUser?.includes("{session}")
    ? rawUser.replace(/\{session\}/g, token)
    : rawUser;
  return {
    server,
    ...(username ? { username } : {}),
    ...(process.env.WM_PROXY_PASSWORD ? { password: process.env.WM_PROXY_PASSWORD } : {}),
  };
}

/**
 * Launch a fresh context and warm the homepage so PerimeterX/Cloudflare issue a
 * valid session cookie. Shared by the list + harvest CLIs and by mid-run context
 * rotation. `locale: pt-BR` matches the target market's expected fingerprint.
 * When `WM_PROXY_SERVER` is set, the context routes through a fresh residential
 * IP (see {@link wmProxyForContext}).
 */
export async function warmWebmotorsContext(
  browser: Browser,
): Promise<{ context: BrowserContext; page: Page }> {
  const proxy = wmProxyForContext();
  const context = await browser.newContext({ locale: "pt-BR", proxy });
  // Cost control on metered residential proxies only: the homepage warm-up is
  // the only byte-heavy request (the JSON API pages are tiny). Aborting images
  // and media cuts most warm-up traffic without touching the HTML, JS, CSS,
  // fonts, or XHR the anti-bot sensor needs. Fonts stay loaded — negligible
  // bytes, and a more browser-like fingerprint.
  //
  // Gated on proxy being set so the free (direct) path stays fingerprint-
  // identical to the pre-proxy baseline. Image-blocking is still unverified
  // against the live anti-bot (a homepage beacon can masquerade as an image),
  // so A/B it on the first proxied run — WM_LOAD_IMAGES=1 (all loading) vs
  // unset — and keep whichever clears more pages. WM_LOAD_IMAGES=1 disables
  // blocking even when a proxy is configured.
  if (
    proxy &&
    process.env.WM_LOAD_IMAGES !== "1" &&
    typeof context.route === "function"
  ) {
    await context.route("**/*", (route) => {
      const type = route.request().resourceType();
      return type === "image" || type === "media" ? route.abort() : route.continue();
    });
  }
  const page = await context.newPage();
  await page.goto(WM_HOMEPAGE, { waitUntil: "domcontentloaded", timeout: 60_000 });
  // Jittered settle time — a constant wait is itself a bot tell, same rationale
  // as the inter-request pacing.
  await page.waitForTimeout(2500 + Math.floor(Math.random() * 2000));
  return { context, page };
}

// ─── Types ───────────────────────────────────────────────────────────────────

export interface WmListCard {
  uniqueId: string;
  title: string;
  brand: string;
  model: string;
  year: number;
  priceBRL: number | null;
  city: string;
  state: string;
}

export interface WmListResult {
  generatedAt: string;
  queries: string[];
  ads: WmListCard[];
}

// ─── API helpers ─────────────────────────────────────────────────────────────

export function buildApiUrl(keyword: string, page: number): string {
  const params = new URLSearchParams({
    tipovendedor: "PF",
    tipoveiculo: "carros",
    q: keyword.replace(/\+/g, " "), // URLSearchParams will re-encode spaces
    pagina: String(page),
    quantidade: "24",
    ordem: "1",
  });
  return `${WM_API_BASE}?${params.toString()}`;
}

interface WmApiResponse {
  SearchResults?: WebmotorsSearchResult[];
}

// ─── PerimeterX block detection ───────────────────────────────────────────────

/** Thrown when the internal JSON API returns an anti-bot block instead of
 * results. Callers treat this as fatal (fail-closed) rather than end-of-results. */
export class WebmotorsBlockError extends Error {
  constructor(reason: string) {
    super(reason);
    this.name = "WebmotorsBlockError";
  }
}

/** Body substrings that mark a PerimeterX / anti-bot wall (served as HTTP 200
 * HTML). Case-insensitive. */
export const WM_BLOCK_MARKERS: RegExp[] = [
  /access to this page has been denied/i,
  /px-captcha/i,
  /_pxhd/i,
  /perimeterx/i,
];

const WM_HTML_PREFIX = /^\s*<(?:!doctype|html)\b/i;

/** Outcome of a raw API response, classified in Node (the fetch itself runs in
 * the browser context and only returns raw materials). */
export type WmApiOutcome =
  | { kind: "ok"; results: WebmotorsSearchResult[] }
  | { kind: "empty" }
  | { kind: "blocked"; reason: string };

/**
 * Pure classifier: distinguishes a genuine empty page from an anti-bot block.
 *
 * - `!ok` (403/429/5xx)                 → blocked
 * - HTML content-type or anti-bot body  → blocked
 * - unparseable / non-object JSON       → blocked
 * - object with non-empty SearchResults → ok
 * - object with empty/missing results   → empty (genuine end-of-results)
 */
export function classifyWmApiResponse(raw: {
  ok: boolean;
  status: number;
  contentType: string;
  body: string;
}): WmApiOutcome {
  if (!raw.ok) {
    return {
      kind: "blocked",
      reason: raw.status === 0 ? `network error: ${raw.body}` : `HTTP ${raw.status}`,
    };
  }

  if (/html/i.test(raw.contentType) || WM_HTML_PREFIX.test(raw.body)) {
    return { kind: "blocked", reason: "anti-bot HTML page" };
  }
  if (WM_BLOCK_MARKERS.some((re) => re.test(raw.body))) {
    return { kind: "blocked", reason: "anti-bot marker in response body" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.body);
  } catch {
    return { kind: "blocked", reason: "non-JSON response body" };
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "blocked", reason: "unexpected response shape" };
  }

  const results = (parsed as WmApiResponse).SearchResults;
  if (Array.isArray(results) && results.length > 0) return { kind: "ok", results };
  return { kind: "empty" };
}

/**
 * Fetch one API page inside the warmed-up browser context. Returns the raw
 * results array, or throws {@link WebmotorsBlockError} if the response is an
 * anti-bot block (so callers can fail closed instead of mistaking it for
 * end-of-results). A genuine empty page returns `[]`.
 */
/** In-page fetch timeout. Without this, a silently-held-open connection
 * (a block tactic seen in the wild) leaves `fetch()` — and the whole
 * harvest — hung forever instead of failing closed. */
export const WM_FETCH_TIMEOUT_MS = 20_000;

export async function fetchApiPage(
  page: Page,
  keyword: string,
  pageNo: number,
): Promise<WebmotorsSearchResult[]> {
  const url = buildApiUrl(keyword, pageNo);

  const raw = await page.evaluate(
    async ({ apiUrl, timeoutMs }: { apiUrl: string; timeoutMs: number }) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const resp = await fetch(apiUrl, {
          headers: { Accept: "application/json" },
          credentials: "include",
          signal: controller.signal,
        });
        return {
          ok: resp.ok,
          status: resp.status,
          contentType: resp.headers.get("content-type") ?? "",
          body: await resp.text(),
        };
      } catch (err) {
        return {
          ok: false,
          status: 0,
          contentType: "",
          body: `fetch failed: ${err instanceof Error ? err.message : String(err)}`,
        };
      } finally {
        clearTimeout(timer);
      }
    },
    { apiUrl: url, timeoutMs: WM_FETCH_TIMEOUT_MS },
  );

  const outcome = classifyWmApiResponse(raw);
  if (outcome.kind === "blocked") {
    throw new WebmotorsBlockError(`${outcome.reason} for ${url}`);
  }
  return outcome.kind === "ok" ? outcome.results : [];
}

function resultToCard(r: WebmotorsSearchResult): WmListCard {
  const loc = r.Seller.Localization?.[0];
  const city = loc?.City ?? r.Seller.City ?? "";
  const abbrState = loc?.AbbrState ?? extractAbbrState(r.Seller.State ?? "");
  const price =
    typeof r.Prices.Price === "number" && r.Prices.Price > 0 ? r.Prices.Price : null;
  return {
    uniqueId: String(r.UniqueId),
    title: r.Specification.Title ?? "",
    brand: r.Specification.Make?.Value ?? "",
    model: r.Specification.Model?.Value ?? "",
    year: r.Specification.YearModel ?? 0,
    priceBRL: price,
    city,
    state: abbrState,
  };
}

function extractAbbrState(raw: string): string {
  const m = raw.match(/\(([A-Z]{2})\)/);
  return m ? m[1] : raw;
}

// ─── Core list function ───────────────────────────────────────────────────────

export async function listWebmotorsAds(options: {
  queries?: string[];
  maxPagesPerQuery?: number;
  page: Page;
  /** When provided, rotate the context + re-warm every rotateEveryPages fetches. */
  browser?: Browser;
  rotateEveryPages?: number;
  /** Jitter window for inter-request pacing (opt-in; default fixed delay). */
  pacing?: { minMs: number; maxMs: number };
}): Promise<WmListResult> {
  const queries = options.queries ?? WM_QUERIES;
  const maxPages = options.maxPagesPerQuery ?? DEFAULT_MAX_PAGES;
  const rotateEvery = options.rotateEveryPages ?? WM_ROTATE_EVERY_PAGES;
  const byId = new Map<string, WmListCard>();

  let page = options.page;
  // Track the initial (pre-warmed) context too, so the first rotation closes it
  // instead of orphaning it for the whole run. Null in tests (no browser).
  let context: BrowserContext | null = options.browser ? options.page.context() : null;
  let pagesSinceWarm = 0;
  try {
    for (const keyword of queries) {
      for (let pageNo = 1; pageNo <= maxPages; pageNo++) {
        // Rotate to a fresh session before crossing the ~6-page block ceiling.
        if (options.browser && pagesSinceWarm >= rotateEvery) {
          if (context) await context.close();
          const warm = await warmWebmotorsContext(options.browser);
          context = warm.context;
          page = warm.page;
          pagesSinceWarm = 0;
        }

        // fetchApiPage throws WebmotorsBlockError on an anti-bot block. We let it
        // propagate to the CLI (which exits non-zero) on purpose: fail closed
        // rather than swallow a block and emit a truncated list (issue #8). Do
        // NOT wrap this in a try/catch that returns partial results.
        const results = await fetchApiPage(page, keyword, pageNo);
        pagesSinceWarm++;
        if (results.length === 0) break;

        let newOnPage = 0;
        for (const r of results) {
          const id = String(r.UniqueId);
          if (!byId.has(id)) {
            byId.set(id, resultToCard(r));
            newOnPage++;
          }
        }
        if (newOnPage === 0) break;
        await throttleFetch(options.pacing);
      }
    }
  } finally {
    if (context) await context.close();
  }

  return {
    generatedAt: new Date().toISOString(),
    queries,
    ads: [...byId.values()],
  };
}

// ─── CLI entry ────────────────────────────────────────────────────────────────

function parseArgs(argv: string[]) {
  let out = "/tmp/webmotors-harvest/list.json";
  let maxPages = DEFAULT_MAX_PAGES;
  const extraQueries: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out" && argv[i + 1]) out = argv[++i]!;
    else if (arg === "--max-pages" && argv[i + 1]) maxPages = Number(argv[++i]);
    else if (arg === "--query" && argv[i + 1]) extraQueries.push(argv[++i]!);
  }
  return { out, maxPages, extraQueries };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const browser = await chromium.launch(wmLaunchOptions());
  try {
    const { page } = await warmWebmotorsContext(browser);

    const result = await listWebmotorsAds({
      queries: [...WM_QUERIES, ...args.extraQueries],
      maxPagesPerQuery: args.maxPages,
      page,
      browser,
      rotateEveryPages: WM_ROTATE_EVERY_PAGES,
      pacing: WM_PACING,
    });
    const safeOut = assertSafeOutPath(args.out);
    mkdirSync(dirname(safeOut), { recursive: true });
    writeFileSync(safeOut, JSON.stringify(result, null, 2), "utf8");
    console.log(
      JSON.stringify({ ads: result.ads.length, queries: result.queries.length, out: safeOut }),
    );
  } finally {
    await browser.close();
  }
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
