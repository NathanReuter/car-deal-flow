---
name: apply-goal-filter
description: Re-scores every new_lead/parked car in Car Deal Flow against the active BuyingGoal and moves mismatches to rejected or parked. Use when asked to "clean up leads against goal", "reject leads that don't fit the goal", "re-run the goal filter", or after a bulk import/goal-config change that needs the pipeline re-triaged.
---

# Apply Goal Filter

Re-scores every car in `new_lead`/`parked` against the active `BuyingGoal`
and updates `pipelineStage` in place:

- score `0` (hard-excluded brand/model, damage/sinistro signals in notes, or
  body type outside `preferredBodyTypes`) → `rejected`, with `stageReason`
  explaining why
- `0 < score < minGoalFit` (default 50) → `parked`
- `score >= minGoalFit` → `new_lead`, `stageReason` cleared

This is not a new script — it's `scripts/ingestion/apply-goal-filter.ts` /
`applyGoalFilter()`, already the standard post-harvest step per
`scripts/ingestion/goal-hint.ts`'s guidance. This skill just makes it easy to
invoke on demand (bulk import cleanup, after editing the goal in the UI,
after any scoring-logic change) without hunting for the script name/flags.

## Run it

```bash
npm run goal:filter
```

Or with a custom threshold:

```bash
npm run goal:filter -- --min-goal-fit 60
```

Prints a JSON summary: `{ evaluated, keptNewLead, parked, rejected }`.

## Notes

- Only touches `new_lead` and `parked` cars — `researching` and later
  pipeline stages are left alone (the operator has already engaged with
  them).
- Requires exactly one active `BuyingGoal` row; throws
  `ApplyGoalFilterError` if none is active.
- Hard-reject gates (score forced to 0, in priority order): excluded
  brand/model → damage/sinistro signals in notes → body type outside
  `preferredBodyTypes`. Everything else is scored as weighted soft criteria
  (budget, year, mileage, brand, family space).
- Safe to re-run any time — it's idempotent per car (recomputes from
  scratch each run, doesn't accumulate state).
