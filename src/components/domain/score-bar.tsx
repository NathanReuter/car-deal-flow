import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

function toneFor(score: number) {
  if (score >= 75) return "bg-[var(--success)]";
  if (score >= 50) return "bg-[var(--warning)]";
  return "bg-[var(--danger)]";
}

export function ScoreBar({
  label,
  score,
  weightPct,
}: {
  label: string;
  score: number | null;
  weightPct?: number;
}) {
  if (score === null) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between text-xs">
          <span className="text-text-secondary">
            {label}
            <span className="ml-1 text-text-muted">(excluded)</span>
          </span>
          <span className="font-semibold tabular-nums text-text-muted">n/a</span>
        </div>
        <Progress value={0} indicatorClassName="bg-border" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-text-secondary">
          {label}
          {weightPct !== undefined && <span className="ml-1 text-text-muted">({weightPct}% weight)</span>}
        </span>
        <span className="font-semibold tabular-nums text-text-primary">{score}</span>
      </div>
      <Progress value={score} indicatorClassName={cn(toneFor(score))} />
    </div>
  );
}
