import { describe, expect, it } from "vitest";
import { sourcesDueOn } from "../lib/cadence-schedule";

describe("sourcesDueOn", () => {
  it("runs olx every day", () => {
    for (let day = 13; day <= 19; day++) {
      // 2026-07-13 is a Monday
      expect(sourcesDueOn(new Date(2026, 6, day))).toContain("olx");
    }
  });

  it("runs vip on Mon/Wed/Fri only", () => {
    expect(sourcesDueOn(new Date(2026, 6, 13))).toContain("vip"); // Mon
    expect(sourcesDueOn(new Date(2026, 6, 15))).toContain("vip"); // Wed
    expect(sourcesDueOn(new Date(2026, 6, 17))).toContain("vip"); // Fri
    expect(sourcesDueOn(new Date(2026, 6, 14))).not.toContain("vip"); // Tue
    expect(sourcesDueOn(new Date(2026, 6, 18))).not.toContain("vip"); // Sat
  });

  it("runs mgl on Tue/Thu and bradesco on Mon", () => {
    expect(sourcesDueOn(new Date(2026, 6, 14))).toContain("mgl"); // Tue
    expect(sourcesDueOn(new Date(2026, 6, 16))).toContain("mgl"); // Thu
    expect(sourcesDueOn(new Date(2026, 6, 13))).not.toContain("mgl"); // Mon
    expect(sourcesDueOn(new Date(2026, 6, 13))).toContain("bradesco"); // Mon
    expect(sourcesDueOn(new Date(2026, 6, 15))).not.toContain("bradesco"); // Wed
  });

  it("never schedules paused sources", () => {
    for (let day = 13; day <= 19; day++) {
      const due = sourcesDueOn(new Date(2026, 6, day)) as string[];
      expect(due).not.toContain("santander");
      expect(due).not.toContain("bidchain");
    }
  });
});
