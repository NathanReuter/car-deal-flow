import { describe, it, expect } from "vitest";
import { displaySources } from "../sources";

describe("displaySources", () => {
  it("lists primary first and appends secondary sources", () => {
    const links = displaySources("https://a.example/1", "VIP Leilões", [
      { sourceUrl: "https://a.example/1", sourcePlatform: "VIP Leilões", firstSeenAt: "2026-01-01" },
      { sourceUrl: "https://c.example/3", sourcePlatform: "MGL", firstSeenAt: "2026-01-03" },
      { sourceUrl: "https://b.example/2", sourcePlatform: "BIDchain", firstSeenAt: "2026-01-02" },
    ]);

    expect(links).toEqual([
      { url: "https://a.example/1", platform: "VIP Leilões", isPrimary: true, auctionDate: null },
      { url: "https://b.example/2", platform: "BIDchain", isPrimary: false, auctionDate: null },
      { url: "https://c.example/3", platform: "MGL", isPrimary: false, auctionDate: null },
    ]);
  });

  it("still shows primary when sources array is empty", () => {
    expect(displaySources("https://a.example/1", "MGL", [])).toEqual([
      { url: "https://a.example/1", platform: "MGL", isPrimary: true, auctionDate: null },
    ]);
  });
});
