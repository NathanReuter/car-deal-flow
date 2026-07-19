"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { findFipeValue, FipeError } from "@/lib/integrations/fipe";
import type { FuelType, Transmission } from "@/lib/types";
import type { Car as DbCar } from "@/generated/prisma/client";

export type FipeSyncResult =
  | {
      ok: true;
      carId: string;
      label: string;
      valueBRL: number;
      previousValueBRL?: number;
      matchedModel: string;
      referenceMonth: string;
    }
  | { ok: false; carId?: string; label?: string; error: string };

async function syncOne(car: DbCar): Promise<FipeSyncResult> {
  const label = `${car.brand} ${car.model}`;
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
    return {
      ok: true,
      carId: car.id,
      label,
      valueBRL: match.valueBRL,
      previousValueBRL: car.fipeValueBRL ?? undefined,
      matchedModel: match.matchedModel,
      referenceMonth: match.referenceMonth,
    };
  } catch (e) {
    if (e instanceof FipeError) return { ok: false, carId: car.id, label, error: e.message };
    return {
      ok: false,
      carId: car.id,
      label,
      error: e instanceof Error ? e.message : "Unknown FIPE sync error.",
    };
  }
}

export async function syncFipeValue(carId: string): Promise<FipeSyncResult> {
  const car = await prisma.car.findUnique({ where: { id: carId } });
  if (!car) return { ok: false, error: "Car not found." };

  const result = await syncOne(car);
  revalidatePath(`/cars/${carId}`);
  revalidatePath("/");
  return result;
}

export async function syncAllFipeValues(): Promise<FipeSyncResult[]> {
  const cars = await prisma.car.findMany();

  // Sequential — stays under FIPE free-tier rate limits and keeps per-car errors clear.
  const results: FipeSyncResult[] = [];
  for (const car of cars) {
    results.push(await syncOne(car));
  }

  revalidatePath("/", "layout");
  return results;
}
