/**
 * Fetch a public Leilões PB (leiloespb.com.br) page into an HTML file.
 *
 * Browse/detail are public (no login). Login is for bidding only — never automate it.
 *
 * Usage:
 *   ./node_modules/.bin/tsx scripts/ingestion/leiloes-pb-fetch.ts "<url>" --out /tmp/lot.html
 *   ./node_modules/.bin/tsx scripts/ingestion/leiloes-pb-fetch.ts --url "<url>" --out /tmp/lot.html
 */
import { chromium } from "playwright";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const ALLOWED_HOSTS = new Set(["leiloespb.com.br", "www.leiloespb.com.br"]);

export function assertLeiloesPbUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Unsupported protocol: ${url.protocol}`);
  }
  if (!ALLOWED_HOSTS.has(url.hostname)) {
    throw new Error(
      `Host not allowed for Leilões PB fetch: ${url.hostname}. Allowed: ${[...ALLOWED_HOSTS].join(", ")}`
    );
  }
  return url;
}

function parseArgs(argv: string[]): { url: string; out: string } {
  let url = "";
  let out = "";
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") {
      url = argv[++i] ?? "";
      continue;
    }
    if (a === "--out") {
      out = argv[++i] ?? "";
      continue;
    }
    if (!a.startsWith("-") && !url) {
      url = a;
      continue;
    }
    throw new Error(`Unknown argument: ${a}`);
  }
  if (!url) throw new Error("Missing URL (positional or --url)");
  if (!out) throw new Error("Missing --out <path>");
  return { url, out };
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
    if (!response) {
      throw new Error(`No response for ${parsed}`);
    }
    if (!response.ok()) {
      throw new Error(`HTTP ${response.status()} for ${parsed}`);
    }
    return await page.content();
  } finally {
    await browser.close();
  }
}

async function main() {
  const { url, out } = parseArgs(process.argv.slice(2));
  assertLeiloesPbUrl(url);
  const html = await fetchLeiloesPbHtml(url);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, html, "utf8");
  console.log(
    JSON.stringify(
      {
        ok: true,
        url,
        out,
        bytes: Buffer.byteLength(html, "utf8"),
      },
      null,
      2
    )
  );
}

const isDirectRun =
  process.argv[1]?.includes("leiloes-pb-fetch") ||
  process.argv[1]?.endsWith("leiloes-pb-fetch.ts");

if (isDirectRun) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
