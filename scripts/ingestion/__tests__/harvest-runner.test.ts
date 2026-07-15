import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WriteLeadInput } from "../write-lead";
import {
  bumpSkip,
  createHarvestSummary,
  DEFAULT_CEILING,
  hasReachedCeiling,
  parseWriteLeadOutput,
  spawnWriteLead,
  totalWritten,
  writeSummary,
} from "../lib/harvest-runner";

describe("createHarvestSummary", () => {
  it("initializes empty counters", () => {
    const summary = createHarvestSummary("Bradesco Vitrine");
    expect(summary.source).toBe("Bradesco Vitrine");
    expect(summary.scanned).toBe(0);
    expect(summary.written).toEqual({ created: 0, updated: 0, merged: 0 });
    expect(summary.skipped).toEqual({});
    expect(summary.errors).toEqual([]);
  });
});

describe("hasReachedCeiling", () => {
  it("returns false below ceiling", () => {
    const summary = createHarvestSummary("MGL");
    summary.written.created = 999;
    expect(hasReachedCeiling(summary, DEFAULT_CEILING)).toBe(false);
  });

  it("returns true at ceiling", () => {
    const summary = createHarvestSummary("MGL");
    summary.written.created = 1000;
    expect(hasReachedCeiling(summary, DEFAULT_CEILING)).toBe(true);
  });
});

describe("bumpSkip and totalWritten", () => {
  it("tracks skip reasons and write totals", () => {
    const summary = createHarvestSummary("VIP Leilões");
    bumpSkip(summary, "damage");
    bumpSkip(summary, "damage");
    summary.written.created = 2;
    summary.written.merged = 1;

    expect(summary.skipped.damage).toBe(2);
    expect(totalWritten(summary)).toBe(3);
  });
});

describe("parseWriteLeadOutput", () => {
  it("parses merged action from stdout tail", () => {
    const parsed = parseWriteLeadOutput('{"action":"merged","carId":"abc"}');
    expect(parsed.merged).toBe(true);
  });

  it("parses created action from stdout tail", () => {
    const parsed = parseWriteLeadOutput('log line\n{"created":true,"carId":"abc"}');
    expect(parsed.created).toBe(true);
  });
});

describe("writeSummary", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("writes JSON summary under tmp", () => {
    const dir = mkdtempSync(join(tmpdir(), "harvest-summary-"));
    dirs.push(dir);
    const outPath = join(dir, "summary.json");
    const summary = createHarvestSummary("BIDchain");
    summary.scanned = 5;
    bumpSkip(summary, "damage");

    writeSummary(outPath, summary);

    expect(existsSync(outPath)).toBe(true);
    const saved = JSON.parse(readFileSync(outPath, "utf8"));
    expect(saved.source).toBe("BIDchain");
    expect(saved.skipped.damage).toBe(1);
    expect(typeof saved.durationMs).toBe("number");
  });
});

describe("spawnWriteLead", () => {
  it("returns ok:false when write-lead rejects missing fields", () => {
    const input = {
      brand: "",
      model: "",
      year: 0,
      askingPriceBRL: 0,
      sourceUrl: "",
      sourcePlatform: "Test",
      sellerType: "auction",
      bodyType: "hatch",
    } satisfies WriteLeadInput;

    const result = spawnWriteLead(input);
    expect(result.ok).toBe(false);
    expect(result.error).toBeTruthy();
  });
});
