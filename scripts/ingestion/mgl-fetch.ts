// Fetches public MGL Leilões lot HTML. Deterministic I/O only — does not
// interpret the page. Browse/detail are public in a normal browser; the site
// sits behind Cloudflare bot checks, so this uses the same Playwright+stealth
// stack as bidchain-fetch. Never logs in or places bids.
//
//   ./node_modules/.bin/tsx scripts/ingestion/mgl-fetch.ts <url> [--out <file>]

import { writeFileSync } from "node:fs";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

chromium.use(stealth());

export class MglFetchError extends Error {}

export const MGL_ALLOWED_HOSTS = new Set(["mgl.com.br", "www.mgl.com.br"]);

export function assertAllowedMglUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new MglFetchError("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new MglFetchError("Only http(s) URLs are allowed");
  }
  if (!MGL_ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new MglFetchError(
      `host not allowed for MGL fetch: ${url.hostname}`,
    );
  }
  return url;
}

function parseArgs(argv: string[]): { url: string; out?: string } {
  const url = argv[0];
  if (!url || url.startsWith("--")) {
    throw new MglFetchError("Usage: mgl-fetch.ts <url> [--out <file>]");
  }
  const outIdx = argv.indexOf("--out");
  const out = outIdx === -1 ? undefined : argv[outIdx + 1];
  return { url, out };
}

export async function fetchMglHtml(url: string): Promise<string> {
  assertAllowedMglUrl(url);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    // Allow CF challenge / SPA paint; networkidle hangs on auction sites.
    await page.waitForTimeout(2500);
    const html = await page.content();
    if (
      /Attention Required!\s*\|\s*Cloudflare/i.test(html) ||
      /you have been blocked/i.test(html)
    ) {
      throw new MglFetchError(
        `Cloudflare blocked automated fetch for ${url} (status ${response?.status() ?? "n/a"}). Open the lot in a normal browser and save HTML, or retry later.`,
      );
    }
    if (response && !response.ok() && response.status() !== 304) {
      throw new MglFetchError(`HTTP ${response.status()} for ${url}`);
    }
    return html;
  } finally {
    await browser.close();
  }
}

async function main() {
  const { url, out } = parseArgs(process.argv.slice(2));
  const html = await fetchMglHtml(url);
  if (out) {
    writeFileSync(out, html, "utf-8");
    console.log(`Wrote ${html.length} bytes to ${out}`);
  } else {
    process.stdout.write(html);
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
