import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { bidchainToWriteLead, parseBidchainLot } from "../bidchain-parse";

describe("parseBidchainLot", () => {
  it("parses integral VW Gol lot from html fixture", () => {
    const html = readFileSync(
      join(__dirname, "fixtures/bidchain-lot-snippet.html"),
      "utf8",
    );
    const parsed = parseBidchainLot(
      "78224",
      "https://bidchain.com.br/lote/78224/vw-gol",
      html,
    );
    expect(parsed.skipReason).toBeUndefined();
    expect(parsed.brand).toBe("Volkswagen");
    expect(parsed.model).toMatch(/Gol/i);
    expect(parsed.year).toBe(2022);
    expect(parsed.price).toBe(29900);
    expect(parsed.bodyType).toBe("hatch");

    const input = bidchainToWriteLead(parsed);
    expect(input?.askingPriceBRL).toBe(29900);
    expect(input?.sourcePlatform).toBe("BIDchain");
  });

  it("skips sucata in title", () => {
    const parsed = parseBidchainLot(
      "1",
      "https://bidchain.com.br/lote/1/x",
      "<html><h5>VW sucata</h5><title>sucata</title></html>",
    );
    expect(parsed.skipReason).toMatch(/sucata/);
  });
});
