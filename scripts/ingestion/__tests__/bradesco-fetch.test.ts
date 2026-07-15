import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  fetchBradescoDetail,
  loadBradescoListFile,
  writeBradescoDetails,
} from "../bradesco-fetch";

describe("loadBradescoListFile", () => {
  it("loads lots array from list json", () => {
    const payload = {
      lots: [{ guid: "abc-123", slug: "vw-gol" }],
    };
    expect(loadBradescoListFile(JSON.stringify(payload))).toEqual(payload.lots);
  });
});

describe("writeBradescoDetails", () => {
  const dirs: string[] = [];

  afterEach(() => {
    for (const dir of dirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("skips existing detail files when requested", async () => {
    const dir = mkdtempSync(join(tmpdir(), "bradesco-details-"));
    dirs.push(dir);
    writeFileSync(join(dir, "abc-123.json"), "{}", "utf8");

    const fetchDetail = vi.fn(async (guid: string) => ({ guid, name: "Test" }));

    const result = await writeBradescoDetails({
      lots: [{ guid: "abc-123" }, { guid: "def-456" }],
      outDir: dir,
      skipExisting: true,
      fetchDetail,
      delayMs: 0,
    });

    expect(result.written).toBe(1);
    expect(result.skippedExisting).toBe(1);
    expect(fetchDetail).toHaveBeenCalledTimes(1);
    expect(fetchDetail).toHaveBeenCalledWith("def-456");
  });
});

describe("fetchBradescoDetail", () => {
  it("fetches detail JSON from API", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn(async () =>
      Response.json({ guid: "abc-123", vehicle_type_of_recovery: "Retomado" }),
    ) as typeof fetch;

    try {
      const detail = await fetchBradescoDetail("abc-123");
      expect(detail.guid).toBe("abc-123");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
