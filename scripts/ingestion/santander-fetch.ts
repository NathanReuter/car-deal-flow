import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright-extra";
import type { Page } from "playwright";
import stealth from "puppeteer-extra-plugin-stealth";
import {
  assertFinalUrlAllowed,
  assertHttpOk,
  assertNotCloudflareBlock,
  assertSafeOutPath,
  isCliEntry,
  parseUrlAndOptionalOut,
} from "./fetch-guards";
import {
  assertAllowedSantanderUrl,
  SANTANDER_ALLOWED_HOSTS,
} from "./santander-list";

chromium.use(stealth());

export class SantanderFetchError extends Error {}

export async function fetchSantanderHtmlWithPage(page: Page, url: string): Promise<string> {
  const parsed = assertAllowedSantanderUrl(url);
  const response = await page.goto(parsed.toString(), {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  await page.waitForTimeout(2500);
  assertFinalUrlAllowed(page.url(), SANTANDER_ALLOWED_HOSTS, "Santander Retomados");
  const html = await page.content();
  assertNotCloudflareBlock(html, parsed.toString());
  assertHttpOk(response, parsed.toString());
  return html;
}

export async function fetchSantanderHtml(url: string): Promise<string> {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    return await fetchSantanderHtmlWithPage(page, url);
  } catch (e) {
    throw new SantanderFetchError(e instanceof Error ? e.message : String(e));
  } finally {
    await browser.close();
  }
}

async function main() {
  const { url, out } = parseUrlAndOptionalOut(process.argv.slice(2));
  const html = await fetchSantanderHtml(url);
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
    process.exit(1);
  });
}
