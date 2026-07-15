import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { assertSafeOutPath, assertAllowedUrl, isCliEntry } from "./fetch-guards";
import { detectDamageSignals } from "../../src/lib/filters/damageSignals";

export const SANTANDER_ALLOWED_HOSTS = new Set([
  "santander.com.br",
  "www.santander.com.br",
  "retomados.santander.com.br",
  "www.retomados.santander.com.br",
]);

export type SantanderListLot = {
  id: string;
  url: string;
  title: string;
};

export type SantanderListResult = {
  lots: SantanderListLot[];
  meta: { total: number };
  skipped: Record<string, number>;
};

const VEHICLE_HREF =
  /href=["']([^"']*(?:retomado|veiculo|vehicle)[^"']*)["']/gi;

export function assertAllowedSantanderUrl(raw: string): URL {
  return assertAllowedUrl(raw, SANTANDER_ALLOWED_HOSTS, "Santander Retomados");
}

export function extractSantanderLotId(url: string): string | null {
  const m = url.match(/(?:veiculo|vehicle|retomado)[^/]*\/(\d+)/i) ?? url.match(/\/(\d+)\/?$/);
  return m?.[1] ?? null;
}

export function extractSantanderLotsFromHtml(
  html: string,
  baseUrl: string,
): SantanderListLot[] {
  const base = new URL(baseUrl);
  const seen = new Set<string>();
  const lots: SantanderListLot[] = [];

  for (const match of html.matchAll(VEHICLE_HREF)) {
    const path = match[1] ?? "";
    if (!path || /login|cadastro|politica|termos/i.test(path)) continue;

    const url = path.startsWith("http")
      ? path
      : `${base.origin}${path.startsWith("/") ? path : `/${path}`}`;

    const id = extractSantanderLotId(url) ?? url;
    if (seen.has(id)) continue;
    seen.add(id);

    const titleMatch = html.match(
      new RegExp(`<a[^>]+href=["'][^"']*${path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}["'][^>]*>([\\s\\S]*?)<\\/a>`, "i"),
    );
    const title = (titleMatch?.[1] ?? "")
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    lots.push({ id, url, title: title || `Veículo ${id}` });
  }

  return lots;
}

export function filterSantanderListLot(
  lot: SantanderListLot,
): { keep: boolean; reason?: string } {
  const blob = `${lot.title} ${lot.url}`;
  if (/\bsinistrad|\bbatido\b|\bsucata\b/i.test(blob)) {
    return { keep: false, reason: "damage_list" };
  }
  const damage = detectDamageSignals(blob);
  if (damage.blocked) {
    return { keep: false, reason: `damage_list:${damage.reasons.join(",")}` };
  }
  return { keep: true };
}

export function buildSantanderListResult(
  html: string,
  baseUrl: string,
): SantanderListResult {
  const skipped: Record<string, number> = {};
  const lots: SantanderListLot[] = [];
  for (const lot of extractSantanderLotsFromHtml(html, baseUrl)) {
    const filter = filterSantanderListLot(lot);
    if (!filter.keep) {
      skipped[filter.reason ?? "skipped"] = (skipped[filter.reason ?? "skipped"] ?? 0) + 1;
      continue;
    }
    lots.push(lot);
  }
  return { lots, meta: { total: lots.length }, skipped };
}

function parseArgs(argv: string[]): { out: string; htmlPath?: string; url?: string } {
  let out = "/tmp/santander-lots.json";
  let htmlPath: string | undefined;
  let url: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--out" && argv[i + 1]) out = argv[++i]!;
    else if (arg === "--html" && argv[i + 1]) htmlPath = argv[++i];
    else if (arg === "--url" && argv[i + 1]) url = argv[++i];
  }
  return { out, htmlPath, url };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.htmlPath) {
    throw new Error(
      "Santander list requires --html from probe capture (site often blocks headless). Run santander-probe.ts first.",
    );
  }
  const { readFileSync } = await import("node:fs");
  const html = readFileSync(assertSafeOutPath(args.htmlPath), "utf8");
  const result = buildSantanderListResult(html, args.url ?? "https://www.santander.com.br/retomados");
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
