"use client";
import { useState } from "react";
import { KanbanBoard } from "@/components/pipeline/kanban-board";
import { CarsTableView } from "@/components/cars/cars-table-view";
import { Button } from "@/components/ui/button";
import type { CarBundle } from "@/lib/aggregate";

export function PipelineView({ bundles }: { bundles: CarBundle[] }) {
  const [view, setView] = useState<"board" | "table">("board");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button variant={view === "board" ? "default" : "secondary"} size="sm" onClick={() => setView("board")}>Board</Button>
        <Button variant={view === "table" ? "default" : "secondary"} size="sm" onClick={() => setView("table")}>Table</Button>
      </div>
      {view === "board" ? <KanbanBoard bundles={bundles} /> : <CarsTableView bundles={bundles} />}
    </div>
  );
}
