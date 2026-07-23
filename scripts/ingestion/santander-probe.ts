import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import { assertSafeOutPath, isCliEntry } from "./fetch-guards";

chromium.use(stealth());

export type SantanderProbeReport = {
  url: string;
  finalUrl: string;
  status: number | null;
  blocked: boolean;
  title: string;
  sampleLotUrls: string[];
  notes: string[];
};

export async function probeSantanderRetomados(
  url = "https://www.santander.com.br/retomados",
  htmlOut?: string,
): Promise<SantanderProbeReport> {
  const browser = await chromium.launch({ headless: true });
  const notes: string[] = [];
  try {
    const page = await browser.newPage();
    const response = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(3000);
    const html = await page.content();
    const blocked =
      /Attention Required!\s*\|\s*Cloudflare/i.test(html) ||
      /access denied|403 forbidden/i.test(html) ||
      response?.status() === 403;
    // Only overwrite the capture path on a clean, unblocked fetch — a blocked
    // (Cloudflare wall) run must never clobber a good HTML capture a human
    // saved manually as a fallback.
    if (htmlOut && !blocked) {
      const safeHtmlOut = assertSafeOutPath(htmlOut);
      mkdirSync(dirname(safeHtmlOut), { recursive: true });
      writeFileSync(safeHtmlOut, html, "utf8");
    }
    const lotUrls = [...html.matchAll(/href=["']([^"']*(?:retomado|veiculo|vehicle|lote)[^"']*)["']/gi)]
      .map((m) => m[1])
      .filter((href) => href.startsWith("http") || href.startsWith("/"))
      .slice(0, 20)
      .map((href) => (href.startsWith("http") ? href : new URL(href, page.url()).toString()));

    if (blocked) notes.push("Cloudflare or 403 detected — may need human browser session");
    if (lotUrls.length === 0) notes.push("No lot URLs found in first-page HTML — may be SPA/API");

    return {
      url,
      finalUrl: page.url(),
      status: response?.status() ?? null,
      blocked,
      title: await page.title(),
      sampleLotUrls: [...new Set(lotUrls)],
      notes,
    };
  } finally {
    await browser.close();
  }
}

async function main() {
  const out = assertSafeOutPath(
    process.argv.includes("--out")
      ? process.argv[process.argv.indexOf("--out") + 1]!
      : "/tmp/santander-probe/report.json",
  );
  const htmlOut = process.argv.includes("--html-out")
    ? process.argv[process.argv.indexOf("--html-out") + 1]!
    : undefined;
  const report = await probeSantanderRetomados(undefined, htmlOut);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2), "utf8");
  console.log(JSON.stringify(report, null, 2));
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
