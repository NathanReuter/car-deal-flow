/**
 * Skeleton placeholder for the cars table while getBundlesPage resolves.
 * Used by src/app/cars/loading.tsx (Next 16 route-level loading convention).
 */
export function CarsTableSkeleton() {
  const rows = Array.from({ length: 8 });
  return (
    <div className="flex flex-col gap-4" aria-busy="true" aria-label="Loading vehicles...">
      {/* Filter row skeleton */}
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 5 }).map((_, i) => (
          <div
            key={i}
            className="h-9 animate-pulse rounded-md bg-surface-hover"
            style={{ width: i === 0 ? "16rem" : "9rem" }}
          />
        ))}
      </div>

      {/* Mobile card skeletons (hidden sm+) */}
      <div className="flex flex-col gap-3 sm:hidden">
        {rows.map((_, i) => (
          <div key={i} className="flex flex-col gap-2 rounded-lg border border-border bg-surface-card p-3">
            <div className="h-4 w-3/5 animate-pulse rounded bg-surface-hover" />
            <div className="h-3 w-2/5 animate-pulse rounded bg-surface-hover" />
            <div className="h-3 w-1/3 animate-pulse rounded bg-surface-hover" />
          </div>
        ))}
      </div>

      {/* Desktop table skeleton (hidden <sm) */}
      <div className="hidden sm:block w-full overflow-x-auto rounded-lg border border-border">
        <table className="w-full text-sm">
          <thead className="border-b border-border bg-surface-hover">
            <tr>
              {["Vehicle", "Year", "KM", "Price", "FIPE Δ", "Location", "Phase", "Seller", "Stage", "Verdict", "Score"].map((h) => (
                <th key={h} className="px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-muted">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((_, i) => (
              <tr key={i} className="hover:bg-surface-hover">
                <td className="px-3 py-2.5">
                  <div className="h-4 w-32 animate-pulse rounded bg-surface-hover" />
                  <div className="mt-1 h-3 w-20 animate-pulse rounded bg-surface-hover" />
                </td>
                {Array.from({ length: 10 }).map((__, j) => (
                  <td key={j} className="px-3 py-2.5">
                    <div className="h-4 w-16 animate-pulse rounded bg-surface-hover" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pager skeleton */}
      <div className="flex items-center justify-between">
        <div className="h-4 w-24 animate-pulse rounded bg-surface-hover" />
        <div className="flex gap-3">
          <div className="h-7 w-12 animate-pulse rounded bg-surface-hover" />
          <div className="h-4 w-20 animate-pulse rounded bg-surface-hover" />
          <div className="h-7 w-12 animate-pulse rounded bg-surface-hover" />
        </div>
      </div>
    </div>
  );
}
