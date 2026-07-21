/**
 * Next 16 route-level loading file — automatically wraps page.tsx in a
 * <Suspense> boundary so getBundlesPage can stream in while the skeleton
 * renders immediately.
 *
 * See: node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/loading.md
 */
import { CarsTableSkeleton } from "@/components/cars/cars-table-skeleton";

export default function Loading() {
  return (
    <div className="flex flex-col gap-6">
      {/* Page header placeholder */}
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <div className="h-6 w-36 animate-pulse rounded bg-surface-hover" />
          <div className="mt-2 h-4 w-72 animate-pulse rounded bg-surface-hover" />
        </div>
        <div className="h-9 w-32 animate-pulse rounded bg-surface-hover" />
      </div>
      <CarsTableSkeleton />
    </div>
  );
}
