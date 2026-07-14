import { describe, it, expect } from "vitest";
import { displaySources } from "../sources";

describe("displaySources", () => {
  it("lists primary first and appends secondary sources", () => {
    const links = displaySources("https://a.example/1", "VIP Leilões", [
      { sourceUrl: "https://a.example/1", sourcePlatform: "VIP Leilões" },
      { sourceUrl: "https://b.example/2", sourcePlatform: "BIDchain" },
    ]);

    expect(links).toEqual([
      { url: "https://a.example/1", platform: "VIP Leilões", isPrimary: true },
      { url: "https://b.example/2", platform: "BIDchain", isPrimary: false },
    ]);
  });

  it("still shows primary when sources array is empty", () => {
    expect(displaySources("https://a.example/1", "MGL", [])).toEqual([
      { url: "https://a.example/1", platform: "MGL", isPrimary: true },
    ]);
  });
});
