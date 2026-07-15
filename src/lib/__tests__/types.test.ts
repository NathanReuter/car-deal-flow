import { describe, it, expect } from "vitest";
import { ACTIVE_PIPELINE_STAGES, KANBAN_STAGES, PIPELINE_STAGES } from "../types";

describe("PIPELINE_STAGES", () => {
  it("includes an expired stage labeled Expired", () => {
    expect(PIPELINE_STAGES).toContainEqual({ id: "expired", label: "Expired" });
  });
});

describe("ACTIVE_PIPELINE_STAGES", () => {
  it("excludes expired, parked, rejected, and bought", () => {
    expect(ACTIVE_PIPELINE_STAGES).not.toContain("expired");
    expect(ACTIVE_PIPELINE_STAGES).not.toContain("parked");
    expect(ACTIVE_PIPELINE_STAGES).not.toContain("rejected");
    expect(ACTIVE_PIPELINE_STAGES).not.toContain("bought");
  });
});

describe("KANBAN_STAGES", () => {
  it("has every PIPELINE_STAGES entry except expired", () => {
    expect(KANBAN_STAGES.map((s) => s.id)).not.toContain("expired");
    expect(KANBAN_STAGES).toHaveLength(PIPELINE_STAGES.length - 1);
  });
});
