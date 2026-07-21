import { CarsTableView } from "@/components/cars/cars-table-view";
import { FipeSyncAllButton } from "@/components/cars/fipe-sync-all-button";
import { getBundlesPage } from "@/lib/aggregate";
import type { BundlesPageParams } from "@/lib/aggregate";
import type { DealPhase, SourceChannel, LeadConfidence, Verdict } from "@/lib/types";
import {
  DEAL_PHASE_LABEL,
  SOURCE_CHANNEL_LABEL,
  CONFIDENCE_LABEL,
  VERDICT_LABEL,
} from "@/lib/types";

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

  // Allowlist helpers — unknown values become undefined so they are ignored
  // rather than forwarded as unrecognised filter predicates.
  const VALID_PHASES = new Set(Object.keys(DEAL_PHASE_LABEL) as DealPhase[]);
  const VALID_CHANNELS = new Set(Object.keys(SOURCE_CHANNEL_LABEL) as SourceChannel[]);
  const VALID_CONFIDENCES = new Set(Object.keys(CONFIDENCE_LABEL) as LeadConfidence[]);
  const VALID_VERDICTS = new Set(Object.keys(VERDICT_LABEL) as Verdict[]);
  type SortValue = NonNullable<BundlesPageParams["sort"]>;
  const VALID_SORTS = new Set<SortValue>(["score", "price", "year", "mileage", "recent"]);

  const validateEnum = <T extends string>(value: string | undefined, allowed: Set<T>): T | undefined => {
    if (value === undefined) return undefined;
    return allowed.has(value as T) ? (value as T) : undefined;
  };

  const params: BundlesPageParams = {
    page,
    pageSize: 50,
    q: getString("q"),
    brand: getString("brand"),
    stage: getString("stage"),
    phase: validateEnum(getString("phase"), VALID_PHASES),
    sourceChannel: validateEnum(getString("sourceChannel"), VALID_CHANNELS),
    confidence: validateEnum(getString("confidence"), VALID_CONFIDENCES),
    state: getString("state"),
    verdict: validateEnum(getString("verdict"), VALID_VERDICTS),
    priceMin: getFloat("priceMin"),
    priceMax: getFloat("priceMax"),
    belowFipePctMin: getFloat("belowFipePctMin"),
    sort: validateEnum(getString("sort"), VALID_SORTS) ?? "recent",
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
