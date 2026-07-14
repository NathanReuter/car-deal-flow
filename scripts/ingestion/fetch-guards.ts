/**
 * Shared guards for auction HTML fetch CLIs (BIDchain / Leilões PB / MGL).
 * Host allowlists + safe --out roots only — no page interpretation.
 */
import { resolve, sep } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";

export function normalizeHostname(hostname: string): string {
  return hostname.toLowerCase();
}

export function assertAllowedUrl(
  raw: string,
  allowedHosts: Set<string>,
  label: string,
): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`Only http(s) URLs are allowed (${label})`);
  }
  const host = normalizeHostname(url.hostname);
  if (!allowedHosts.has(host)) {
    throw new Error(`host not allowed for ${label} fetch: ${url.hostname}`);
  }
  return url;
}

/** Re-check after Playwright navigation (redirects / JS location changes). */
export function assertFinalUrlAllowed(
  pageUrl: string,
  allowedHosts: Set<string>,
  label: string,
): void {
  assertAllowedUrl(pageUrl, allowedHosts, label);
}

export function assertHttpOk(
  response: { ok(): boolean; status(): number } | null,
  url: string,
): void {
  if (!response) {
    throw new Error(`No response for ${url}`);
  }
  if (!response.ok() && response.status() !== 304) {
    throw new Error(`HTTP ${response.status()} for ${url}`);
  }
}

export function assertNotCloudflareBlock(html: string, url: string): void {
  if (
    /Attention Required!\s*\|\s*Cloudflare/i.test(html) ||
    /you have been blocked/i.test(html)
  ) {
    throw new Error(
      `Cloudflare blocked automated fetch for ${url}. Open the lot in a normal browser and save HTML, or retry later.`,
    );
  }
}

/**
 * --out must resolve under the OS temp dir, /tmp, or <cwd>/tmp (harvest dumps).
 * Prevents agent/prompt injection from overwriting project secrets.
 */
export function assertSafeOutPath(raw: string): string {
  if (!raw || !raw.trim()) {
    throw new Error("Missing --out path");
  }
  const resolved = resolve(raw);
  const roots = [
    resolve(tmpdir()),
    resolve("/tmp"),
    resolve("/private/tmp"),
    resolve(process.cwd(), "tmp"),
  ];
  const underRoot = roots.some(
    (root) => resolved === root || resolved.startsWith(root + sep),
  );
  if (!underRoot) {
    throw new Error(
      `--out must be under OS temp, /tmp, or ${resolve(process.cwd(), "tmp")} (got: ${raw})`,
    );
  }
  return resolved;
}

export function isCliEntry(metaUrl: string, argv1: string | undefined): boolean {
  if (!argv1) return false;
  try {
    return pathToFileURL(resolve(argv1)).href === metaUrl;
  } catch {
    return false;
  }
}

export function parseUrlAndOptionalOut(argv: string[]): {
  url: string;
  out?: string;
} {
  let url = "";
  let out: string | undefined;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--url") {
      url = argv[++i] ?? "";
      continue;
    }
    if (a === "--out") {
      out = argv[++i];
      continue;
    }
    if (!a.startsWith("-") && !url) {
      url = a;
      continue;
    }
    throw new Error(`Unknown argument: ${a}`);
  }
  if (!url) {
    throw new Error("Missing URL (positional or --url)");
  }
  return { url, out };
}
