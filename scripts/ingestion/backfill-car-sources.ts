import type { PrismaClient } from "../../src/generated/prisma/client";

export interface BackfillCarSourcesSummary {
  created: number;
  skipped: number;
}

/**
 * Ensures every Car has a CarSource row for its primary sourceUrl/platform.
 * Idempotent — safe to re-run.
 */
export async function backfillCarSources(
  prisma: PrismaClient,
): Promise<BackfillCarSourcesSummary> {
  const cars = await prisma.car.findMany({
    select: { id: true, sourceUrl: true, sourcePlatform: true },
  });

  let created = 0;
  let skipped = 0;

  for (const car of cars) {
    const existing = await prisma.carSource.findUnique({
      where: { sourceUrl: car.sourceUrl },
    });
    if (existing) {
      skipped += 1;
      continue;
    }

    await prisma.carSource.create({
      data: {
        carId: car.id,
        sourceUrl: car.sourceUrl,
        sourcePlatform: car.sourcePlatform,
        lastSeenAt: new Date(),
      },
    });
    created += 1;
  }

  return { created, skipped };
}
