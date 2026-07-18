import { describe, expect, it } from "vitest";
import { planCommands } from "../run-cadence";

describe("planCommands", () => {
  it("on Monday plans olx+vip+bradesco harvests then the shared chain", () => {
    const names = planCommands(new Date(2026, 6, 13)).map((c) => c.name); // Mon
    expect(names).toEqual([
      "harvest:olx",
      "harvest:vip",
      "harvest:bradesco",
      "cleanup",
      "fipe-sync",
      "goal-filter",
      "deal-alert",
    ]);
  });

  it("on Saturday plans only olx plus the chain", () => {
    const names = planCommands(new Date(2026, 6, 18)).map((c) => c.name); // Sat
    expect(names).toEqual(["harvest:olx", "cleanup", "fipe-sync", "goal-filter", "deal-alert"]);
  });

  it("builds harvest args with --source", () => {
    const olx = planCommands(new Date(2026, 6, 18))[0];
    expect(olx.args).toEqual(["scripts/ingestion/harvest.ts", "--source", "olx"]);
  });
});
