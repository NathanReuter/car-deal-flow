"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { VerdictBadge } from "@/components/domain/verdict-badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { formatBRL, formatKm } from "@/lib/format";
import { updateCarStage } from "@/lib/actions/pipeline";
import { KANBAN_STAGES, PIPELINE_STAGES, type PipelineStage } from "@/lib/types";
import type { CarBundle } from "@/lib/aggregate";
import { cn } from "@/lib/utils";

export function KanbanBoard({ bundles }: { bundles: CarBundle[] }) {
  const router = useRouter();
  const [, startTransition] = useTransition();
  const [stageOverrides, setStageOverrides] = useState<Record<string, PipelineStage>>({});

  function stageOf(bundle: CarBundle): PipelineStage {
    return stageOverrides[bundle.car.id] ?? bundle.car.pipelineStage;
  }

  function moveCard(carId: string, stage: PipelineStage) {
    setStageOverrides((prev) => ({ ...prev, [carId]: stage }));
    startTransition(async () => {
      await updateCarStage(carId, stage);
      router.refresh();
    });
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {KANBAN_STAGES.map((stage) => {
        const items = bundles.filter((b) => stageOf(b) === stage.id);
        return (
          <div key={stage.id} className="flex w-72 shrink-0 flex-col gap-3">
            <div className="flex items-center justify-between px-1">
              <h3 className="text-sm font-semibold text-text-primary">{stage.label}</h3>
              <span className="rounded-full bg-surface-hover px-2 py-0.5 text-xs text-text-muted">{items.length}</span>
            </div>

            <div className="flex flex-col gap-2">
              {items.map((b) => (
                <Card key={b.car.id} className="border-border">
                  <CardContent className="p-3">
                    <Link href={`/cars/${b.car.id}`} className="text-sm font-medium text-text-primary hover:text-accent">
                      {b.car.brand} {b.car.model}
                    </Link>
                    <div className="mt-0.5 text-xs text-text-muted">
                      {b.car.year} · {formatKm(b.car.mileageKm)}
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <span className="text-sm font-semibold text-text-primary">{formatBRL(b.car.askingPriceBRL)}</span>
                      <VerdictBadge verdict={b.decision.verdict} />
                    </div>
                    <Select
                      value={stageOf(b)}
                      onValueChange={(v) => moveCard(b.car.id, v as PipelineStage)}
                    >
                      <SelectTrigger className="mt-2 h-7 w-full text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {PIPELINE_STAGES.map((s) => (
                          <SelectItem key={s.id} value={s.id}>{s.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </CardContent>
                </Card>
              ))}
              {items.length === 0 && (
                <div className={cn("rounded-md border border-dashed border-border py-6 text-center text-xs text-text-muted")}>
                  No vehicles
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
