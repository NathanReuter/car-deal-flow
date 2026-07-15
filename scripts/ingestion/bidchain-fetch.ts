// Fetches public BIDchain / white-label lot HTML. Deterministic I/O only —
// does not interpret the page. No login (browse/detail are public; login is
// only required to bid — verified 2026-07-14).
//
//   ./node_modules/.bin/tsx scripts/ingestion/bidchain-fetch.ts <url> [--out <file>]

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
  normalizeHostname,
  parseUrlAndOptionalOut,
} from "./fetch-guards";

chromium.use(stealth());

export class BidchainFetchError extends Error {}

/** Hosts used by BIDchain / Plataforma Leiloar white-labels for vehicle lots. */
export const BIDCHAIN_ALLOWED_HOSTS = new Set([
  "bidchain.com.br",
  "www.bidchain.com.br",
  "adrileiloes.com.br",
  "www.adrileiloes.com.br",
  "canaldeleiloes.net",
  "www.canaldeleiloes.net",
]);

export function isAllowedBidchainHost(hostname: string): boolean {
  return BIDCHAIN_ALLOWED_HOSTS.has(normalizeHostname(hostname));
}

export function assertAllowedBidchainUrl(raw: string): URL {
  try {
    return assertAllowedUrl(raw, BIDCHAIN_ALLOWED_HOSTS, "BIDchain");
  } catch (e) {
    throw new BidchainFetchError(e instanceof Error ? e.message : String(e));
  }
}

export async function fetchBidchainHtmlWithPage(page: Page, url: string): Promise<string> {
  const parsed = assertAllowedBidchainUrl(url);
  const response = await page.goto(parsed.toString(), {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(1500);
  try {
    assertFinalUrlAllowed(page.url(), BIDCHAIN_ALLOWED_HOSTS, "BIDchain");
    assertHttpOk(response, parsed.toString());
  } catch (e) {
    throw new BidchainFetchError(e instanceof Error ? e.message : String(e));
  }
  const html = await page.content();
  try {
    assertNotCloudflareBlock(html, parsed.toString());
  } catch (e) {
    throw new BidchainFetchError(e instanceof Error ? e.message : String(e));
  }
  return html;
}

export async function fetchBidchainHtml(url: string): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    return await fetchBidchainHtmlWithPage(page, url);
  } finally {
    await browser.close();
  }
}

async function main() {
  const { url, out } = parseUrlAndOptionalOut(process.argv.slice(2));
  const html = await fetchBidchainHtml(url);
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
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
