import { CheckCircle2, ShieldAlert, TriangleAlert, XCircle } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { ScoreBar } from "@/components/domain/score-bar";
import { VERDICT_LABEL, type DecisionResult } from "@/lib/types";
import { cn } from "@/lib/utils";

const VERDICT_META = {
  safe_buy: {
    icon: CheckCircle2,
    tone: "text-[var(--success)]",
    bg: "bg-[var(--success-bg)]",
    ring: "ring-[var(--success)]/30",
    summary: "This vehicle clears every gate: documentation, condition, value, and goal fit are all solid.",
  },
  good_deal_verify: {
    icon: ShieldAlert,
    tone: "text-[var(--info)]",
    bg: "bg-[var(--info-bg)]",
    ring: "ring-[var(--info)]/30",
    summary: "Strong overall profile, but one or more pending items need verification before committing.",
  },
  only_if_negotiated: {
    icon: TriangleAlert,
    tone: "text-[var(--warning)]",
    bg: "bg-[var(--warning-bg)]",
    ring: "ring-[var(--warning)]/30",
    summary: "Only proceed if price is renegotiated down or the flagged risk is resolved first.",
  },
  avoid: {
    icon: XCircle,
    tone: "text-[var(--danger)]",
    bg: "bg-[var(--danger-bg)]",
    ring: "ring-[var(--danger)]/30",
    summary: "Material risk or condition issues make this an unsafe purchase as currently listed.",
  },
} as const;

export function SafeBuyCard({ decision }: { decision: DecisionResult }) {
  const meta = VERDICT_META[decision.verdict];
  const Icon = meta.icon;

  return (
    <Card className={cn("ring-1", meta.ring)}>
      <CardHeader className="pb-0">
        <span className="text-xs font-medium uppercase tracking-wide text-text-muted">Is this a safe buy?</span>
      </CardHeader>
      <CardContent className="pt-3">
        <div className="flex items-start gap-3">
          <div className={cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-full", meta.bg)}>
            <Icon className={cn("h-6 w-6", meta.tone)} />
          </div>
          <div>
            <div className={cn("text-xl font-semibold", meta.tone)}>{VERDICT_LABEL[decision.verdict]}</div>
            <p className="mt-1 text-sm text-text-secondary">{meta.summary}</p>
          </div>
        </div>

        <div className="mt-5 flex items-center justify-between rounded-md border border-border bg-surface-hover/50 px-3 py-2">
          <span className="text-xs font-medium text-text-muted">Final weighted score</span>
          <span className="text-lg font-bold tabular-nums text-text-primary">{decision.finalScore}/100</span>
        </div>

        <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <ScoreBar label="Goal fit" score={decision.goalFitScore} weightPct={decision.weights.goalFit * 100} />
          <ScoreBar label="Documentation / risk" score={decision.documentationRiskScore} weightPct={decision.weights.documentationRisk * 100} />
          <ScoreBar label="Condition" score={decision.conditionScore} weightPct={decision.weights.condition * 100} />
          <ScoreBar label="Value vs market" score={decision.valueScore} weightPct={decision.weights.value * 100} />
          <ScoreBar label="Resale / liquidity" score={decision.resaleLiquidityScore} weightPct={decision.weights.resaleLiquidity * 100} />
        </div>

        {decision.severeRiskGate && (
          <div className="mt-4 flex items-start gap-2 rounded-md border border-[var(--danger)]/30 bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger)]">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Severe documentation risk detected — verdict is capped below Safe Buy unless manually overridden.</span>
          </div>
        )}

        <ul className="mt-4 space-y-1.5 border-t border-border pt-3 text-xs text-text-secondary">
          {decision.reasoning.map((line, i) => (
            <li key={i} className="flex gap-1.5">
              <span className="text-text-muted">•</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
