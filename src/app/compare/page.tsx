import { CompareView } from "@/components/compare/compare-view";
import { getAllBundles } from "@/lib/aggregate";

// Reads live pipeline data at request time; never prerender (no DB at build).
export const dynamic = "force-dynamic";

export default async function ComparePage() {
  const bundles = await getAllBundles();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">Compare Vehicles</h1>
        <p className="mt-1 text-sm text-text-muted">Compare up to 4 vehicles side by side.</p>
      </div>
      <CompareView bundles={bundles} />
    </div>
  );
}
