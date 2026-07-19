import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { VerdictBadge } from "@/components/domain/verdict-badge";
import { formatBRL } from "@/lib/format";
import type { PriorityItem } from "@/lib/priority";

export function PriorityReviewPanel({ items }: { items: PriorityItem[] }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle>Priority review</CardTitle>
          <CardDescription className="mt-1">Vehicles that need your attention next.</CardDescription>
        </div>
        {items.length > 0 && (
          <span className="rounded-md bg-warning-bg px-2 py-1 text-xs font-medium tabular-nums text-warning">
            {items.length}
          </span>
        )}
      </CardHeader>
      <CardContent>
        {items.length === 0 ? (
          <p className="py-6 text-center text-sm text-text-secondary">
            Nothing urgent — all active vehicles are clear.
          </p>
        ) : (
          <ul className="divide-y divide-border">
            {items.map(({ bundle, reason }) => (
              <li key={bundle.car.id}>
                <Link
                  href={`/cars/${bundle.car.id}`}
                  className="group flex min-h-12 cursor-pointer items-center justify-between gap-3 py-3 transition-colors duration-200 hover:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-md px-1 -mx-1"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="truncate text-sm font-medium text-text-primary">
                        {bundle.car.brand} {bundle.car.model} {bundle.car.trim}
                      </span>
                      <VerdictBadge verdict={bundle.decision.verdict} />
                    </div>
                    <p className="mt-0.5 truncate text-xs text-text-secondary">{reason}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2 text-xs font-medium text-text-secondary">
                    <span className="tabular-nums">{formatBRL(bundle.car.askingPriceBRL)}</span>
                    <ArrowRight
                      className="h-3.5 w-3.5 text-text-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-accent"
                      aria-hidden
                    />
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
