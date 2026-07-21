import { CarsTableView } from "@/components/cars/cars-table-view";
import { FipeSyncAllButton } from "@/components/cars/fipe-sync-all-button";
import { getAllBundles } from "@/lib/aggregate";

// Reads live pipeline data at request time; never prerender (no DB at build).
export const dynamic = "force-dynamic";

export default async function CarsPage() {
  // P2 stopgap: cap at 500 newest rows so this page survives a 50k-row DB.
  // Real fix (server-side pagination + virtualised table) is tracked in
  // docs/ui-cars-view-scaling-plan.md. The other 4 getAllBundles() callers
  // (page.tsx, shortlist, pipeline, compare) share this cliff and are covered
  // by that plan — do NOT add a limit there without reading it first.
  const bundles = await getAllBundles({ limit: 500 });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">All Vehicles</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Filter by price, mileage, brand, stage, or verdict — click Price or KM to sort.
          </p>
        </div>
        <FipeSyncAllButton />
      </div>
      <CarsTableView bundles={bundles} />
    </div>
  );
}
