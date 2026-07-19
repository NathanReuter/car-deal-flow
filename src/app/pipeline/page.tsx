import { KanbanBoard } from "@/components/pipeline/kanban-board";
import { getAllBundles } from "@/lib/aggregate";

export default async function PipelinePage() {
  const bundles = await getAllBundles();

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">Pipeline</h1>
        <p className="mt-1 text-sm text-text-muted">
          Drag the stage selector on each card to move it through your deal flow.
        </p>
      </div>
      <KanbanBoard bundles={bundles} />
    </div>
  );
}
