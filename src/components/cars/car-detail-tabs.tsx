"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { CheckStatusBadge } from "@/components/domain/check-status-badge";
import { formatBRL, formatDate, formatFipe, formatKm, formatPct } from "@/lib/format";
import { RISK_CHECK_LABEL } from "@/lib/types";
import type { CarBundle } from "@/lib/aggregate";
import { syncFipeValue, type FipeSyncResult } from "@/lib/actions/fipe-sync";
import { CheckCircle2, ExternalLink, RefreshCw, XCircle } from "lucide-react";

const RATING_LABEL: Record<string, { label: string; variant: "success" | "warning" | "danger" | "neutral" }> = {
  good: { label: "Good", variant: "success" },
  fair: { label: "Fair", variant: "warning" },
  poor: { label: "Poor", variant: "danger" },
  not_inspected: { label: "Not inspected", variant: "neutral" },
};

export function CarDetailTabs({ bundle }: { bundle: CarBundle }) {
  const { car, goalMatch, risk, condition, market } = bundle;
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [syncResult, setSyncResult] = useState<FipeSyncResult | null>(null);

  function handleSync() {
    startTransition(async () => {
      const result = await syncFipeValue(car.id);
      setSyncResult(result);
      if (result.ok) router.refresh();
    });
  }

  return (
    <Tabs defaultValue="overview">
      <TabsList className="flex-wrap">
        <TabsTrigger value="overview">Overview</TabsTrigger>
        <TabsTrigger value="goal">Goal Fit</TabsTrigger>
        <TabsTrigger value="risk">Documentation &amp; Risk</TabsTrigger>
        <TabsTrigger value="condition">Condition</TabsTrigger>
        <TabsTrigger value="market">Market</TabsTrigger>
        <TabsTrigger value="attachments">Attachments</TabsTrigger>
      </TabsList>

      <TabsContent value="overview">
        <Card>
          <CardContent className="grid grid-cols-1 gap-x-8 gap-y-3 pt-5 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Brand / Model" value={`${car.brand} ${car.model}`} />
            <Field label="Trim / Version" value={car.trim} />
            <Field label="Year / Model year" value={`${car.year} / ${car.modelYear}`} />
            <Field label="Mileage" value={formatKm(car.mileageKm)} />
            <Field label="Asking price" value={formatBRL(car.askingPriceBRL)} />
            <Field label="Location" value={`${car.city}/${car.state}`} />
            <Field label="Fuel" value={car.fuel} />
            <Field label="Transmission" value={car.transmission.replaceAll("_", " ")} />
            <Field label="Body type" value={car.bodyType} />
            <Field label="Color" value={car.color} />
            <Field label="Plate" value={car.plate ?? "—"} />
            <Field label="Chassis" value={car.chassis ?? "—"} />
            <div className="sm:col-span-2 lg:col-span-3">
              <span className="text-xs font-medium text-text-muted">Sources</span>
              <ul className="mt-1 flex flex-col gap-1">
                {(car.sources ?? [{ url: car.sourceUrl, platform: car.sourcePlatform, isPrimary: true }]).map((s) => (
                  <li key={s.url}>
                    <a
                      href={s.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-sm text-accent hover:underline"
                    >
                      {s.platform}
                      {s.isPrimary ? (
                        <span className="text-xs text-text-muted">(primary)</span>
                      ) : null}
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </li>
                ))}
              </ul>
            </div>
            <div className="sm:col-span-2 lg:col-span-3">
              <span className="text-xs font-medium text-text-muted">Notes</span>
              <p className="mt-1 text-sm text-text-secondary">{car.notes}</p>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="goal">
        <Card>
          <CardHeader>
            <CardTitle>Match score: {goalMatch.score}/100</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-sm text-text-secondary">{goalMatch.explanation}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--success)]">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Matched criteria
                </h4>
                <ul className="space-y-1.5 text-sm text-text-secondary">
                  {goalMatch.matchedCriteria.length === 0 && <li className="text-text-muted">None</li>}
                  {goalMatch.matchedCriteria.map((c) => <li key={c}>• {c}</li>)}
                </ul>
              </div>
              <div>
                <h4 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-[var(--danger)]">
                  <XCircle className="h-3.5 w-3.5" /> Failed criteria
                </h4>
                <ul className="space-y-1.5 text-sm text-text-secondary">
                  {goalMatch.failedCriteria.length === 0 && <li className="text-text-muted">None</li>}
                  {goalMatch.failedCriteria.map((c) => <li key={c}>• {c}</li>)}
                </ul>
              </div>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="risk">
        <div className="flex flex-col gap-4">
          <Card>
            <CardHeader>
              <CardTitle>Documentation &amp; risk checklist — score {risk.score}/100</CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="divide-y divide-border">
                {risk.items.map((item) => (
                  <li key={item.key} className="flex flex-col gap-1 py-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-medium text-text-primary">{RISK_CHECK_LABEL[item.key]}</span>
                        <Badge variant="outline" className="text-[0.65rem] uppercase">{item.severity}</Badge>
                      </div>
                      <p className="mt-0.5 text-xs text-text-muted">{item.notes}</p>
                      {item.evidenceUrl && (
                        <a href={item.evidenceUrl} className="mt-1 inline-flex items-center gap-1 text-xs text-accent hover:underline">
                          View evidence <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                      {item.checkedBy === "agent" && item.checkedAt && (
                        <p className="mt-1 text-[0.65rem] text-text-muted">
                          Checked by agent on {formatDate(item.checkedAt)}
                        </p>
                      )}
                    </div>
                    <CheckStatusBadge status={item.status} />
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>

          {risk.caixaReview.applicable && (
            <Card className="border-[var(--warning)]/40">
              <CardHeader>
                <CardTitle className="text-[var(--warning)]">Caixa / Repossessed vehicle review</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-sm text-text-secondary">
                <Field label="Edital reviewed" value={risk.caixaReview.editalReviewed ? "Yes" : "Not yet — do this before offering"} />
                <Field label="Hidden transfer costs (est.)" value={formatBRL(risk.caixaReview.hiddenTransferCostsBRL)} />
                <Field label="History clarity" value={risk.caixaReview.historyClarity} />
                <Field label="Resale stigma" value={risk.caixaReview.resaleStigmaNote} />
                <Field label="Legal / transfer risk" value={risk.caixaReview.legalTransferRiskNote} />
              </CardContent>
            </Card>
          )}
        </div>
      </TabsContent>

      <TabsContent value="condition">
        <Card>
          <CardHeader>
            <CardTitle>Condition review — score {condition.score}/100</CardTitle>
          </CardHeader>
          <CardContent>
            <ul className="divide-y divide-border">
              {condition.fields.map((f) => (
                <li key={f.key} className="flex items-start justify-between gap-3 py-3">
                  <div>
                    <span className="text-sm font-medium text-text-primary">{f.label}</span>
                    <p className="mt-0.5 text-xs text-text-muted">{f.notes}</p>
                  </div>
                  <Badge variant={RATING_LABEL[f.rating].variant}>{RATING_LABEL[f.rating].label}</Badge>
                </li>
              ))}
            </ul>
            <div className="mt-4 rounded-md border border-border bg-surface-hover/50 p-3">
              <span className="text-xs font-medium text-text-muted">Mechanic notes</span>
              <p className="mt-1 text-sm text-text-secondary">{condition.mechanicNotes}</p>
            </div>
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="market">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Market &amp; valuation</CardTitle>
            <Button variant="secondary" size="sm" disabled={isPending} onClick={handleSync}>
              <RefreshCw className={isPending ? "h-3.5 w-3.5 animate-spin" : "h-3.5 w-3.5"} />
              {isPending ? "Syncing..." : "Sync from FIPE"}
            </Button>
          </CardHeader>
          <CardContent className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Asking price" value={formatBRL(market.askingPriceBRL)} />
            <Field label="FIPE value" value={formatFipe(market.fipeValueBRL)} />
            <Field
              label="Fair market range"
              value={
                market.fairMarketMinBRL !== null && market.fairMarketMaxBRL !== null
                  ? `${formatBRL(market.fairMarketMinBRL)} – ${formatBRL(market.fairMarketMaxBRL)}`
                  : "FIPE not synced"
              }
            />
            <Field
              label="Premium vs fair value"
              value={
                market.premiumOverFairPct !== null
                  ? formatPct(market.premiumOverFairPct, { signed: true })
                  : "—"
              }
            />
            <Field label="Resale ease" value={market.resaleEase} />
            <Field label="Resale time" value={market.resaleTimeBucket} />
            <Field label="Market verdict" value={market.verdict.replaceAll("_", " ")} />

            {syncResult && (
              <div className="sm:col-span-2">
                {syncResult.ok ? (
                  <p className="rounded-md border border-[var(--success)]/30 bg-[var(--success-bg)] px-3 py-2 text-xs text-[var(--success)]">
                    Synced: {formatBRL(syncResult.valueBRL!)} for &ldquo;{syncResult.matchedModel}&rdquo; (FIPE reference: {syncResult.referenceMonth}).
                  </p>
                ) : (
                  <p className="rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger)]">
                    Sync failed: {syncResult.error}
                  </p>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </TabsContent>

      <TabsContent value="attachments">
        <Card>
          <CardHeader>
            <CardTitle>Attachments &amp; evidence</CardTitle>
          </CardHeader>
          <CardContent>
            {car.attachments.length === 0 ? (
              <p className="text-sm text-text-muted">No attachments uploaded yet.</p>
            ) : (
              <ul className="divide-y divide-border">
                {car.attachments.map((a) => (
                  <li key={a.id} className="flex items-center justify-between py-2.5 text-sm">
                    <span className="text-text-primary">{a.label}</span>
                    <span className="text-xs text-text-muted">{a.kind.replaceAll("_", " ")} · {a.addedAt}</span>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>
      </TabsContent>
    </Tabs>
  );
}

function Field({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <span className="text-xs font-medium text-text-muted">{label}</span>
      <div className="mt-0.5 text-sm text-text-primary capitalize">{value}</div>
    </div>
  );
}
