"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { findFipeValue, FipeError } from "@/lib/integrations/fipe";

export type FipeSyncResult =
  | { ok: true; valueBRL: number; matchedModel: string; referenceMonth: string }
  | { ok: false; error: string };

export async function syncFipeValue(carId: string): Promise<FipeSyncResult> {
  const car = await prisma.car.findUnique({ where: { id: carId } });
  if (!car) return { ok: false, error: "Car not found." };

  try {
    const match = await findFipeValue({ brand: car.brand, model: car.model, year: car.year, modelYear: car.modelYear });
    await prisma.car.update({ where: { id: carId }, data: { fipeValueBRL: match.valueBRL } });
    revalidatePath(`/cars/${carId}`);
    revalidatePath("/");
    return { ok: true, valueBRL: match.valueBRL, matchedModel: match.matchedModel, referenceMonth: match.referenceMonth };
  } catch (e) {
    if (e instanceof FipeError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "Unknown FIPE sync error." };
  }
}
