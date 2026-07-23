// Decisive spend test for the Webmotors antibot decision: does a browser-minted
// PerimeterX/Cloudflare session survive being SPENT from a raw-HTTP client whose
// TLS/H2 fingerprint matches the mint browser?
//
// This is the make-or-break experiment for the "mint-and-spend token economy"
// bypass family (see docs/superpowers/specs/2026-07-22-webmotors-antibot-camoufox-design.md
// and the ADHD design handoff). Findings so far (webmotors-probe.ts):
//   - the session is wire-fingerprint-bound: an undici replay of a minted cookie
//     gets 403 while the same request in-browser gets 200;
//   - curl_cffi impersonate="chrome136" matches Playwright's Chromium JA4 + HTTP/2
//     exactly (JA3 differs — legacy fingerprint). So curl_cffi is the fair test of
//     "does the cookie survive if the fingerprint DOES match?".
//
// How it works: this Node script mints a warm session in the SAME Playwright
// stack the harvester uses, records an in-browser control fetch (baseline), then
// hands the cookies + UA + API URLs to scripts/ingestion/webmotors_spend.py which
// replays them over curl_cffi/chrome136. The Python side returns RAW responses;
// this script classifies BOTH paths with classifyWmApiResponse (issue #8) so the
// comparison uses one block-detection rule.
//
// IMPORTANT: run this from a FRESH / cooled IP. A degraded IP blocks the mint
// itself and yields a false negative. Requires a Python with curl_cffi:
//   python3 -m venv .venv-curlcffi && ./.venv-curlcffi/bin/pip install curl_cffi
//
//   ./node_modules/.bin/tsx scripts/ingestion/webmotors-spend-test.ts \
//     [--pages 6] [--query repasse] [--python ./.venv-curlcffi/bin/python] \
//     [--out /tmp/webmotors-spend/result.json]

import { spawnSync } from "node:child_process";
import { mkdirSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { assertSafeOutPath, isCliEntry } from "./fetch-guards";
import {
  buildApiUrl,
  classifyWmApiResponse,
  WM_HOMEPAGE,
  type WmApiOutcome,
} from "./webmotors-list";

chromium.use(stealth());

const SPENDER_PY = join(import.meta.dirname, "webmotors_spend.py");
const ORIGIN = "https://www.webmotors.com.br";

type RawResponse =
  | { url: string; ok: boolean; status: number; contentType: string; body: string }
  | { url: string; error: string };

type PageOutcome = {
  page: number;
  outcome: WmApiOutcome["kind"] | "fetch-error";
  status: number | null;
  reason?: string;
  resultCount?: number;
};

export type SpendTestReport = {
  generatedAt: string;
  query: string;
  pages: number;
  pacingSeconds: { min: number; max: number };
  mint: { pxCookies: string[]; cfCookies: string[]; totalCookies: number };
  control: { via: "in-browser"; page1: PageOutcome };
  curlCffi:
    | { impersonate: string; pages: PageOutcome[] }
    | { skipped: true; reason: string; handoffPath: string };
  verdict: string;
};

function classifyRaw(raw: RawResponse, page: number): PageOutcome {
  if ("error" in raw) {
    return { page, outcome: "fetch-error", status: null, reason: raw.error };
  }
  const outcome = classifyWmApiResponse(raw);
  return {
    page,
    outcome: outcome.kind,
    status: raw.status,
    reason: outcome.kind === "blocked" ? outcome.reason : undefined,
    resultCount: outcome.kind === "ok" ? outcome.results.length : undefined,
  };
}

function pythonHasCurlCffi(python: string): boolean {
  const check = spawnSync(python, ["-c", "import curl_cffi"], { encoding: "utf8" });
  return check.status === 0;
}

function buildVerdict(report: Omit<SpendTestReport, "verdict">): string {
  const control = report.control.page1.outcome;
  if (control === "blocked" || control === "fetch-error") {
    return "INCONCLUSIVE: even the in-browser control was blocked — the IP is likely degraded. Cool down or rotate the IP and re-run before trusting any spend result.";
  }
  if ("skipped" in report.curlCffi) {
    return `PARTIAL: mint + in-browser control succeeded, but curl_cffi was not run (${report.curlCffi.reason}). Install curl_cffi and re-run to complete the test. Handoff written to ${report.curlCffi.handoffPath}.`;
  }
  const cc = report.curlCffi.pages;
  const first = cc.find((p) => p.page === 1);
  if (first && first.outcome !== "blocked" && first.outcome !== "fetch-error") {
    const clean = cc.filter((p) => p.outcome === "ok" || p.outcome === "empty").length;
    const portable = `the browser-minted cookie SURVIVED being spent over curl_cffi/chrome136 (${clean}/${cc.length} pages clean) — JA4+H2 parity is sufficient`;
    // Portability is proven either way; the page count says whether the token
    // economy is worth it or whether the in-browser rotation path wins.
    if (clean * 2 >= cc.length) {
      return `SUCCESS: ${portable}. The mint-and-spend token-economy branch is VIABLE. Next: wire per-token rotation.`;
    }
    return `PORTABLE-BUT-LOW-CEILING: ${portable}, but the per-token page ceiling is low. Human pacing helps; a raw client still can't feed the sensor telemetry the browser does. Prefer in-browser pagination + context rotation over a curl_cffi spender.`;
  }
  return "BOUND-BEYOND-JA4: in-browser worked but the curl_cffi replay (matched JA4+H2) was blocked on page 1 — the session is bound to something curl_cffi still doesn't match (JA3, or an ongoing sensor-telemetry POST). Prefer warm-cookie-once-in-same-context replay, or the surface-switch branch.";
}

export async function runSpendTest(opts: {
  query: string;
  pages: number;
  python: string;
  delayMin: number;
  delayMax: number;
}): Promise<SpendTestReport> {
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext({ locale: "pt-BR" });
    const page = await context.newPage();
    await page.goto(WM_HOMEPAGE, { waitUntil: "domcontentloaded", timeout: 60_000 });
    await page.waitForTimeout(4000);

    const cookies = await context.cookies();
    const userAgent = await page.evaluate(() => navigator.userAgent);
    const cookieNames = cookies.map((c) => c.name);

    // In-browser control: page 1 the way the harvester does it today.
    const apiUrls = Array.from({ length: opts.pages }, (_, i) =>
      buildApiUrl(opts.query, i + 1),
    );
    const controlRaw = await page.evaluate(async (u: string) => {
      const resp = await fetch(u, {
        headers: { Accept: "application/json" },
        credentials: "include",
      });
      return {
        url: u,
        ok: resp.ok,
        status: resp.status,
        contentType: resp.headers.get("content-type") ?? "",
        body: await resp.text(),
      };
    }, apiUrls[0]!);
    const control = classifyRaw(controlRaw as RawResponse, 1);

    const mint = {
      pxCookies: cookieNames.filter((n) => /^_?px/i.test(n)),
      cfCookies: cookieNames.filter((n) => /^__cf/i.test(n)),
      totalCookies: cookieNames.length,
    };

    // Handoff for the curl_cffi sidecar.
    const handoff = {
      userAgent,
      referer: WM_HOMEPAGE,
      origin: ORIGIN,
      cookies: cookies.map((c) => ({ name: c.name, value: c.value })),
      apiUrls,
    };
    // Contains live session cookies — owner-only perms, and deleted on the
    // success path below. Left in place on the skip paths so the user can run
    // the sidecar manually (the PARTIAL verdict points them at it).
    //
    // Fixed, predictable path in a shared tmp dir: remove any pre-existing
    // entry (a leftover from a prior run, or — worst case — a symlink planted
    // ahead of time) before creating fresh with an exclusive flag, so the
    // write can never follow a symlink to somewhere else.
    const handoffPath = join(tmpdir(), "webmotors-spend-handoff.json");
    try {
      unlinkSync(handoffPath);
    } catch {
      /* nothing to remove */
    }
    writeFileSync(handoffPath, JSON.stringify(handoff), {
      encoding: "utf8",
      mode: 0o600,
      flag: "wx",
    });

    const base = {
      generatedAt: new Date().toISOString(),
      query: opts.query,
      pages: opts.pages,
      pacingSeconds: { min: opts.delayMin, max: opts.delayMax },
      mint,
      control: { via: "in-browser" as const, page1: control },
    };

    if (!pythonHasCurlCffi(opts.python)) {
      const partial = {
        ...base,
        curlCffi: {
          skipped: true as const,
          reason: `${opts.python} lacks curl_cffi`,
          handoffPath,
        },
      };
      return { ...partial, verdict: buildVerdict(partial) };
    }

    // Spend via curl_cffi/chrome136.
    const spend = spawnSync(opts.python, [SPENDER_PY, handoffPath], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        WM_SPEND_DELAY_MIN: String(opts.delayMin),
        WM_SPEND_DELAY_MAX: String(opts.delayMax),
      },
    });
    if (spend.status !== 0) {
      const partial = {
        ...base,
        curlCffi: {
          skipped: true as const,
          reason: `sidecar exited ${spend.status}: ${(spend.stderr || "").trim().slice(0, 300)}`,
          handoffPath,
        },
      };
      return { ...partial, verdict: buildVerdict(partial) };
    }

    // Consumed — drop the cookie file (best-effort).
    try {
      unlinkSync(handoffPath);
    } catch {
      /* already gone */
    }

    const parsed = JSON.parse(spend.stdout) as {
      impersonate: string;
      responses: RawResponse[];
    };
    const pages = parsed.responses.map((r, i) => classifyRaw(r, i + 1));
    const full = {
      ...base,
      curlCffi: { impersonate: parsed.impersonate, pages },
    };
    return { ...full, verdict: buildVerdict(full) };
  } finally {
    await browser.close();
  }
}

function parseArgs(argv: string[]) {
  let out = "/tmp/webmotors-spend/result.json";
  let pages = 6;
  let query = "repasse";
  let python = "python3";
  let delayMin = 2;
  let delayMax = 2;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" && argv[i + 1]) out = argv[++i]!;
    else if (a === "--pages" && argv[i + 1]) pages = Number(argv[++i]);
    else if (a === "--query" && argv[i + 1]) query = argv[++i]!;
    else if (a === "--python" && argv[i + 1]) python = argv[++i]!;
    else if (a === "--delay-min" && argv[i + 1]) delayMin = Number(argv[++i]);
    else if (a === "--delay-max" && argv[i + 1]) delayMax = Number(argv[++i]);
  }
  return { out, pages, query, python, delayMin, delayMax };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const out = assertSafeOutPath(args.out);
  const report = await runSpendTest({
    query: args.query,
    pages: args.pages,
    python: args.python,
    delayMin: args.delayMin,
    delayMax: args.delayMax,
  });
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
  console.error(`\n${report.verdict}\nReport written to ${out}`);
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
