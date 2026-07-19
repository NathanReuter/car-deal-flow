import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { VerdictBadge } from "@/components/domain/verdict-badge";
import { ScoreBar } from "@/components/domain/score-bar";
import { formatBRL, formatKm } from "@/lib/format";
import { getAllBundles, getActiveGoal } from "@/lib/aggregate";
import { isShortlistEligible } from "@/lib/shortlist";

export default async function ShortlistPage() {
  const [allBundles, activeGoal] = await Promise.all([getAllBundles(), getActiveGoal()]);
  const bundles = allBundles
    .filter((b) => isShortlistEligible(b.car))
    .sort((a, b) => b.goalMatch.score - a.goalMatch.score || b.decision.finalScore - a.decision.finalScore);

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-text-primary">Shortlist</h1>
        <p className="mt-1 text-sm text-text-muted">
          Ranked against &ldquo;{activeGoal.name}&rdquo; by goal fit, then overall decision score.
          Expired lots are hidden unless already in an advanced stage (waiting docs, inspected, or later).
        </p>
      </div>

      <div className="flex flex-col gap-3">
        {bundles.map((b, i) => (
          <Card key={b.car.id}>
            <CardContent className="flex flex-col gap-4 pt-5 sm:flex-row sm:items-center">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-hover text-sm font-semibold text-text-secondary">
                #{i + 1}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/cars/${b.car.id}`} className="font-medium text-text-primary hover:text-accent">
                    {b.car.brand} {b.car.model} {b.car.trim}
                  </Link>
                  <VerdictBadge verdict={b.decision.verdict} />
                </div>
                <div className="mt-0.5 text-xs text-text-muted">
                  {b.car.year} · {formatKm(b.car.mileageKm)} · {b.car.city}/{b.car.state} · {formatBRL(b.car.askingPriceBRL)}
                </div>
              </div>

              <div className="grid w-full grid-cols-2 gap-3 sm:w-72 sm:shrink-0">
                <ScoreBar label="Goal fit" score={b.goalMatch.score} />
                <ScoreBar label="Final score" score={b.decision.finalScore} />
              </div>
            </CardContent>
          </Card>
        ))}
        {bundles.length === 0 && (
          <p className="py-10 text-center text-sm text-text-muted">No active vehicles to shortlist right now.</p>
        )}
      </div>
    </div>
  );
}
