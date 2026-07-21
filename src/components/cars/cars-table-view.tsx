"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { VerdictBadge } from "@/components/domain/verdict-badge";
import { PhaseBadge } from "@/components/domain/phase-badge";
import { UrgencyBadge } from "@/components/domain/urgency-badge";
import { ConfidenceBadge } from "@/components/domain/confidence-badge";
import { formatBRL, formatKm } from "@/lib/format";
import { DEAL_PHASE_LABEL, PIPELINE_STAGES, SELLER_TYPE_LABEL, VERDICT_LABEL, type DealPhase, type Verdict } from "@/lib/types";
import { matchesPhase, type PhaseFilter } from "@/lib/repasse-display";
import type { CarBundle } from "@/lib/aggregate";

type SortKey = "score" | "price" | "mileage" | "year";

export function CarsTableView({ bundles }: { bundles: CarBundle[] }) {
  const [search, setSearch] = useState("");
  const [brand, setBrand] = useState<string>("all");
  const [stage, setStage] = useState<string>("all");
  const [phase, setPhase] = useState<PhaseFilter>("all");
  const [verdict, setVerdict] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("score");

  const brands = useMemo(() => Array.from(new Set(bundles.map((b) => b.car.brand))).sort(), [bundles]);

  const filtered = useMemo(() => {
    let list = bundles.filter((b) => {
      const haystack = `${b.car.brand} ${b.car.model} ${b.car.trim} ${b.car.city}`.toLowerCase();
      if (search && !haystack.includes(search.toLowerCase())) return false;
      if (brand !== "all" && b.car.brand !== brand) return false;
      if (stage === "all" && b.car.pipelineStage === "expired") return false;
      if (stage !== "all" && b.car.pipelineStage !== stage) return false;
      if (!matchesPhase(b.car, phase)) return false;
      if (verdict !== "all" && b.decision.verdict !== verdict) return false;
      return true;
    });

    list = [...list].sort((a, b) => {
      switch (sortKey) {
        case "price":
          return a.car.askingPriceBRL - b.car.askingPriceBRL;
        case "mileage":
          return (a.car.mileageKm ?? Number.POSITIVE_INFINITY) - (b.car.mileageKm ?? Number.POSITIVE_INFINITY);
        case "year":
          return b.car.year - a.car.year;
        default:
          return b.decision.finalScore - a.decision.finalScore;
      }
    });

    return list;
  }, [bundles, search, brand, stage, phase, verdict, sortKey]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            placeholder="Search brand, model, city..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8"
          />
        </div>

        <Select value={brand} onValueChange={setBrand}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Brand" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All brands</SelectItem>
            {brands.map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={stage} onValueChange={setStage}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Stage" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {PIPELINE_STAGES.map((s) => <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>

        <Select value={phase} onValueChange={(v) => setPhase(v as PhaseFilter)}>
          <SelectTrigger className="w-full sm:w-44"><SelectValue placeholder="Phase" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All phases</SelectItem>
            {(Object.keys(DEAL_PHASE_LABEL) as DealPhase[]).map((p) => (
              <SelectItem key={p} value={p}>{DEAL_PHASE_LABEL[p]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={verdict} onValueChange={setVerdict}>
          <SelectTrigger className="w-full sm:w-48"><SelectValue placeholder="Verdict" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All verdicts</SelectItem>
            {(Object.keys(VERDICT_LABEL) as Verdict[]).map((v) => (
              <SelectItem key={v} value={v}>{VERDICT_LABEL[v]}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
          <SelectTrigger className="w-full sm:w-40"><SelectValue placeholder="Sort by" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="score">Sort: Score</SelectItem>
            <SelectItem value="price">Sort: Price</SelectItem>
            <SelectItem value="mileage">Sort: Mileage</SelectItem>
            <SelectItem value="year">Sort: Year</SelectItem>
          </SelectContent>
        </Select>

        <span className="text-xs text-text-muted sm:ml-auto">{filtered.length} of {bundles.length} vehicles</span>
      </div>

      <Table>
        <THead>
          <TR>
            <TH>Vehicle</TH>
            <TH>Year / KM</TH>
            <TH>Price</TH>
            <TH>Location</TH>
            <TH>Phase</TH>
            <TH>Seller</TH>
            <TH>Stage</TH>
            <TH>Verdict</TH>
            <TH className="text-right">Score</TH>
          </TR>
        </THead>
        <TBody>
          {filtered.map((b) => (
            <TR key={b.car.id} className="cursor-pointer">
              <TD>
                <Link href={`/cars/${b.car.id}`} className="font-medium text-text-primary hover:text-accent">
                  {b.car.brand} {b.car.model}
                </Link>
                <div className="text-xs text-text-muted">{b.car.trim}</div>
              </TD>
              <TD className="text-text-secondary">
                {b.car.year} · {formatKm(b.car.mileageKm)}
              </TD>
              <TD className="font-medium">{formatBRL(b.car.askingPriceBRL)}</TD>
              <TD className="text-text-secondary">{b.car.city}/{b.car.state}</TD>
              <TD>
                <div className="flex flex-wrap items-center gap-1">
                  <PhaseBadge dealPhase={b.car.dealPhase} />
                  {b.car.dealPhase === "pre_repossession" && (
                    <UrgencyBadge urgency={b.car.repasse?.urgency} />
                  )}
                  <ConfidenceBadge confidence={b.car.confidence} />
                </div>
              </TD>
              <TD className="text-text-secondary">{SELLER_TYPE_LABEL[b.car.sellerType]}</TD>
              <TD className="text-text-secondary">{PIPELINE_STAGES.find((s) => s.id === b.car.pipelineStage)?.label}</TD>
              <TD><VerdictBadge verdict={b.decision.verdict} /></TD>
              <TD className="text-right font-semibold tabular-nums">{b.decision.finalScore}</TD>
            </TR>
          ))}
          {filtered.length === 0 && (
            <TR>
              <TD colSpan={9} className="py-8 text-center text-text-muted">
                No vehicles match these filters.
              </TD>
            </TR>
          )}
        </TBody>
      </Table>
    </div>
  );
}
