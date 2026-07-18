"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import {
  serializeGoalForDb,
  validateGoalInput,
  type GoalFieldErrors,
  type GoalFormInput,
} from "@/lib/goal-form";

export type UpdateGoalResult =
  | { ok: true }
  | { ok: false; errors?: GoalFieldErrors; error?: string };

// Persists edits to the active buying goal. Validation mirrors the client so a
// direct POST cannot bypass it. Revalidates the pipeline so cars re-score.
export async function updateGoal(input: GoalFormInput): Promise<UpdateGoalResult> {
  const result = validateGoalInput(input);
  if (!result.ok) {
    return { ok: false, errors: result.errors };
  }

  try {
    const active = await prisma.buyingGoal.findFirst({ where: { active: true } });
    if (!active) {
      return { ok: false, error: "No active buying goal to update." };
    }

    await prisma.buyingGoal.update({
      where: { id: active.id },
      data: serializeGoalForDb(result.value),
    });
  } catch (e) {
    // Surface DB failures to the client as a friendly message rather than an
    // unhandled rejection inside the caller's transition.
    console.error("updateGoal failed:", e);
    return { ok: false, error: "Could not save the goal. Please try again." };
  }

  revalidatePath("/");
  revalidatePath("/goal");
  return { ok: true };
}
