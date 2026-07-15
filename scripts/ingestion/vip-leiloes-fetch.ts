// Fetches rendered HTML for a VIP Leilões URL. Deterministic I/O only —
// this script does not interpret the page; it hands back raw HTML for the
// harvest skill to read and extract structured data from.
//
//   npx tsx scripts/ingestion/vip-leiloes-fetch.ts <url> [--out <file>]
//
// Prints the HTML to stdout by default, or writes it to --out if given.
//
// The `www.vipleiloes.com.br` event/lot pages (agenda, evento/detalhes,
// evento/anuncio) are public — no login required, verified live. The
// stealth plugin alone (below) is what's needed there, to get past
// Cloudflare bot detection (plain headless Playwright gets a 403; stealth
// gets a real 200). Only `minhaconta.vipleiloes.com.br` (the account
// dashboard) requires the saved session from vip-leiloes-login.ts — this
// script uses it opportunistically when present, but does not require it
// for public pages.

import { existsSync } from "node:fs";
import { writeFileSync } from "node:fs";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { STATE_PATH } from "./vip-leiloes-session";

chromium.use(stealth());

class VipFetchError extends Error {}

function parseArgs(argv: string[]): { url: string; out?: string } {
  const url = argv[0];
  if (!url || url.startsWith("--")) {
    throw new VipFetchError("Usage: vip-leiloes-fetch.ts <url> [--out <file>]");
  }
  const outIdx = argv.indexOf("--out");
  const out = outIdx === -1 ? undefined : argv[outIdx + 1];
  return { url, out };
}

async function main() {
  const { url, out } = parseArgs(process.argv.slice(2));
  const needsAccountSession = new URL(url).hostname === "minhaconta.vipleiloes.com.br";

  if (needsAccountSession && !existsSync(STATE_PATH)) {
    throw new VipFetchError(
      `No saved VIP Leilões session at ${STATE_PATH}. Run: npx tsx scripts/ingestion/vip-leiloes-login.ts`,
    );
  }

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext(
    existsSync(STATE_PATH) ? { storageState: STATE_PATH } : {},
  );
  const page = await context.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
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

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
});
