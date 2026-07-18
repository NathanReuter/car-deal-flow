import Link from "next/link";
import { getAllBundles } from "@/lib/aggregate";
import { PipelineView } from "@/components/pipeline/pipeline-view";

export const dynamic = "force-dynamic";

export default async function Home() {
  let bundles;
  try {
    bundles = await getAllBundles();
  } catch (e) {
    // Only the "no active goal" case gets the friendly seed hint; real failures
    // (DB down, corrupt row) must not masquerade as an unconfigured goal.
    if (!(e instanceof Error && e.message.includes("active buying goal"))) throw e;
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold text-text-primary">Car Deal Flow</h1>
        <p className="mt-2 text-sm text-text-muted">
          No active buying goal is configured. Run <code>npm run db:seed</code> to seed one, then reload.
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-[1400px] p-6">
      <header className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-semibold text-text-primary">Car Deal Flow</h1>
          <p className="text-sm text-text-muted">{bundles.length} vehicles in the pipeline.</p>
        </div>
        <Link href="/goal" className="shrink-0 text-sm text-accent hover:underline">
          Edit buying goal →
        </Link>
      </header>
      {bundles.length === 0 ? (
        <p className="text-sm text-text-muted">No vehicles yet. Run a harvest (see the harvest skills) to populate leads.</p>
      ) : (
        <PipelineView bundles={bundles} />
      )}
    </main>
  );
}
