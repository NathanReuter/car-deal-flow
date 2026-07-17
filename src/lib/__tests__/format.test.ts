import { describe, it, expect } from "vitest";
import { formatBRL, formatKm, formatFipe, formatPct } from "@/lib/format";

describe("format", () => {
  it("formats BRL with no decimals", () => {
    expect(formatBRL(60000)).toMatch(/R\$\s?60\.000/);
  });
  it("formats km, em-dash on null", () => {
    expect(formatKm(90000)).toMatch(/90\.000\s?km/);
    expect(formatKm(null)).toBe("—");
  });
  it("formatFipe shows Not synced on null", () => {
    expect(formatFipe(null)).toBe("Not synced");
    expect(formatFipe(50000)).toMatch(/R\$\s?50\.000/);
  });
  it("formatPct signs positive when requested", () => {
    expect(formatPct(7.4, { signed: true })).toBe("+7.4%");
    expect(formatPct(-3, { signed: true })).toBe("-3.0%");
    expect(formatPct(7.4)).toBe("7.4%");
  });
});
