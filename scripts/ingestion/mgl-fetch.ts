// Fetches public MGL Leilões lot HTML. Deterministic I/O only — does not
// interpret the page. Browse/detail are public in a normal browser; the site
// sits behind Cloudflare bot checks, so this uses the same Playwright+stealth
// stack as bidchain-fetch. Never logs in or places bids.
//
//   ./node_modules/.bin/tsx scripts/ingestion/mgl-fetch.ts <url> [--out <file>]

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright-extra";
import type { Page } from "playwright";
import stealth from "puppeteer-extra-plugin-stealth";
import {
  assertAllowedUrl,
  assertFinalUrlAllowed,
  assertHttpOk,
  assertNotCloudflareBlock,
  assertSafeOutPath,
  isCliEntry,
  parseUrlAndOptionalOut,
} from "./fetch-guards";

chromium.use(stealth());

export class MglFetchError extends Error {}

export const MGL_ALLOWED_HOSTS = new Set(["mgl.com.br", "www.mgl.com.br"]);

export function assertAllowedMglUrl(raw: string): URL {
  try {
    return assertAllowedUrl(raw, MGL_ALLOWED_HOSTS, "MGL");
  } catch (e) {
    throw new MglFetchError(e instanceof Error ? e.message : String(e));
  }
}

export async function fetchMglHtmlWithPage(page: Page, url: string): Promise<string> {
  const parsed = assertAllowedMglUrl(url);
  const response = await page.goto(parsed.toString(), {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(2500);
  try {
    assertFinalUrlAllowed(page.url(), MGL_ALLOWED_HOSTS, "MGL");
  } catch (e) {
    throw new MglFetchError(e instanceof Error ? e.message : String(e));
  }
  const html = await page.content();
  try {
    assertNotCloudflareBlock(html, parsed.toString());
    assertHttpOk(response, parsed.toString());
  } catch (e) {
    throw new MglFetchError(e instanceof Error ? e.message : String(e));
  }
  return html;
}

export async function fetchMglHtml(url: string): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    return await fetchMglHtmlWithPage(page, url);
  } finally {
    await browser.close();
  }
}

async function main() {
  const { url, out } = parseUrlAndOptionalOut(process.argv.slice(2));
  const html = await fetchMglHtml(url);
  if (out) {
    const safeOut = assertSafeOutPath(out);
    mkdirSync(dirname(safeOut), { recursive: true });
    writeFileSync(safeOut, html, "utf-8");
    console.log(`Wrote ${html.length} bytes to ${safeOut}`);
  } else {
    process.stdout.write(html);
  }
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  });
}
