import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBradescoLead } from "../bradesco-parse";

const listLot = {
  guid: "cmrkpaxud0000lhgr3ker77az",
  slug: "vw-t-cross-sense-tsi-2022-2022-9_2",
  name: "VOLKSWAGEN - T CROSS SENSE TSI - 2022 / 2022",
  price: 47000,
  category: "Carro",
  description: "Vw, T Cross Sense Tsi, 2022, 2022, Preta, Flex, Km 116406",
};

const detail = JSON.parse(
  readFileSync(
    join(__dirname, "fixtures/bradesco-detail-retomado.json"),
    "utf8",
  ),
);

describe("parseBradescoLead", () => {
  it("parses retomado T-Cross into write input", () => {
    const parsed = parseBradescoLead(listLot, detail);
    expect(parsed.skip).toBeUndefined();
    expect(parsed.input).toMatchObject({
      brand: "Volkswagen",
      model: "T CROSS SENSE TSI",
      year: 2022,
      askingPriceBRL: 47000,
      bodyType: "suv",
      sellerType: "bank_recovery",
      sourcePlatform: "Bradesco Vitrine",
      mileageKm: 116406,
    });
    expect(parsed.input?.sourceUrl).toContain("vw-t-cross-sense-tsi-2022-2022-9_2");
  });

  it("skips damaged detail notes", () => {
    const damaged = {
      ...detail,
      description: "TOYOTA HILUX, Média Monta",
      vehicle_type_of_recovery: "COLISÃO",
    };
    const parsed = parseBradescoLead(listLot, damaged);
    expect(parsed.skip).toBe("damage");
  });

  it("skips sinistrado recovery", () => {
    const parsed = parseBradescoLead(listLot, {
      ...detail,
      vehicle_type_of_recovery: "Sinistrado",
    });
    expect(parsed.skip).toBe("sinistrado_recovery");
  });
});
