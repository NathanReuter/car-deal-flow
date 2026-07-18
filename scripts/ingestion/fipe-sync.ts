import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client";
import { findFipeValue, FipeError } from "../../src/lib/integrations/fipe";
import type { FuelType, Transmission } from "../../src/lib/types";

/**
 * Dedupe identical FIPE GETs (brands list, per-brand models, per-model years)
 * so a full pipeline sweep stays inside the parallelum free-tier budget.
 * Returns an uninstall function that restores the previous fetch.
 */
export function installCachedFetch(): () => void {
  const previous = globalThis.fetch;
  const cache = new Map<string, Promise<Response>>();
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const key = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (!cache.has(key)) {
      const entry = previous(input, init).then((r) => r.clone());
      entry.catch(() => cache.delete(key));
      cache.set(key, entry);
    }
    return (await cache.get(key)!).clone();
  }) as typeof fetch;
  return () => {
    globalThis.fetch = previous;
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function syncMissingFipe(prisma: PrismaClient): Promise<{ synced: number; failed: number }> {
  const cars = await prisma.car.findMany({
    where: {
      pipelineStage: { in: ["new_lead", "parked", "researching"] },
      fipeValueBRL: null,
    },
    orderBy: { askingPriceBRL: "asc" },
  });
  console.log(`FIPE sync: ${cars.length} active cars without a value`);

  let synced = 0;
  let failed = 0;
  for (const car of cars) {
    const label = `${car.brand} ${car.model} ${car.modelYear || car.year}`;
    try {
      const match = await findFipeValue({
        brand: car.brand,
        model: car.model,
        trim: car.trim,
        year: car.year,
        modelYear: car.modelYear,
        fuel: car.fuel as FuelType,
        transmission: car.transmission as Transmission,
      });
      await prisma.car.update({ where: { id: car.id }, data: { fipeValueBRL: match.valueBRL } });
      synced += 1;
      console.log(`OK  ${label} → R$${match.valueBRL}`);
    } catch (e) {
      failed += 1;
      const msg = e instanceof FipeError ? e.message : e instanceof Error ? e.message : String(e);
      console.log(`ERR ${label} — ${msg}`);
    }
    await sleep(400);
  }
  console.log(`FIPE sync done: ${synced} synced, ${failed} failed`);
  return { synced, failed };
}

async function main() {
  const uninstall = installCachedFetch();
  const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./dev.db" });
  const prisma = new PrismaClient({ adapter });
  try {
    await syncMissingFipe(prisma);
  } finally {
    uninstall();
    await prisma.$disconnect();
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
