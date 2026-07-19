import { ReportGenerator } from "@/components/reports/report-generator";
import { getAllBundles } from "@/lib/aggregate";

// Reads live pipeline data at request time; never prerender (no DB at build).
export const dynamic = "force-dynamic";

export default async function ReportsPage() {
  const bundles = await getAllBundles();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">Reports</h1>
        <p className="mt-1 text-sm text-text-muted">Turn any vehicle or shortlist into an email-ready summary.</p>
      </div>
      <ReportGenerator bundles={bundles} />
    </div>
  );
}
