import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright-extra";
import type { Page } from "playwright";
import stealth from "puppeteer-extra-plugin-stealth";
import { assertSafeOutPath, isCliEntry } from "./fetch-guards";
import { extractVipDetailFromHtml, type VipDetail } from "./vip-parse";
import { requireVipSessionPath, type VipListLot } from "./vip-list-financeiras";

chromium.use(stealth());

export type VipDetailsFile = {
  details: VipDetail[];
  errors: Array<{ url: string; event: string; error: string }>;
};

export function loadVipLotsFile(raw: string): VipListLot[] {
  const payload = JSON.parse(raw) as { lots?: VipListLot[] } | VipListLot[];
  if (Array.isArray(payload)) return payload;
  return payload.lots ?? [];
}

async function dismissCookies(page: Page) {
  try {
    await page.evaluate(() => {
      document.querySelector(".cookies-container")?.remove();
    });
  } catch {
    // ignore
  }
}

export async function fetchVipDetailsBatch(options: {
  lots: VipListLot[];
  existing?: VipDetailsFile;
  limit?: number;
  skipExisting?: boolean;
}): Promise<VipDetailsFile> {
  const sessionPath = requireVipSessionPath();
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ storageState: sessionPath });
  const page = await context.newPage();

  const existingUrls = new Set(
    (options.existing?.details ?? []).map((d) => d.url),
  );
  const out: VipDetail[] = [...(options.existing?.details ?? [])];
  const errors: VipDetailsFile["errors"] = [...(options.existing?.errors ?? [])];

  const lots = options.limit ? options.lots.slice(0, options.limit) : options.lots;

  try {
    for (const lot of lots) {
      if (options.skipExisting && existingUrls.has(lot.url)) continue;
      try {
        await page.goto(lot.url, { waitUntil: "domcontentloaded", timeout: 45000 });
        await page.waitForTimeout(800);
        await dismissCookies(page);
        await page.waitForSelector("th", { timeout: 8000 }).catch(() => {});
        const html = await page.content();
        if (
          /sess[aã]o\s+expir|fa[cç]a\s+login|entrar\s+na\s+sua\s+conta/i.test(html) &&
          html.length < 50000
        ) {
          throw new Error(
            "SESSION_EXPIRED — re-run ./node_modules/.bin/tsx scripts/ingestion/vip-leiloes-login.ts",
          );
        }
        if (/Attention Required!\s*\|\s*Cloudflare/i.test(html)) {
          throw new Error("Cloudflare blocked VIP fetch — retry later");
        }
        const detail = extractVipDetailFromHtml(html, lot.url, lot.event);
        out.push(detail);
        existingUrls.add(lot.url);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        errors.push({ url: lot.url, event: lot.event, error: msg });
        if (msg.includes("SESSION_EXPIRED")) break;
      }
    }
  } finally {
    await browser.close();
  }

  return { details: out, errors };
}

function parseArgs(argv: string[]): {
  lotsPath: string;
  out: string;
  limit?: number;
  skipExisting: boolean;
} {
  let lotsPath = "/tmp/vip-financeiras-lots.json";
  let out = "/tmp/vip-financeiras-details.json";
  let skipExisting = false;
  let limit: number | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--lots" && argv[i + 1]) lotsPath = argv[++i]!;
    else if (arg === "--out" && argv[i + 1]) out = argv[++i]!;
    else if (arg === "--limit" && argv[i + 1]) limit = Number(argv[++i]);
    else if (arg === "--skip-existing") skipExisting = true;
  }
  return { lotsPath, out, limit, skipExisting };
}

async function main() {
  const { lotsPath, out, limit, skipExisting } = parseArgs(process.argv.slice(2));
  const safeLots = assertSafeOutPath(lotsPath);
  const lots = loadVipLotsFile(readFileSync(safeLots, "utf8"));
  let existing: VipDetailsFile | undefined;
  const safeOut = assertSafeOutPath(out);
  if (skipExisting && existsSync(safeOut)) {
    existing = JSON.parse(readFileSync(safeOut, "utf8")) as VipDetailsFile;
  }
  const result = await fetchVipDetailsBatch({ lots, existing, limit, skipExisting });
  mkdirSync(dirname(safeOut), { recursive: true });
  writeFileSync(safeOut, JSON.stringify(result, null, 2), "utf8");
  console.log(
    JSON.stringify(
      { out: safeOut, details: result.details.length, errors: result.errors.length },
      null,
      2,
    ),
  );
  if (result.errors.some((e) => e.error.includes("SESSION_EXPIRED"))) process.exitCode = 1;
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
