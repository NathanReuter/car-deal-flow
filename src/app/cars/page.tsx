import { CarsTableView } from "@/components/cars/cars-table-view";
import { FipeSyncAllButton } from "@/components/cars/fipe-sync-all-button";
import { getBundlesPage } from "@/lib/aggregate";
import type { BundlesPageParams } from "@/lib/aggregate";
import type { DealPhase, SourceChannel, LeadConfidence, Verdict } from "@/lib/types";

// Force dynamic rendering: reads live DB + URL search params at request time.
export const dynamic = "force-dynamic";

// searchParams is a Promise in Next.js 15+ (v15.0.0-RC breaking change).
// See node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/page.md
export default async function CarsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;

  const getString = (key: string): string | undefined => {
    const v = sp[key];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };

  const getInt = (key: string): number | undefined => {
    const v = getString(key);
    if (v === undefined) return undefined;
    const n = parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
  };

  const getFloat = (key: string): number | undefined => {
    const v = getString(key);
    if (v === undefined) return undefined;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : undefined;
  };

  const page = Math.max(1, getInt("page") ?? 1);

  const params: BundlesPageParams = {
    page,
    pageSize: 50,
    q: getString("q"),
    brand: getString("brand"),
    stage: getString("stage"),
    phase: getString("phase") as DealPhase | undefined,
    sourceChannel: getString("sourceChannel") as SourceChannel | undefined,
    confidence: getString("confidence") as LeadConfidence | undefined,
    state: getString("state"),
    verdict: getString("verdict") as Verdict | undefined,
    priceMin: getFloat("priceMin"),
    priceMax: getFloat("priceMax"),
    belowFipePctMin: getFloat("belowFipePctMin"),
    sort: (getString("sort") as BundlesPageParams["sort"]) ?? "recent",
  };

  const result = await getBundlesPage(params);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-xl font-semibold tracking-tight text-text-primary">All Vehicles</h1>
          <p className="mt-1 text-sm text-text-secondary">
            Filter by price, mileage, brand, stage, or verdict — click a column header to sort.
          </p>
        </div>
        <FipeSyncAllButton />
      </div>
      <CarsTableView
        rows={result.rows}
        total={result.total}
        page={result.page}
        pageSize={result.pageSize}
        facets={result.facets}
        params={params}
      />
    </div>
  );
}
