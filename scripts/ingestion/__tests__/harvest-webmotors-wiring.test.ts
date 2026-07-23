import { describe, expect, it, vi } from "vitest";
import { WM_PACING, WM_ROTATE_EVERY_PAGES } from "../webmotors-list";

const harvestWebmotorsMock = vi.fn().mockResolvedValue({
  source: "Webmotors",
  scanned: 0,
  written: { created: 0, updated: 0, merged: 0 },
  skipped: {},
  errors: [],
  sampleUrls: [],
  durationMs: 0,
  startedAt: new Date().toISOString(),
});

vi.mock("../webmotors-harvest", () => ({
  harvestWebmotors: harvestWebmotorsMock,
}));

describe("runHarvestSource — webmotors wiring", () => {
  it("passes the jittered pacing window and rotation cadence through to harvestWebmotors", async () => {
    const { runHarvestSource } = await import("../harvest");
    await runHarvestSource("webmotors", { dryRun: true });

    expect(harvestWebmotorsMock).toHaveBeenCalledWith(
      expect.objectContaining({
        pacing: WM_PACING,
        rotateEveryPages: WM_ROTATE_EVERY_PAGES,
      }),
    );
  });
});
