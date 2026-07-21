import { describe, expect, it } from "vitest";
import { planCommands } from "../run-cadence";

describe("planCommands", () => {
  it("on Monday plans olx+vip+bradesco+napista+webmotors harvests then the shared chain", () => {
    const names = planCommands(new Date(2026, 6, 13)).map((c) => c.name); // Mon
    expect(names).toEqual([
      "harvest:olx",
      "harvest:vip",
      "harvest:bradesco",
      "harvest:napista",
      "harvest:webmotors",
      "cleanup",
      "fipe-sync",
      "goal-filter",
      "deal-alert",
    ]);
  });

  it("on Saturday plans olx+napista plus the chain", () => {
    const names = planCommands(new Date(2026, 6, 18)).map((c) => c.name); // Sat
    expect(names).toEqual([
      "harvest:olx",
      "harvest:napista",
      "cleanup",
      "fipe-sync",
      "goal-filter",
      "deal-alert",
    ]);
  });

  it("on Tuesday plans olx+mgl+napista+storefronts harvests then the shared chain", () => {
    const names = planCommands(new Date(2026, 6, 14)).map((c) => c.name); // Tue
    expect(names).toEqual([
      "harvest:olx",
      "harvest:mgl",
      "harvest:napista",
      "harvest:storefronts",
      "cleanup",
      "fipe-sync",
      "goal-filter",
      "deal-alert",
    ]);
  });

  it("builds harvest args with --source", () => {
    const olx = planCommands(new Date(2026, 6, 18))[0];
    expect(olx.args).toEqual(["scripts/ingestion/harvest.ts", "--source", "olx"]);
  });
});
