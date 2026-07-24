import { notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { SafeBuyCard } from "@/components/domain/safe-buy-card";
import { AuctionDeadlinePanel } from "@/components/domain/auction-deadline-panel";
import { CarDetailTabs } from "@/components/cars/car-detail-tabs";
import { StageSelect } from "@/components/cars/stage-select";
import { getBundle } from "@/lib/aggregate";
import { formatBRL, formatKm } from "@/lib/format";
import { SELLER_TYPE_LABEL } from "@/lib/types";
import { computeLandedCost } from "@/lib/cost/landedCost";

export default async function CarDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bundle = await getBundle(id);
  if (!bundle) notFound();

  const { car } = bundle;
  const landedCostBRL = computeLandedCost({
    askingPriceBRL: car.askingPriceBRL,
    dealPhase: car.dealPhase,
    city: car.city,
    state: car.state,
  }).landedCostBRL;
  const sources =
    car.sources ??
    [{ url: car.sourceUrl, platform: car.sourcePlatform, isPrimary: true, auctionDate: null }];

  return (
    <div className="flex flex-col gap-5">
      <Link
        href="/cars"
        className="inline-flex w-fit cursor-pointer items-center gap-1.5 text-xs text-text-secondary transition-colors duration-200 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden /> Back to all vehicles
      </Link>

      <div className="flex flex-col justify-between gap-3 border-b border-border pb-4 sm:flex-row sm:items-start">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            {car.brand} {car.model} <span className="text-text-muted">{car.trim}</span>
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Badge variant="outline">{car.year}</Badge>
            <Badge variant="outline">{formatKm(car.mileageKm)}</Badge>
            <Badge variant="outline">
              {car.city}/{car.state}
            </Badge>
            <Badge variant="outline">{SELLER_TYPE_LABEL[car.sellerType]}</Badge>
            <StageSelect carId={car.id} stage={car.pipelineStage} />
          </div>
        </div>
        <div className="text-left sm:text-right">
          <div className="text-2xl font-bold tabular-nums tracking-tight text-text-primary">
            {formatBRL(car.askingPriceBRL)}
          </div>
          <div className="text-xs text-text-secondary">
            {car.dealPhase === "pre_repossession"
              ? "Custo efetivo (entrada + saldo)"
              : "Asking price (lance mínimo)"}
          </div>
          {landedCostBRL !== null && landedCostBRL !== car.askingPriceBRL && (
            <div className="mt-1 text-xs font-medium tabular-nums text-text-secondary">
              Custo all-in ≈ {formatBRL(landedCostBRL)}
            </div>
          )}
        </div>
      </div>

      <AuctionDeadlinePanel
        sources={sources}
        notes={car.notes}
        pipelineStage={car.pipelineStage}
        stageReason={car.stageReason}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="order-2 lg:order-1 lg:col-span-2">
          <CarDetailTabs bundle={bundle} />
        </div>
        <div className="order-1 lg:order-2">
          <div className="lg:sticky lg:top-6">
            <SafeBuyCard decision={bundle.decision} />
          </div>
        </div>
      </div>
    </div>
  );
}
