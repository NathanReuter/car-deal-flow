"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/types";

export async function updateCarStage(carId: string, stage: PipelineStage): Promise<void> {
  if (!PIPELINE_STAGES.some((s) => s.id === stage)) {
    throw new Error(`Unknown pipeline stage: ${stage}`);
  }
  await prisma.car.update({ where: { id: carId }, data: { pipelineStage: stage } });
  revalidatePath("/");
  revalidatePath(`/cars/${carId}`);
}
