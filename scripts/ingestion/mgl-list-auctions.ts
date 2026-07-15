import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { chromium } from "playwright-extra";
import stealth from "puppeteer-extra-plugin-stealth";
import {
  assertFinalUrlAllowed,
  assertHttpOk,
  assertNotCloudflareBlock,
  assertSafeOutPath,
  isCliEntry,
} from "./fetch-guards";
import { assertAllowedMglUrl, MGL_ALLOWED_HOSTS, MglFetchError } from "./mgl-fetch";
import { isBatidosAuction } from "./lib/listing-filters";

chromium.use(stealth());

export type MglAuction = {
  id: number;
  url: string;
  title: string;
  slug: string;
};

export type MglAuctionListResult = {
  auctions: MglAuction[];
  meta: { total: number };
  skipped: Record<string, number>;
};

const AUCTION_HREF = /href=["']((?:https?:\/\/(?:www\.)?mgl\.com\.br)?(\/leilao\/([^/"']+)\/(\d+)\/?))["']/gi;

const CORP_REPASSE =
  /\b(repasse|corporativ|frota|fleet|locadora|localiza|movida|unidas|omni|banco|financ|retomado)\b/i;

export function extractMglAuctionId(url: string): number | null {
  const m = url.match(/\/leilao\/[^/]+\/(\d+)\/?$/i);
  return m ? Number(m[1]) : null;
}

export function extractMglAuctionsFromHtml(html: string, baseUrl: string): MglAuction[] {
  const base = new URL(baseUrl);
  const seen = new Set<number>();
  const auctions: MglAuction[] = [];

  for (const match of html.matchAll(AUCTION_HREF)) {
    const path = match[2] ?? "";
    const slug = match[3] ?? "";
    const id = Number(match[4]);
    if (!id || seen.has(id)) continue;

    const origin = match[1]?.startsWith("http")
      ? new URL(match[1]).origin
      : `${base.protocol}//${base.host}`;
    const url = `${origin}${path.startsWith("/") ? path : `/${path}`}`;

    const anchorRe = new RegExp(
      `<a[^>]+href=["'][^"']*\\/leilao\\/${slug.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\/${id}\\/?["'][^>]*>([\\s\\S]*?)<\\/a>`,
      "i",
    );
    const anchor = html.match(anchorRe);
    const title = (anchor?.[1] ?? slug.replace(/-/g, " "))
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    seen.add(id);
    auctions.push({ id, url, title, slug });
  }

  return auctions;
}

export function filterMglAuction(auction: MglAuction): { keep: boolean; reason?: string } {
  if (isBatidosAuction(auction.url, auction.title)) {
    return { keep: false, reason: "batidos_auction" };
  }
  if (!CORP_REPASSE.test(`${auction.url} ${auction.title}`)) {
    return { keep: false, reason: "not_corp_repasse" };
  }
  return { keep: true };
}

function bumpSkip(skipped: Record<string, number>, reason: string) {
  skipped[reason] = (skipped[reason] ?? 0) + 1;
}

export async function listMglCorpAuctions(options?: {
  indexUrl?: string;
}): Promise<MglAuctionListResult> {
  const indexUrl = options?.indexUrl ?? "https://www.mgl.com.br/leiloes";
  const skipped: Record<string, number> = {};
  const byId = new Map<number, MglAuction>();

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const parsed = assertAllowedMglUrl(indexUrl);
    const response = await page.goto(parsed.toString(), {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await page.waitForTimeout(2500);
    assertFinalUrlAllowed(page.url(), MGL_ALLOWED_HOSTS, "MGL");
    assertHttpOk(response, parsed.toString());
    const html = await page.content();
    assertNotCloudflareBlock(html, parsed.toString());

    for (const auction of extractMglAuctionsFromHtml(html, page.url())) {
      const filter = filterMglAuction(auction);
      if (!filter.keep) {
        bumpSkip(skipped, filter.reason ?? "skipped");
        continue;
      }
      byId.set(auction.id, auction);
    }
  } finally {
    await browser.close();
  }

  const auctions = [...byId.values()];
  return { auctions, meta: { total: auctions.length }, skipped };
}

function parseArgs(argv: string[]): { out: string; indexUrl?: string } {
  let out = "/tmp/mgl-auctions.json";
  let indexUrl: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out" && argv[i + 1]) out = argv[++i]!;
    else if (arg === "--index-url" && argv[i + 1]) indexUrl = argv[++i];
  }
  return { out, indexUrl };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = await listMglCorpAuctions({ indexUrl: args.indexUrl });
  const safeOut = assertSafeOutPath(args.out);
  mkdirSync(dirname(safeOut), { recursive: true });
  writeFileSync(safeOut, JSON.stringify(result, null, 2), "utf8");
  console.log(JSON.stringify(result, null, 2));
}

if (isCliEntry(import.meta.url, process.argv[1])) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
