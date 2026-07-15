import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright-extra";
import type { Page } from "playwright";
import stealth from "puppeteer-extra-plugin-stealth";
import { assertSafeOutPath, isCliEntry } from "./fetch-guards";
import { extractFinanceiraEventIds } from "./vip-parse";
import { requireVipSessionPath } from "./vip-leiloes-session";

chromium.use(stealth());

export { requireVipSessionPath, VipSessionError } from "./vip-leiloes-session";

export type VipListLot = { event: string; url: string; text: string };

async function dismissCookies(page: Page) {
  try {
    const btn = page.locator("button.cookies-save, .cookies-container button").first();
    if (await btn.count()) await btn.click({ timeout: 2000 }).catch(() => {});
    await page.evaluate(() => {
      document.querySelector(".cookies-container")?.remove();
    });
  } catch {
    // ignore
  }
}

export async function discoverFinanceiraEventIds(page: Page): Promise<string[]> {
  await page.goto("https://www.vipleiloes.com.br/evento", {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  await dismissCookies(page);
  await page.waitForTimeout(1500);
  const html = await page.content();
  return extractFinanceiraEventIds(html);
}

export async function collectEventLots(page: Page, eventId: string): Promise<VipListLot[]> {
  const url = `https://www.vipleiloes.com.br/evento/detalhes/${eventId}`;
  await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45000 });
  await dismissCookies(page);
  const lots = new Map<string, VipListLot>();

  async function scrapeCurrent() {
    const items = await page.evaluate(() => {
      const out: Array<{ href: string; text: string }> = [];
      for (const a of document.querySelectorAll('a[href*="/evento/anuncio/"]')) {
        const href = (a.getAttribute("href") || "").split("?")[0];
        if (!/\/evento\/anuncio\/[a-z0-9\-]+\-\d{5,}/i.test(href)) continue;
        const text = (a.textContent || "").replace(/\s+/g, " ").trim();
        if (text.length < 15) continue;
        out.push({ href, text: text.slice(0, 500) });
      }
      return out;
    });
    for (const it of items) {
      const full = it.href.startsWith("http")
        ? it.href
        : `https://www.vipleiloes.com.br${it.href}`;
      const prev = lots.get(full);
      if (!prev || it.text.length > prev.text.length) {
        lots.set(full, { event: eventId, url: full, text: it.text });
      }
    }
    return items.length;
  }

  let pageNum = 1;
  while (pageNum <= 30) {
    await scrapeCurrent();
    const nextDisabled = await page.evaluate(() => {
      const nextLi = document.querySelector(
        'li.page-item.page-go:last-child, li.page-item:has(a[aria-label="Next"])',
      );
      return !nextLi || nextLi.classList.contains("disabled");
    });
    if (nextDisabled) break;

    const nextPage = pageNum + 1;
    const nextLink = page.locator(`a.page-link[data-ajax-url*="pageNumber=${nextPage}"]`).first();
    if (!(await nextLink.count())) break;

    const firstBefore = await page.evaluate(() => {
      const a = [...document.querySelectorAll('a[href*="/evento/anuncio/"]')].find((x) =>
        /-\d{5,}/.test((x as HTMLAnchorElement).href),
      );
      return a ? (a as HTMLAnchorElement).href : null;
    });

    await dismissCookies(page);
    await nextLink.click({ timeout: 8000, force: true });
    await page.waitForTimeout(1200);

    const firstAfter = await page.evaluate(() => {
      const a = [...document.querySelectorAll('a[href*="/evento/anuncio/"]')].find((x) =>
        /-\d{5,}/.test((x as HTMLAnchorElement).href),
      );
      return a ? (a as HTMLAnchorElement).href : null;
    });
    if (firstBefore === firstAfter) break;
    pageNum++;
  }

  return [...lots.values()];
}

export async function listVipFinanceirasLots(options?: {
  eventIds?: string[];
}): Promise<{ lots: VipListLot[]; meta: { events: string[]; totalLots: number } }> {
  const sessionPath = requireVipSessionPath();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: sessionPath });
  const page = await context.newPage();

  try {
    const eventIds = options?.eventIds ?? (await discoverFinanceiraEventIds(page));
    const lots: VipListLot[] = [];
    for (const eventId of eventIds) {
      try {
        lots.push(...(await collectEventLots(page, eventId)));
      } catch (error) {
        console.error(`EVENT ${eventId} ERROR:`, error instanceof Error ? error.message : error);
      }
    }
    return { lots, meta: { events: eventIds, totalLots: lots.length } };
  } finally {
    await browser.close();
  }
}

function parseArgs(argv: string[]): { out: string; events?: string[] } {
  let out = "/tmp/vip-financeiras-lots.json";
  const events: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out" && argv[i + 1]) out = argv[++i]!;
    else if (arg === "--event" && argv[i + 1]) events.push(argv[++i]!);
  }
  return { out, events: events.length ? events : undefined };
}

async function main() {
  const { out, events } = parseArgs(process.argv.slice(2));
  const result = await listVipFinanceirasLots({ eventIds: events });
  const payload = { lots: result.lots, meta: result.meta };
  const safeOut = assertSafeOutPath(out);
  mkdirSync(dirname(safeOut), { recursive: true });
  writeFileSync(safeOut, JSON.stringify(payload, null, 2), "utf8");
  console.log(JSON.stringify({ out: safeOut, ...result.meta }, null, 2));
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
