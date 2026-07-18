import { describe, expect, it } from "vitest";
import { serializeGoalForDb, validateGoalInput, type GoalFormInput } from "../goal-form";

function baseInput(overrides: Partial<GoalFormInput> = {}): GoalFormInput {
  return {
    name: "Primary buy",
    budgetMinBRL: 60_000,
    budgetMaxBRL: 120_000,
    minYear: 2021,
    maxMileageKm: 90_000,
    fuelEconomyThresholdKmL: 10,
    minResaleLiquidityScore: 50,
    familySpaceRequired: false,
    requiredFeatures: ["Câmbio automático"],
    preferredBodyTypes: ["suv"],
    preferredBrands: ["Toyota"],
    excludedBrandsModels: ["Fiat Mobi"],
    ...overrides,
  };
}

describe("validateGoalInput", () => {
  it("accepts a valid input and returns normalized values", () => {
    const result = validateGoalInput(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.name).toBe("Primary buy");
    expect(result.value.budgetMinBRL).toBe(60_000);
    expect(result.value.preferredBrands).toEqual(["Toyota"]);
  });

  it("rejects an empty name", () => {
    const result = validateGoalInput(baseInput({ name: "   " }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.name).toBeTruthy();
  });

  it("rejects a max budget below the min budget", () => {
    const result = validateGoalInput(baseInput({ budgetMinBRL: 100_000, budgetMaxBRL: 50_000 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.budgetMaxBRL).toBeTruthy();
  });

  it("rejects a negative mileage", () => {
    const result = validateGoalInput(baseInput({ maxMileageKm: -5 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.maxMileageKm).toBeTruthy();
  });

  it("rejects a resale liquidity score outside 0-100", () => {
    const result = validateGoalInput(baseInput({ minResaleLiquidityScore: 150 }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.minResaleLiquidityScore).toBeTruthy();
  });

  it("coerces numeric strings from form fields", () => {
    const result = validateGoalInput(baseInput({ budgetMinBRL: "60000", minYear: "2021" }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.budgetMinBRL).toBe(60_000);
    expect(result.value.minYear).toBe(2021);
  });

  it("rejects non-numeric budget input", () => {
    const result = validateGoalInput(baseInput({ budgetMinBRL: "abc" }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.budgetMinBRL).toBeTruthy();
  });

  it("trims, drops empties, and de-duplicates array fields", () => {
    const result = validateGoalInput(
      baseInput({ preferredBrands: [" Toyota ", "Honda", "Toyota", "", "  "] }),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.preferredBrands).toEqual(["Toyota", "Honda"]);
  });

  it("rejects a body type outside the closed set", () => {
    const result = validateGoalInput(baseInput({ preferredBodyTypes: ["spaceship"] }));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.preferredBodyTypes).toBeTruthy();
  });

  it("keeps valid body types typed as BodyType", () => {
    const result = validateGoalInput(baseInput({ preferredBodyTypes: ["suv", "sedan"] }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.preferredBodyTypes).toEqual(["suv", "sedan"]);
  });
});

describe("serializeGoalForDb", () => {
  it("JSON-stringifies the array fields and passes scalars through", () => {
    const result = validateGoalInput(baseInput());
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    const data = serializeGoalForDb(result.value);
    expect(data.name).toBe("Primary buy");
    expect(data.budgetMinBRL).toBe(60_000);
    expect(data.familySpaceRequired).toBe(false);
    expect(JSON.parse(data.preferredBrands)).toEqual(["Toyota"]);
    expect(JSON.parse(data.preferredBodyTypes)).toEqual(["suv"]);
    expect(JSON.parse(data.requiredFeatures)).toEqual(["Câmbio automático"]);
    expect(JSON.parse(data.excludedBrandsModels)).toEqual(["Fiat Mobi"]);
  });
});
