import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { assertSafeOutPath } from "../fetch-guards";
import type { WriteLeadInput, WriteLeadResult } from "../write-lead";

export const DEFAULT_CEILING = 1000;
/** Delay between lot fetches to reduce Cloudflare / rate-limit blocks. */
export const FETCH_DELAY_MS = 300;

export function throttleFetch(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, FETCH_DELAY_MS));
}

export type HarvestSummary = {
  source: string;
  scanned: number;
  written: { created: number; updated: number; merged: number };
  skipped: Record<string, number>;
  errors: Array<{ url: string; error: string }>;
  sampleUrls: string[];
  durationMs: number;
  startedAt: string;
};

export function createHarvestSummary(source: string): HarvestSummary {
  return {
    source,
    scanned: 0,
    written: { created: 0, updated: 0, merged: 0 },
    skipped: {},
    errors: [],
    sampleUrls: [],
    durationMs: 0,
    startedAt: new Date().toISOString(),
  };
}

export function bumpSkip(summary: HarvestSummary, reason: string): void {
  summary.skipped[reason] = (summary.skipped[reason] ?? 0) + 1;
}

export function totalWritten(summary: HarvestSummary): number {
  return summary.written.created + summary.written.updated + summary.written.merged;
}

export function hasReachedCeiling(summary: HarvestSummary, ceiling: number): boolean {
  return totalWritten(summary) >= ceiling;
}

export function writeSummary(outPath: string, summary: HarvestSummary): void {
  const safePath = assertSafeOutPath(outPath);
  const payload = {
    ...summary,
    durationMs: summary.durationMs || Date.now() - Date.parse(summary.startedAt),
  };
  writeFileSync(safePath, JSON.stringify(payload, null, 2), "utf8");
}

export type ParsedWriteLeadOutput = {
  created?: boolean;
  updated?: boolean;
  merged?: boolean;
  action?: string;
  carId?: string;
};

export function parseWriteLeadOutput(stdout: string): ParsedWriteLeadOutput {
  const lines = stdout.trim().split("\n").filter(Boolean);
  const tail = lines[lines.length - 1] ?? "{}";
  try {
    const parsed = JSON.parse(tail) as ParsedWriteLeadOutput;
    if (parsed.action === "merged") parsed.merged = true;
    if (parsed.action === "updated") parsed.updated = true;
    if (parsed.action === "created") parsed.created = true;
    return parsed;
  } catch {
    return {};
  }
}

export function recordWriteResult(summary: HarvestSummary, parsed: ParsedWriteLeadOutput): void {
  if (parsed.merged || parsed.action === "merged") {
    summary.written.merged++;
    return;
  }
  if (parsed.updated || parsed.created === false) {
    summary.written.updated++;
    return;
  }
  summary.written.created++;
}

function buildWriteLeadArgs(input: WriteLeadInput): string[] {
  const args = [
    "scripts/ingestion/write-lead.ts",
    "--brand",
    input.brand,
    "--model",
    input.model,
    "--year",
    String(input.year),
    ...(input.askingPriceBRL !== undefined ? ["--price", String(input.askingPriceBRL)] : []),
    "--source-url",
    input.sourceUrl,
    "--source-platform",
    input.sourcePlatform,
    "--seller-type",
    input.sellerType,
    "--body-type",
    input.bodyType,
  ];

  if (input.dealPhase) args.push("--deal-phase", input.dealPhase);
  const pushOptNum = (flag: string, value: number | null | undefined) => {
    if (value === null) args.push(flag, "null");
    else if (value !== undefined) args.push(flag, String(value));
  };
  pushOptNum("--entry-ask", input.entryAskBRL);
  pushOptNum("--outstanding-debt", input.outstandingDebtBRL);
  pushOptNum("--installment", input.installmentBRL);
  pushOptNum("--installments-remaining", input.installmentsRemaining);
  if (input.sellerContact) args.push("--seller-contact", input.sellerContact);
  if (input.repasseUrgency) args.push("--repasse-urgency", input.repasseUrgency);
  if (input.trim) args.push("--trim", input.trim);
  if (input.mileageKm === null) args.push("--mileage", "null");
  else if (input.mileageKm !== undefined) args.push("--mileage", String(input.mileageKm));
  if (input.plate) args.push("--plate", input.plate);
  if (input.chassis) args.push("--chassis", input.chassis);
  if (input.city) args.push("--city", input.city);
  if (input.state) args.push("--state", input.state);
  if (input.notes) args.push("--notes", input.notes);
  if (input.editalUrl) args.push("--edital-url", input.editalUrl);
  if (input.forceDamaged) args.push("--force-damaged");

  return args;
}

export function spawnWriteLead(
  input: WriteLeadInput,
  options?: { cwd?: string },
): { ok: boolean; error?: string; result?: WriteLeadResult & ParsedWriteLeadOutput } {
  const cwd = options?.cwd ?? process.cwd();
  const result = spawnSync("./node_modules/.bin/tsx", buildWriteLeadArgs(input), {
    encoding: "utf8",
    cwd,
  });

  if (result.status !== 0) {
    const error = (result.stderr || result.stdout || "write-lead failed").trim().slice(0, 400);
    return { ok: false, error };
  }

  const parsed = parseWriteLeadOutput(result.stdout || "");
  return {
    ok: true,
    result: parsed as WriteLeadResult & ParsedWriteLeadOutput,
  };
}

export async function runWithCeiling(
  ceiling: number,
  run: (ctx: {
    canWrite: () => boolean;
    onWritten: (parsed: ParsedWriteLeadOutput) => void;
    onError: (url: string, error: string) => void;
    onSkip: (reason: string) => void;
  }) => Promise<void>,
  summary: HarvestSummary,
): Promise<void> {
  const started = Date.now();
  await run({
    canWrite: () => !hasReachedCeiling(summary, ceiling),
    onWritten: (parsed) => recordWriteResult(summary, parsed),
    onError: (url, error) => summary.errors.push({ url, error }),
    onSkip: (reason) => bumpSkip(summary, reason),
  });
  summary.durationMs = Date.now() - started;
}

export function defaultSummaryPath(source: string): string {
  const slug = source.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return resolve(process.cwd(), "tmp", `${slug}-harvest-summary.json`);
}
