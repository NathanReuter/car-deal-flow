import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseSantanderLot, santanderToWriteLead } from "../santander-parse";

describe("parseSantanderLot", () => {
  it("parses retomado lot from html fixture", () => {
    const html = readFileSync(
      join(__dirname, "fixtures/santander-lot-snippet.html"),
      "utf8",
    );
    const parsed = parseSantanderLot(
      "12345",
      "https://www.santander.com.br/retomados/veiculo/12345/vw-gol",
      html,
    );
    expect(parsed.skipReason).toBeUndefined();
    expect(parsed.brand).toBe("Volkswagen");
    expect(parsed.model).toMatch(/Gol/i);
    expect(parsed.year).toBe(2021);
    expect(parsed.price).toBe(35500);

    const input = santanderToWriteLead(parsed);
    expect(input?.sellerType).toBe("bank_recovery");
    expect(input?.sourcePlatform).toBe("Santander Retomados");
  });

  it("skips sinistrado listings", () => {
    const parsed = parseSantanderLot(
      "9",
      "https://www.santander.com.br/retomados/veiculo/9/x",
      "<html><title>Sinistrado batido</title></html>",
    );
    expect(parsed.skipReason).toMatch(/damage/);
  });
});
