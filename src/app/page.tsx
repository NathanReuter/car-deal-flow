import { Wallet, ListChecks, XCircle, ShieldAlert, TrendingDown, Car } from "lucide-react";
import { StatCard } from "@/components/domain/stat-card";
import { PriorityReviewPanel } from "@/components/domain/priority-review-panel";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PipelineFunnelChart } from "@/components/charts/pipeline-funnel-chart";
import { VerdictDonutChart } from "@/components/charts/verdict-donut-chart";
import { BrandMixChart } from "@/components/charts/brand-mix-chart";
import { PriceVsFipeChart } from "@/components/charts/price-vs-fipe-chart";
import { MileageHistogramChart } from "@/components/charts/mileage-histogram-chart";
import { getAllBundles } from "@/lib/aggregate";
import { getPriorityReviewItems } from "@/lib/priority";
import { formatBRL, formatPct } from "@/lib/format";
import { ACTIVE_PIPELINE_STAGES, PIPELINE_STAGES, type PipelineStage, type Verdict } from "@/lib/types";
import { isShortlistHighlight } from "@/lib/shortlist";

// Reads live pipeline data at request time; never prerender (no DB at build).
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const bundles = await getAllBundles();

  const activeStages = new Set<string>(ACTIVE_PIPELINE_STAGES);
  const activeBundles = bundles.filter((b) => activeStages.has(b.car.pipelineStage));

  const totalTracked = activeBundles.length;
  const shortlisted = bundles.filter((b) => isShortlistHighlight(b)).length;
  const rejected = bundles.filter((b) => b.car.pipelineStage === "rejected" || b.decision.verdict === "avoid").length;
  const highRisk = bundles.filter((b) => b.decision.severeRiskGate || b.risk.score < 55).length;

  const avgAskingPrice =
    totalTracked > 0 ? activeBundles.reduce((sum, b) => sum + b.car.askingPriceBRL, 0) / totalTracked : 0;
  const premiums = activeBundles
    .map((b) => b.market.premiumOverFairPct)
    .filter((p): p is number => p !== null);
  const avgPremiumPct =
    premiums.length > 0 ? premiums.reduce((sum, p) => sum + p, 0) / premiums.length : null;

  const pipelineCounts = PIPELINE_STAGES.reduce(
    (acc, s) => {
      acc[s.id] = bundles.filter((b) => b.car.pipelineStage === s.id).length;
      return acc;
    },
    {} as Record<PipelineStage, number>,
  );

  const verdictCounts = bundles.reduce(
    (acc, b) => {
      acc[b.decision.verdict] = (acc[b.decision.verdict] ?? 0) + 1;
      return acc;
    },
    {} as Record<Verdict, number>,
  );

  const brandCounts = new Map<string, number>();
  for (const b of bundles) brandCounts.set(b.car.brand, (brandCounts.get(b.car.brand) ?? 0) + 1);
  const brandMix = Array.from(brandCounts, ([brand, count]) => ({ brand, count })).sort((a, b) => b.count - a.count);

  const priceVsFipe = bundles
    .filter((b) => b.market.fipeValueBRL !== null)
    .map((b) => ({
      label: `${b.car.brand} ${b.car.model}`,
      fipe: b.market.fipeValueBRL as number,
      asking: b.market.askingPriceBRL,
    }));

  const mileages = bundles
    .map((b) => b.car.mileageKm)
    .filter((m): m is number => m !== null);

  const priorityItems = getPriorityReviewItems(bundles);

  return (
    <div className="flex flex-col gap-5">
      <header className="flex flex-col gap-1 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-accent">Overview</p>
          <h1 className="mt-0.5 text-2xl font-semibold tracking-tight text-text-primary">Dashboard</h1>
          <p className="mt-1 max-w-2xl text-sm text-text-secondary">
            Vehicles scored against your buying goal — pipeline, risk, and market position at a glance.
          </p>
        </div>
        <div className="mt-3 flex items-center gap-2 text-xs text-text-muted sm:mt-0">
          <Car className="h-3.5 w-3.5 text-accent" aria-hidden />
          <span className="tabular-nums">{totalTracked} tracked</span>
        </div>
      </header>

      <section aria-label="Key metrics" className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <StatCard label="Tracked cars" value={String(totalTracked)} icon={Wallet} tone="info" />
        <StatCard label="Shortlisted" value={String(shortlisted)} icon={ListChecks} tone="success" />
        <StatCard label="Rejected / Avoid" value={String(rejected)} icon={XCircle} tone="danger" />
        <StatCard label="Avg. asking price" value={formatBRL(avgAskingPrice)} icon={Wallet} />
        <StatCard
          label="Avg. vs FIPE"
          value={avgPremiumPct !== null ? formatPct(avgPremiumPct, { signed: true }) : "—"}
          icon={TrendingDown}
          tone={avgPremiumPct === null ? "neutral" : avgPremiumPct <= 0 ? "success" : "warning"}
          sublabel={
            avgPremiumPct === null
              ? "No FIPE values synced yet"
              : avgPremiumPct <= 0
                ? "Below fair market on average"
                : "Above fair market on average"
          }
        />
        <StatCard label="High risk" value={String(highRisk)} icon={ShieldAlert} tone="danger" />
      </section>

      <section aria-label="Pipeline and risk" className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Pipeline distribution</CardTitle>
            <CardDescription>How many vehicles sit at each stage right now.</CardDescription>
          </CardHeader>
          <CardContent>
            <PipelineFunnelChart counts={pipelineCounts} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Verdict mix</CardTitle>
            <CardDescription>Final risk classification across tracked vehicles.</CardDescription>
          </CardHeader>
          <CardContent>
            <VerdictDonutChart counts={verdictCounts} />
          </CardContent>
        </Card>
      </section>

      <section aria-label="Market composition" className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle>Brand mix</CardTitle>
            <CardDescription>Which brands dominate your pipeline.</CardDescription>
          </CardHeader>
          <CardContent>
            <BrandMixChart data={brandMix.slice(0, 10)} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Price vs FIPE</CardTitle>
            <CardDescription>Points below the diagonal are under FIPE.</CardDescription>
          </CardHeader>
          <CardContent>
            <PriceVsFipeChart data={priceVsFipe} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Mileage distribution</CardTitle>
            <CardDescription>Vehicle count by mileage bracket.</CardDescription>
          </CardHeader>
          <CardContent>
            <MileageHistogramChart mileages={mileages} />
          </CardContent>
        </Card>
      </section>

      <PriorityReviewPanel items={priorityItems} />
    </div>
  );
}
