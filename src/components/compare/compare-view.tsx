"use client";

import { useState } from "react";
import Link from "next/link";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { VerdictBadge } from "@/components/domain/verdict-badge";
import { formatBRL, formatFipe, formatKm, formatPct } from "@/lib/format";
import { SELLER_TYPE_LABEL } from "@/lib/types";
import type { CarBundle } from "@/lib/aggregate";

const SLOT_COUNT = 4;

export function CompareView({ bundles }: { bundles: CarBundle[] }) {
  const defaults = bundles.slice(0, 3).map((b) => b.car.id);
  const [selected, setSelected] = useState<string[]>([...defaults, ...Array(SLOT_COUNT - defaults.length).fill("")]);

  const chosen = selected.map((id) => bundles.find((b) => b.car.id === id)).filter((b): b is CarBundle => Boolean(b));

  const rows: { label: string; render: (b: CarBundle) => React.ReactNode }[] = [
    { label: "Verdict", render: (b) => <VerdictBadge verdict={b.decision.verdict} /> },
    { label: "Final score", render: (b) => <span className="font-semibold">{b.decision.finalScore}/100</span> },
    { label: "Asking price", render: (b) => formatBRL(b.car.askingPriceBRL) },
    { label: "FIPE value", render: (b) => formatFipe(b.market.fipeValueBRL) },
    {
      label: "Premium vs fair",
      render: (b) =>
        b.market.premiumOverFairPct !== null
          ? formatPct(b.market.premiumOverFairPct, { signed: true })
          : "—",
    },
    { label: "Year", render: (b) => String(b.car.year) },
    { label: "Mileage", render: (b) => formatKm(b.car.mileageKm) },
    { label: "Seller type", render: (b) => SELLER_TYPE_LABEL[b.car.sellerType] },
    { label: "Goal fit score", render: (b) => String(b.decision.goalFitScore) },
    { label: "Documentation / risk score", render: (b) => String(b.decision.documentationRiskScore) },
    { label: "Condition score", render: (b) => String(b.decision.conditionScore) },
    {
      label: "Value score",
      render: (b) =>
        b.decision.valueScore === null ? "Excluded (no FIPE)" : String(b.decision.valueScore),
    },
    { label: "Resale / liquidity score", render: (b) => String(b.decision.resaleLiquidityScore) },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {selected.map((value, i) => (
          <Select
            key={i}
            value={value || undefined}
            onValueChange={(v) => setSelected((prev) => prev.map((p, idx) => (idx === i ? v : p)))}
          >
            <SelectTrigger className="w-full"><SelectValue placeholder={`Vehicle ${i + 1}`} /></SelectTrigger>
            <SelectContent>
              {bundles.map((b) => (
                <SelectItem key={b.car.id} value={b.car.id}>
                  {b.car.brand} {b.car.model}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ))}
      </div>

      {chosen.length === 0 ? (
        <p className="py-10 text-center text-sm text-text-muted">Select up to 4 vehicles above to compare.</p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[640px] border-collapse text-sm">
            <thead className="bg-surface-hover">
              <tr>
                <th className="w-48 px-3 py-2.5 text-left text-xs font-medium uppercase tracking-wide text-text-muted">Metric</th>
                {chosen.map((b) => (
                  <th key={b.car.id} className="px-3 py-2.5 text-left">
                    <Link href={`/cars/${b.car.id}`} className="font-medium text-text-primary hover:text-accent">
                      {b.car.brand} {b.car.model}
                    </Link>
                    <div className="text-xs font-normal text-text-muted">{b.car.trim}</div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {rows.map((row) => (
                <tr key={row.label}>
                  <td className="px-3 py-2.5 text-xs font-medium text-text-muted">{row.label}</td>
                  {chosen.map((b) => (
                    <td key={b.car.id} className="px-3 py-2.5 text-text-primary">
                      {row.render(b)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
