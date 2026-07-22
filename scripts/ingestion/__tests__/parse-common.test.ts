import { describe, expect, it } from "vitest";
import {
  guessBodyTypeByModel,
  inferBodyType,
  normalizeBrand,
  parseBrl,
  parseKm,
  parseYearFromText,
} from "../lib/parse-common";

describe("parseBrl", () => {
  it("parses Brazilian currency with thousands separator", () => {
    expect(parseBrl("R$ 47.900,00")).toBe(47900);
  });

  it("returns null for empty input", () => {
    expect(parseBrl("")).toBeNull();
  });
});

describe("parseKm", () => {
  it("parses km with dot thousands separator", () => {
    expect(parseKm("116.406 km")).toBe(116406);
  });

  it("returns null when not disclosed", () => {
    expect(parseKm("não informado")).toBeNull();
  });
});

describe("parseYearFromText", () => {
  it("parses year/modelYear pair", () => {
    expect(parseYearFromText("2022/2023")).toEqual({ year: 2022, modelYear: 2023 });
  });

  it("parses single year", () => {
    expect(parseYearFromText("Toyota RAV4 2020")).toEqual({ year: 2020 });
  });
});

describe("normalizeBrand", () => {
  it("normalizes VW alias", () => {
    expect(normalizeBrand("VW")).toBe("Volkswagen");
  });

  it("preserves already-normalized brand", () => {
    expect(normalizeBrand("Toyota")).toBe("Toyota");
  });

  it("normalizes GWM/Haval casing variants to a single canonical brand", () => {
    expect(normalizeBrand("Gwm")).toBe("GWM");
    expect(normalizeBrand("GWM")).toBe("GWM");
    expect(normalizeBrand("Haval")).toBe("GWM");
    expect(normalizeBrand("gwm")).toBe("GWM");
  });
});

describe("inferBodyType", () => {
  it("classifies T-Cross as suv", () => {
    expect(inferBodyType("Volkswagen", "T-Cross", "")).toBe("suv");
  });

  it("classifies Gol as hatch", () => {
    expect(inferBodyType("Volkswagen", "Gol", "")).toBe("hatch");
  });

  it("returns null for unknown model", () => {
    expect(inferBodyType("Unknown", "Mystery", "")).toBeNull();
  });

  it("returns null for non-car keywords", () => {
    expect(inferBodyType("Honda", "CG 160", "motocicleta")).toBeNull();
  });
});

describe("guessBodyTypeByModel", () => {
  it("classifies a Tiggo SUV as suv", () => {
    expect(guessBodyTypeByModel("CAOA CHERY TIGGO 5X")).toBe("suv");
  });

  // BIDchain passes "<brand> <model>", and the brand is now "Caoa Chery". The
  // brand string must not force an SUV verdict over a specific sedan match.
  it("classifies a Caoa Chery Arrizo as sedan, not suv", () => {
    expect(guessBodyTypeByModel("CAOA CHERY ARRIZO 6")).toBe("sedan");
  });
});
