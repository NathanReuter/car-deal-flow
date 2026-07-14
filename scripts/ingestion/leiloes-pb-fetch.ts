/**
 * Fetch a public Leilões PB (leiloespb.com.br) page into an HTML file.
 *
 * Browse/detail are public (no login). Login is for bidding only — never automate it.
 *
 * Usage:
 *   ./node_modules/.bin/tsx scripts/ingestion/leiloes-pb-fetch.ts "<url>" [--out /tmp/lot.html]
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright";
import {
  assertAllowedUrl,
  assertFinalUrlAllowed,
  assertHttpOk,
  assertNotCloudflareBlock,
  assertSafeOutPath,
  isCliEntry,
  parseUrlAndOptionalOut,
} from "./fetch-guards";

export class LeiloesPbFetchError extends Error {}

export const LEILOES_PB_ALLOWED_HOSTS = new Set([
  "leiloespb.com.br",
  "www.leiloespb.com.br",
]);

export function assertLeiloesPbUrl(raw: string): URL {
  try {
    return assertAllowedUrl(raw, LEILOES_PB_ALLOWED_HOSTS, "Leilões PB");
  } catch (e) {
    throw new LeiloesPbFetchError(e instanceof Error ? e.message : String(e));
  }
}

export async function fetchLeiloesPbHtml(url: string): Promise<string> {
  const parsed = assertLeiloesPbUrl(url);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const response = await page.goto(parsed.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    try {
      assertFinalUrlAllowed(page.url(), LEILOES_PB_ALLOWED_HOSTS, "Leilões PB");
      assertHttpOk(response, parsed.toString());
    } catch (e) {
      throw new LeiloesPbFetchError(
        e instanceof Error ? e.message : String(e),
      );
    }
    const html = await page.content();
    try {
      assertNotCloudflareBlock(html, parsed.toString());
    } catch (e) {
      throw new LeiloesPbFetchError(
        e instanceof Error ? e.message : String(e),
      );
    }
    return html;
  } finally {
    await browser.close();
  }
}

async function main() {
  const { url, out } = parseUrlAndOptionalOut(process.argv.slice(2));
  const html = await fetchLeiloesPbHtml(url);
  if (out) {
    const safeOut = assertSafeOutPath(out);
    mkdirSync(dirname(safeOut), { recursive: true });
    writeFileSync(safeOut, html, "utf8");
    console.log(
      JSON.stringify(
        {
          ok: true,
          url,
          out: safeOut,
          bytes: Buffer.byteLength(html, "utf8"),
        },
        null,
        2,
      ),
    );
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
