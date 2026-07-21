import { describe, it, expect } from "vitest";
import {
  OLX_QUERIES,
  OLX_REGION_HOSTS,
  buildOlxSearchUrl,
} from "../olx-list";

describe("OLX_QUERIES", () => {
  it("includes all original terms", () => {
    expect(OLX_QUERIES).toContain("repasse financiamento");
    expect(OLX_QUERIES).toContain("assumo financiamento");
    expect(OLX_QUERIES).toContain("passo financiamento");
  });

  it("includes all new terms added in Task 1.1", () => {
    expect(OLX_QUERIES).toContain("transferir financiamento");
    expect(OLX_QUERIES).toContain("veículo já financiado");
    expect(OLX_QUERIES).toContain("quitar e transferir");
    expect(OLX_QUERIES).toContain("aceito repasse");
  });
});

describe("OLX_REGION_HOSTS", () => {
  it("is an array of string subdomain codes", () => {
    expect(Array.isArray(OLX_REGION_HOSTS)).toBe(true);
    expect(OLX_REGION_HOSTS.length).toBeGreaterThan(0);
    for (const host of OLX_REGION_HOSTS) {
      expect(typeof host).toBe("string");
      expect(host.length).toBeGreaterThan(0);
    }
  });

  it("starts with SC (Santa Catarina) first, PR second, RS third — south-first ordering", () => {
    expect(OLX_REGION_HOSTS[0]).toBe("sc");
    expect(OLX_REGION_HOSTS[1]).toBe("pr");
    expect(OLX_REGION_HOSTS[2]).toBe("rs");
  });

  it("includes major regions and www national fallback", () => {
    expect(OLX_REGION_HOSTS).toContain("sp");
    expect(OLX_REGION_HOSTS).toContain("rj");
    expect(OLX_REGION_HOSTS).toContain("mg");
    expect(OLX_REGION_HOSTS).toContain("www");
  });

  it("www national fallback is last", () => {
    expect(OLX_REGION_HOSTS[OLX_REGION_HOSTS.length - 1]).toBe("www");
  });
});

describe("buildOlxSearchUrl", () => {
  it("builds a correct search URL for a regional subdomain", () => {
    const url = buildOlxSearchUrl("sc", "repasse financiamento", 1);
    expect(url).toBe(
      "https://sc.olx.com.br/autos-e-pecas/carros-vans-e-utilitarios?q=repasse%20financiamento",
    );
  });

  it("builds a correct search URL for www (national)", () => {
    const url = buildOlxSearchUrl("www", "assumo financiamento", 1);
    expect(url).toBe(
      "https://www.olx.com.br/autos-e-pecas/carros-vans-e-utilitarios?q=assumo%20financiamento",
    );
  });

  it("appends pagination offset for pages > 1", () => {
    const url = buildOlxSearchUrl("sc", "passo financiamento", 3);
    expect(url).toContain("&o=3");
  });

  it("does not append pagination offset for page 1", () => {
    const url = buildOlxSearchUrl("sc", "passo financiamento", 1);
    expect(url).not.toContain("&o=");
  });

  it("encodes special characters in query (accents)", () => {
    const url = buildOlxSearchUrl("sc", "veículo já financiado", 1);
    expect(url).toContain(encodeURIComponent("veículo já financiado"));
  });
});

describe("cross-region listId dedupe", () => {
  it("deduplicates OlxSearchCards by listId across different sources", async () => {
    // Import dedupeByListId to test the dedupe utility directly.
    const { dedupeByListId } = await import("../olx-list");
    const cards = [
      { url: "https://sc.olx.com.br/...-111222333", listId: "111222333", title: "Onix SC", priceBRL: 30000, postedLabel: "Hoje" },
      { url: "https://pr.olx.com.br/...-111222333", listId: "111222333", title: "Onix PR", priceBRL: 30000, postedLabel: "Hoje" },
      { url: "https://sp.olx.com.br/...-999888777", listId: "999888777", title: "HB20 SP", priceBRL: 25000, postedLabel: "Ontem" },
    ];
    const deduped = dedupeByListId(cards);
    expect(deduped.length).toBe(2);
    const ids = deduped.map((c) => c.listId);
    expect(ids).toContain("111222333");
    expect(ids).toContain("999888777");
    // First occurrence wins (SC, not PR).
    const onix = deduped.find((c) => c.listId === "111222333")!;
    expect(onix.url).toContain("sc.olx.com.br");
  });

  it("returns all cards when there are no duplicates", async () => {
    const { dedupeByListId } = await import("../olx-list");
    const cards = [
      { url: "https://sc.olx.com.br/...-111222333", listId: "111222333", title: "A", priceBRL: null, postedLabel: null },
      { url: "https://pr.olx.com.br/...-444555666", listId: "444555666", title: "B", priceBRL: null, postedLabel: null },
    ];
    expect(dedupeByListId(cards).length).toBe(2);
  });
});
