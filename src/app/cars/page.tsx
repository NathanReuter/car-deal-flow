import { CarsTableView } from "@/components/cars/cars-table-view";
import { FipeSyncAllButton } from "@/components/cars/fipe-sync-all-button";
import { getAllBundles } from "@/lib/aggregate";

// Reads live pipeline data at request time; never prerender (no DB at build).
export const dynamic = "force-dynamic";

export default async function CarsPage() {
  const bundles = await getAllBundles();

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
