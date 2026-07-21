"use client";
import { KanbanBoard } from "@/components/pipeline/kanban-board";
import type { CarBundle } from "@/lib/aggregate";

// PipelineView: board-only view (table view is now on the /cars page with server pagination).
export function PipelineView({ bundles }: { bundles: CarBundle[] }) {
  return <KanbanBoard bundles={bundles} />;
}
