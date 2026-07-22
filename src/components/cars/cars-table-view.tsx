"use client";

import { useCallback, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TBody, TD, TH, THead, TR } from "@/components/ui/table";
import { VerdictBadge } from "@/components/domain/verdict-badge";
import { PhaseBadge } from "@/components/domain/phase-badge";
import { UrgencyBadge } from "@/components/domain/urgency-badge";
import { ConfidenceBadge } from "@/components/domain/confidence-badge";
import { formatBRL, formatKm } from "@/lib/format";
import {
  DEAL_PHASE_LABEL,
  PIPELINE_STAGES,
  SELLER_TYPE_LABEL,
  VERDICT_LABEL,
  SOURCE_CHANNEL_LABEL,
  CONFIDENCE_LABEL,
  type DealPhase,
  type Verdict,
  type SourceChannel,
  type LeadConfidence,
} from "@/lib/types";
import type { CarBundle, BundlesPage, BundlesPageParams } from "@/lib/aggregate";

// ---------------------------------------------------------------------------
// Types

type SortKey = NonNullable<BundlesPageParams["sort"]>;

interface CarsTableViewProps {
  rows: CarBundle[];
  total: number;
  page: number;
  pageSize: number;
  facets: BundlesPage["facets"];
  params: BundlesPageParams;
}

// ---------------------------------------------------------------------------
// Helpers

function withFacetCount(label: string, count: number | undefined): string {
  return count !== undefined ? `${label} (${count})` : label;
}

/**
 * Compute FIPE discount percentage.
 * Returns a number [0-100] when fipeValueBRL is present and > 0, else null.
 */
function fipeDeltaPct(askingPriceBRL: number, fipeValueBRL: number | null | undefined): number | null {
  if (!fipeValueBRL || fipeValueBRL <= 0) return null;
  return Math.round((1 - askingPriceBRL / fipeValueBRL) * 100);
}

// ---------------------------------------------------------------------------
// ActiveFilterChips

interface ChipProps {
  label: string;
  onDismiss: () => void;
}

function FilterChip({ label, onDismiss }: ChipProps) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-surface-card px-2.5 py-0.5 text-xs font-medium text-text-primary ring-1 ring-border">
      {label}
      <button
        type="button"
        onClick={onDismiss}
        aria-label={`Remove filter: ${label}`}
        className="ml-0.5 rounded-full p-0.5 hover:bg-surface-overlay focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
      >
        <X className="h-3 w-3" />
      </button>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Pager

interface PagerProps {
  page: number;
  total: number;
  pageSize: number;
  onPage: (p: number) => void;
}

function Pager({ page, total, pageSize, onPage }: PagerProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return (
    <div className="flex items-center justify-between text-sm text-text-secondary">
      <span className="tabular-nums">{total} vehicles</span>
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={() => onPage(page - 1)}
          disabled={page <= 1}
          className="rounded px-2 py-1 hover:bg-surface-card disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          ‹ Prev
        </button>
        <span className="tabular-nums">
          Page {page} of {totalPages}
        </span>
        <button
          type="button"
          onClick={() => onPage(page + 1)}
          disabled={page >= totalPages}
          className="rounded px-2 py-1 hover:bg-surface-card disabled:pointer-events-none disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
        >
          Next ›
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sortable TH
//
// Sort direction per key (matches SQL in getBundlesPage):
//   score  → desc (highest first)
//   year   → desc (newest first)
//   recent → desc (newest first)
//   price  → asc  (cheapest first)
//   mileage → asc (lowest first)

const SORT_DIRECTION: Record<SortKey, "ascending" | "descending"> = {
  score: "descending",
  year: "descending",
  recent: "descending",
  price: "ascending",
  mileage: "ascending",
};

interface SortableTHProps {
  children: React.ReactNode;
  sortKey: SortKey;
  currentSort: SortKey;
  onSort: (key: SortKey) => void;
  className?: string;
}

function SortableTH({ children, sortKey, currentSort, onSort, className }: SortableTHProps) {
  const isActive = currentSort === sortKey;
  const ariaSort: React.AriaAttributes["aria-sort"] = isActive ? SORT_DIRECTION[sortKey] : "none";
  return (
    <TH
      className={className}
      aria-sort={ariaSort}
    >
      <button
        type="button"
        onClick={() => onSort(sortKey)}
        className={`inline-flex items-center gap-1 hover:text-accent focus-visible:outline-none focus-visible:underline ${isActive ? "text-accent font-semibold" : ""}`}
      >
        {children}
        {isActive ? (
          <span aria-hidden="true" className="text-xs">
            {SORT_DIRECTION[sortKey] === "ascending" ? "▲" : "▼"}
          </span>
        ) : (
          <span aria-hidden="true" className="text-xs opacity-30">▼</span>
        )}
      </button>
    </TH>
  );
}

// ---------------------------------------------------------------------------
// FIPE-Δ display cell

function FipeDeltaCell({ askingPriceBRL, fipeValueBRL }: { askingPriceBRL: number; fipeValueBRL: number | null | undefined }) {
  const pct = fipeDeltaPct(askingPriceBRL, fipeValueBRL);
  if (pct === null) return <span className="text-text-muted">—</span>;

  let colorClass = "text-text-muted";
  if (pct >= 20) colorClass = "text-green-600 dark:text-green-400 font-semibold";
  else if (pct >= 10) colorClass = "text-green-500 dark:text-green-300";

  return <span className={`tabular-nums ${colorClass}`}>{pct > 0 ? `-${pct}%` : `+${Math.abs(pct)}%`}</span>;
}

// ---------------------------------------------------------------------------
// Mobile card (< sm breakpoint)

function CarCard({ b, pathname }: { b: CarBundle; pathname: string }) {
  const pct = fipeDeltaPct(b.car.askingPriceBRL, b.car.fipeValueBRL);
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border bg-surface-card p-3">
      {/* Header row: brand/model + score */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <Link
            href={`/cars/${b.car.id}`}
            className="font-semibold text-text-primary hover:text-accent"
          >
            {b.car.brand} {b.car.model}
          </Link>
          {b.car.trim && <div className="text-xs text-text-muted">{b.car.trim}</div>}
        </div>
        <span className="shrink-0 tabular-nums font-semibold text-text-primary">
          {b.decision.finalScore}
        </span>
      </div>

      {/* Price + FIPE Δ */}
      <div className="flex items-center gap-3 text-sm">
        <span className="tabular-nums font-medium text-text-primary">{formatBRL(b.car.askingPriceBRL)}</span>
        {pct !== null && (
          <FipeDeltaCell askingPriceBRL={b.car.askingPriceBRL} fipeValueBRL={b.car.fipeValueBRL} />
        )}
      </div>

      {/* Year / KM / Location */}
      <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-text-secondary">
        <span className="tabular-nums">{b.car.year}</span>
        <span className="tabular-nums">{formatKm(b.car.mileageKm)}</span>
        <span>{b.car.city}/{b.car.state}</span>
      </div>

      {/* Badges */}
      <div className="flex flex-wrap items-center gap-1">
        <PhaseBadge dealPhase={b.car.dealPhase} />
        {b.car.dealPhase === "pre_repossession" && (
          <UrgencyBadge urgency={b.car.repasse?.urgency} />
        )}
        <ConfidenceBadge confidence={b.car.confidence} />
        <VerdictBadge verdict={b.decision.verdict} />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component

export function CarsTableView({ rows, total, page, pageSize, facets, params }: CarsTableViewProps) {
  const router = useRouter();
  const pathname = usePathname();

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const brandDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stateDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const priceMinDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const priceMaxDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ---------------------------------------------------------------------------
  // URL mutation helpers

  const buildUrl = useCallback(
    (overrides: Partial<Record<string, string | undefined>>): string => {
      const sp = new URLSearchParams();
      // Start from current server params, then apply overrides
      const base: Record<string, string | undefined> = {
        page: params.page && params.page > 1 ? String(params.page) : undefined,
        q: params.q,
        brand: params.brand,
        stage: params.stage,
        phase: params.phase,
        sourceChannel: params.sourceChannel,
        confidence: params.confidence,
        state: params.state,
        verdict: params.verdict,
        priceMin: params.priceMin !== undefined ? String(params.priceMin) : undefined,
        priceMax: params.priceMax !== undefined ? String(params.priceMax) : undefined,
        belowFipePctMin:
          params.belowFipePctMin !== undefined ? String(params.belowFipePctMin) : undefined,
        sort: params.sort && params.sort !== "recent" ? params.sort : undefined,
        ...overrides,
      };
      for (const [k, v] of Object.entries(base)) {
        if (v !== undefined && v !== "") sp.set(k, v);
      }
      const qs = sp.toString();
      return qs ? `${pathname}?${qs}` : pathname;
    },
    [params, pathname],
  );

  const push = useCallback(
    (overrides: Partial<Record<string, string | undefined>>) => {
      // Reset page to 1 whenever a filter changes (unless explicitly setting page)
      const withReset = "page" in overrides ? overrides : { ...overrides, page: undefined };
      router.replace(buildUrl(withReset), { scroll: false });
    },
    [router, buildUrl],
  );

  // ---------------------------------------------------------------------------
  // Filter change handlers

  const handleSearchChange = (value: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      push({ q: value || undefined });
    }, 250);
  };

  const handleBrandChange = (value: string) => {
    if (brandDebounceRef.current) clearTimeout(brandDebounceRef.current);
    brandDebounceRef.current = setTimeout(() => {
      push({ brand: value || undefined });
    }, 250);
  };

  const handleStateChange = (value: string) => {
    if (stateDebounceRef.current) clearTimeout(stateDebounceRef.current);
    stateDebounceRef.current = setTimeout(() => {
      push({ state: value || undefined });
    }, 250);
  };

  const handlePriceMinChange = (value: string) => {
    if (priceMinDebounceRef.current) clearTimeout(priceMinDebounceRef.current);
    priceMinDebounceRef.current = setTimeout(() => {
      push({ priceMin: value || undefined });
    }, 250);
  };

  const handlePriceMaxChange = (value: string) => {
    if (priceMaxDebounceRef.current) clearTimeout(priceMaxDebounceRef.current);
    priceMaxDebounceRef.current = setTimeout(() => {
      push({ priceMax: value || undefined });
    }, 250);
  };

  const handleSort = (key: SortKey) => {
    push({ sort: key === "recent" ? undefined : key });
  };

  const handlePage = (p: number) => {
    router.replace(buildUrl({ page: p > 1 ? String(p) : undefined }), { scroll: false });
  };

  // ---------------------------------------------------------------------------
  // Active filter chips

  type ChipDef = { label: string; clear: Partial<Record<string, string | undefined>> };
  const chips: ChipDef[] = [];

  if (params.q) chips.push({ label: `"${params.q}"`, clear: { q: undefined } });
  if (params.brand) chips.push({ label: `Brand: ${params.brand}`, clear: { brand: undefined } });
  if (params.stage) {
    const stageLabel = PIPELINE_STAGES.find((s) => s.id === params.stage)?.label ?? params.stage;
    chips.push({ label: `Stage: ${stageLabel}`, clear: { stage: undefined } });
  }
  if (params.phase) {
    chips.push({
      label: `Phase: ${DEAL_PHASE_LABEL[params.phase as DealPhase] ?? params.phase}`,
      clear: { phase: undefined },
    });
  }
  if (params.sourceChannel) {
    chips.push({
      label: `Channel: ${SOURCE_CHANNEL_LABEL[params.sourceChannel as SourceChannel] ?? params.sourceChannel}`,
      clear: { sourceChannel: undefined },
    });
  }
  if (params.confidence) {
    chips.push({
      label: `Confidence: ${CONFIDENCE_LABEL[params.confidence as LeadConfidence] ?? params.confidence}`,
      clear: { confidence: undefined },
    });
  }
  if (params.state) chips.push({ label: `State: ${params.state}`, clear: { state: undefined } });
  if (params.verdict) {
    chips.push({
      label: `Verdict: ${VERDICT_LABEL[params.verdict as Verdict] ?? params.verdict}`,
      clear: { verdict: undefined },
    });
  }
  if (params.priceMin !== undefined) {
    chips.push({ label: `Min price: ${formatBRL(params.priceMin)}`, clear: { priceMin: undefined } });
  }
  if (params.priceMax !== undefined) {
    chips.push({ label: `Max price: ${formatBRL(params.priceMax)}`, clear: { priceMax: undefined } });
  }
  if (params.belowFipePctMin !== undefined) {
    chips.push({
      label: `≥${params.belowFipePctMin}% below FIPE`,
      clear: { belowFipePctMin: undefined },
    });
  }
  if (params.sort && params.sort !== "recent") {
    const sortLabels: Record<SortKey, string> = {
      recent: "Newest",
      score: "Score",
      price: "Price",
      year: "Year",
      mileage: "Mileage",
    };
    chips.push({ label: `Sort: ${sortLabels[params.sort]}`, clear: { sort: undefined } });
  }

  const currentSort: SortKey = params.sort ?? "recent";

  return (
    <div className="flex flex-col gap-4">
      {/* ── Filter row ── */}
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        {/* Search */}
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted" />
          <Input
            key={`q-${params.q ?? ""}`}
            placeholder="Search brand, model, city..."
            defaultValue={params.q ?? ""}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-8"
          />
        </div>

        {/* Brand — debounced text filter (contains / case-insensitive) */}
        <Input
          key={`brand-${params.brand ?? ""}`}
          placeholder="Brand (e.g. Toyo)"
          defaultValue={params.brand ?? ""}
          onChange={(e) => handleBrandChange(e.target.value)}
          className="w-full sm:w-36"
          aria-label="Filter by brand"
        />

        {/* Stage */}
        <Select
          value={params.stage ?? "all"}
          onValueChange={(v) => push({ stage: v === "all" ? undefined : v })}
        >
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Stage" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All stages</SelectItem>
            {PIPELINE_STAGES.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Phase */}
        <Select
          value={params.phase ?? "all"}
          onValueChange={(v) => push({ phase: v === "all" ? undefined : v })}
        >
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="Phase" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All phases</SelectItem>
            {(Object.keys(DEAL_PHASE_LABEL) as DealPhase[]).map((p) => (
              <SelectItem key={p} value={p}>
                {withFacetCount(DEAL_PHASE_LABEL[p], facets.phase[p])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Source channel */}
        <Select
          value={params.sourceChannel ?? "all"}
          onValueChange={(v) => push({ sourceChannel: v === "all" ? undefined : v })}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Channel" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All channels</SelectItem>
            {(Object.keys(SOURCE_CHANNEL_LABEL) as SourceChannel[]).map((ch) => (
              <SelectItem key={ch} value={ch}>
                {withFacetCount(SOURCE_CHANNEL_LABEL[ch], facets.sourceChannel[ch])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* Confidence */}
        <Select
          value={params.confidence ?? "all"}
          onValueChange={(v) => push({ confidence: v === "all" ? undefined : v })}
        >
          <SelectTrigger className="w-full sm:w-40">
            <SelectValue placeholder="Confidence" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All confidence</SelectItem>
            {(Object.keys(CONFIDENCE_LABEL) as LeadConfidence[]).map((c) => (
              <SelectItem key={c} value={c}>
                {withFacetCount(CONFIDENCE_LABEL[c], facets.confidence[c])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* State — debounced text filter */}
        <Input
          key={`state-${params.state ?? ""}`}
          placeholder="State (e.g. SP)"
          defaultValue={params.state ?? ""}
          onChange={(e) => handleStateChange(e.target.value)}
          className="w-full sm:w-28"
          aria-label="Filter by state (UF)"
          maxLength={2}
        />

        {/* Price range */}
        <Input
          key={`priceMin-${params.priceMin ?? ""}`}
          type="number"
          inputMode="numeric"
          placeholder="Min price"
          defaultValue={params.priceMin ?? ""}
          onChange={(e) => handlePriceMinChange(e.target.value)}
          className="w-full sm:w-32"
          aria-label="Minimum price"
        />
        <Input
          key={`priceMax-${params.priceMax ?? ""}`}
          type="number"
          inputMode="numeric"
          placeholder="Max price"
          defaultValue={params.priceMax ?? ""}
          onChange={(e) => handlePriceMaxChange(e.target.value)}
          className="w-full sm:w-32"
          aria-label="Maximum price"
        />

        {/* Verdict */}
        <Select
          value={params.verdict ?? "all"}
          onValueChange={(v) => push({ verdict: v === "all" ? undefined : v })}
        >
          <SelectTrigger className="w-full sm:w-48">
            <SelectValue placeholder="Verdict" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All verdicts</SelectItem>
            {(Object.keys(VERDICT_LABEL) as Verdict[]).map((v) => (
              <SelectItem key={v} value={v}>
                {withFacetCount(VERDICT_LABEL[v], facets.verdict[v])}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {/* FIPE delta */}
        <Select
          value={params.belowFipePctMin !== undefined ? String(params.belowFipePctMin) : "any"}
          onValueChange={(v) =>
            push({ belowFipePctMin: v === "any" ? undefined : v })
          }
        >
          <SelectTrigger className="w-full sm:w-44">
            <SelectValue placeholder="FIPE discount" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="any">Any FIPE delta</SelectItem>
            <SelectItem value="10">≥10% below FIPE</SelectItem>
            <SelectItem value="20">≥20% below FIPE</SelectItem>
            <SelectItem value="30">≥30% below FIPE</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* ── Active filter chips ── */}
      {chips.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          {chips.map((chip) => (
            <FilterChip
              key={chip.label}
              label={chip.label}
              onDismiss={() => push(chip.clear)}
            />
          ))}
          <Link
            href={pathname}
            className="text-xs text-text-muted underline hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
          >
            Clear all
          </Link>
        </div>
      )}

      {/* ── Mobile card layout (<sm) ── */}
      <div className="flex flex-col gap-3 sm:hidden">
        {rows.length === 0 ? (
          <p className="py-8 text-center text-sm text-text-muted">
            No vehicles match these filters.{" "}
            <Link
              href={pathname}
              className="underline hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            >
              Clear filters
            </Link>
          </p>
        ) : (
          rows.map((b) => <CarCard key={b.car.id} b={b} pathname={pathname} />)
        )}
      </div>

      {/* ── Desktop table (sm+) ── */}
      <div className="hidden sm:block">
        <Table>
          <THead>
            <TR>
              <SortableTH sortKey="recent" currentSort={currentSort} onSort={handleSort}>
                Vehicle
              </SortableTH>
              <SortableTH sortKey="year" currentSort={currentSort} onSort={handleSort}>
                Year
              </SortableTH>
              <SortableTH sortKey="mileage" currentSort={currentSort} onSort={handleSort}>
                KM
              </SortableTH>
              <SortableTH sortKey="price" currentSort={currentSort} onSort={handleSort}>
                Price
              </SortableTH>
              <TH>FIPE Δ</TH>
              <TH>Location</TH>
              <TH>Phase</TH>
              <TH>Seller</TH>
              <TH>Stage</TH>
              <TH>Verdict</TH>
              <SortableTH
                sortKey="score"
                currentSort={currentSort}
                onSort={handleSort}
                className="text-right"
              >
                Score
              </SortableTH>
            </TR>
          </THead>
          <TBody>
            {rows.map((b) => (
              <TR key={b.car.id} className="cursor-pointer">
                <TD>
                  <Link
                    href={`/cars/${b.car.id}`}
                    className="font-medium text-text-primary hover:text-accent"
                  >
                    {b.car.brand} {b.car.model}
                  </Link>
                  <div className="text-xs text-text-muted">{b.car.trim}</div>
                </TD>
                <TD className="tabular-nums text-text-secondary">{b.car.year}</TD>
                <TD className="tabular-nums text-text-secondary">{formatKm(b.car.mileageKm)}</TD>
                <TD className="tabular-nums font-medium">{formatBRL(b.car.askingPriceBRL)}</TD>
                <TD>
                  <FipeDeltaCell askingPriceBRL={b.car.askingPriceBRL} fipeValueBRL={b.car.fipeValueBRL} />
                </TD>
                <TD className="text-text-secondary">
                  {b.car.city}/{b.car.state}
                </TD>
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
                <TD className="text-text-secondary">
                  {PIPELINE_STAGES.find((s) => s.id === b.car.pipelineStage)?.label}
                </TD>
                <TD>
                  <VerdictBadge verdict={b.decision.verdict} />
                </TD>
                <TD className="text-right tabular-nums font-semibold">{b.decision.finalScore}</TD>
              </TR>
            ))}
            {rows.length === 0 && (
              <TR>
                <TD colSpan={11} className="py-8 text-center text-text-muted">
                  No vehicles match these filters.{" "}
                  <Link
                    href={pathname}
                    className="underline hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
                  >
                    Clear filters
                  </Link>
                </TD>
              </TR>
            )}
          </TBody>
        </Table>
      </div>

      {/* ── Pager ── */}
      <Pager page={page} total={total} pageSize={pageSize} onPage={handlePage} />
    </div>
  );
}
