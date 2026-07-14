// Fetches public BIDchain / white-label lot HTML. Deterministic I/O only —
// does not interpret the page. No login (browse/detail are public; login is
// only required to bid — verified 2026-07-14).
//
//   npx tsx scripts/ingestion/bidchain-fetch.ts <url> [--out <file>]

import { writeFileSync } from "node:fs";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";

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

export function assertAllowedBidchainUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new BidchainFetchError("Invalid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new BidchainFetchError("Only http(s) URLs are allowed");
  }
  if (!BIDCHAIN_ALLOWED_HOSTS.has(url.hostname.toLowerCase())) {
    throw new BidchainFetchError(
      `host not allowed for BIDchain fetch: ${url.hostname}`,
    );
  }
  return url;
}

function parseArgs(argv: string[]): { url: string; out?: string } {
  const url = argv[0];
  if (!url || url.startsWith("--")) {
    throw new BidchainFetchError(
      "Usage: bidchain-fetch.ts <url> [--out <file>]",
    );
  }
  const outIdx = argv.indexOf("--out");
  const out = outIdx === -1 ? undefined : argv[outIdx + 1];
  return { url, out };
}

async function main() {
  const { url, out } = parseArgs(process.argv.slice(2));
  assertAllowedBidchainUrl(url);

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();

  try {
    // networkidle often hangs on auction sites with long-polling; DOM is enough.
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);
    const html = await page.content();

    if (out) {
      writeFileSync(out, html, "utf-8");
      console.log(`Wrote ${html.length} bytes to ${out}`);
    } else {
      process.stdout.write(html);
    }
  } finally {
    await browser.close();
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
