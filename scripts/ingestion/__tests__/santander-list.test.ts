import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSantanderListResult } from "../santander-list";

describe("buildSantanderListResult", () => {
  it("extracts vehicle links and skips sinistrado", () => {
    const html = readFileSync(
      join(__dirname, "fixtures/santander-list-snippet.html"),
      "utf8",
    );
    const result = buildSantanderListResult(
      html,
      "https://www.santander.com.br/retomados",
    );
    expect(result.lots).toHaveLength(2);
    expect(result.skipped.damage_list).toBe(1);
  });
});
