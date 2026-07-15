import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  filterBradescoListLot,
  parseBradescoListResponse,
} from "../bradesco-list";

const fixture = JSON.parse(
  readFileSync(join(__dirname, "fixtures/bradesco-list-page.json"), "utf8"),
);

describe("parseBradescoListResponse", () => {
  it("parses API page payload", () => {
    const parsed = parseBradescoListResponse(fixture);
    expect(parsed.totalPages).toBe(2);
    expect(parsed.totalAuctions).toBe(3);
    expect(parsed.lots).toHaveLength(3);
    expect(parsed.lots[0]?.guid).toBe("aaa-111");
  });
});

describe("filterBradescoListLot", () => {
  it("keeps integral car listings", () => {
    const lot = parsedLot("aaa-111");
    expect(filterBradescoListLot(lot)).toEqual({ keep: true });
  });

  it("skips non-car categories", () => {
    const lot = parsedLot("bbb-222");
    expect(filterBradescoListLot(lot)).toEqual({
      keep: false,
      reason: "non_car_category:Moto",
    });
  });

  it("skips sinistrado recovery listings", () => {
    const lot = parsedLot("ccc-333");
    expect(filterBradescoListLot(lot)).toEqual({
      keep: false,
      reason: "sinistrado_recovery",
    });
  });

  it("skips damaged descriptions at list level", () => {
    const lot = {
      ...parsedLot("aaa-111"),
      description: "TOYOTA HILUX, Média Monta",
      vehicle_type_of_recovery: "Retomado",
    };
    expect(filterBradescoListLot(lot)).toEqual({
      keep: false,
      reason: "damage_list:média monta",
    });
  });
});

function parsedLot(guid: string) {
  const parsed = parseBradescoListResponse(fixture);
  const lot = parsed.lots.find((row) => row.guid === guid);
  if (!lot) throw new Error(`missing fixture lot ${guid}`);
  return lot;
}
