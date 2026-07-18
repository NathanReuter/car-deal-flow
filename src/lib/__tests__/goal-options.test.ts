import { describe, expect, it } from "vitest";
import { BRAND_OPTIONS, BODY_TYPE_OPTIONS, FEATURE_OPTIONS } from "../goal-options";
import type { BodyType } from "../types";

// The full BodyType union — kept in sync with types.ts. If a body type is added
// there, this list must be updated and the selector test below will catch drift.
const ALL_BODY_TYPES: BodyType[] = [
  "hatch",
  "sedan",
  "suv",
  "pickup",
  "minivan",
  "coupe",
  "wagon",
];

describe("goal option lists", () => {
  it("body type options cover the full BodyType union", () => {
    expect([...BODY_TYPE_OPTIONS].sort()).toEqual([...ALL_BODY_TYPES].sort());
  });

  it("brand options are unique", () => {
    expect(new Set(BRAND_OPTIONS).size).toBe(BRAND_OPTIONS.length);
  });

  it("brand options are sorted alphabetically", () => {
    const sorted = [...BRAND_OPTIONS].sort((a, b) => a.localeCompare(b, "pt-BR"));
    expect(BRAND_OPTIONS).toEqual(sorted);
  });

  it("includes the canonical brands the goal seed prefers", () => {
    for (const brand of ["Toyota", "Honda", "BYD", "Volkswagen", "Caoa Chery"]) {
      expect(BRAND_OPTIONS).toContain(brand);
    }
  });

  it("feature options are non-empty and unique", () => {
    expect(FEATURE_OPTIONS.length).toBeGreaterThan(0);
    expect(new Set(FEATURE_OPTIONS).size).toBe(FEATURE_OPTIONS.length);
  });
});
