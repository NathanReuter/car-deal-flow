import Link from "next/link";
import { getActiveGoal } from "@/lib/aggregate";
import { GoalEditor } from "@/components/goal/goal-editor";

export const dynamic = "force-dynamic";

export default async function GoalPage() {
  let goal;
  try {
    goal = await getActiveGoal();
  } catch {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold text-text-primary">Buying goal</h1>
        <p className="mt-2 text-sm text-text-muted">
          No active buying goal is configured. Run <code>npm run db:seed</code> to seed one, then reload.
        </p>
        <Link href="/" className="mt-4 inline-block text-sm text-accent hover:underline">
          ← Back to pipeline
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-3xl p-6">
      <header className="mb-6">
        <Link href="/" className="text-sm text-accent hover:underline">
          ← Back to pipeline
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-text-primary">Edit buying goal</h1>
        <p className="text-sm text-text-muted">
          Tune the criteria used to score and filter every car in the pipeline.
        </p>
      </header>
      <GoalEditor goal={goal} />
    </main>
  );
}
