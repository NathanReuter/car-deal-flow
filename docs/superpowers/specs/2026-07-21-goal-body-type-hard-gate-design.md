# Goal ingestion: hard-reject wrong-segment body types

Date: 2026-07-21

## Problem

The active `BuyingGoal` (`goal-01`) targets the compact-SUV-and-above tier
(Creta, Nivus, T-Cross, HR-V, Tracker, Compass, Kicks, Duster, Corolla Cross,
Pulse, etc.), but `preferredBodyTypes` is currently
`["suv","hatch","sedan"]` and body-type match is only one of six equally
weighted soft criteria in `computeGoalFit`. A car that matches on
budget/year/brand can still clear the `minGoalFit` threshold even when its
body type is wrong, so entry hatches and sedans (Onix, Gol, HB20, Kwid,
Civic, Voyage, Strada, Saveiro, Hilux, Spin, ...) are accumulating in
`new_lead`/`parked`. As of 2026-07-21 that's ~500+ cars across those models.

`bodyType` classification in the DB is already clean: every model the user
wants is tagged `suv`; every model that doesn't fit is `hatch`, `sedan`,
`pickup`, or `minivan`. So restricting to `suv` and gating on it hard is
sufficient to split the segment correctly, with no per-model allowlist to
maintain.

Only a `score === 0` result routes a car to `rejected` in
`applyGoalFilter` (`scripts/ingestion/apply-goal-filter.ts`); anything below
`minGoalFit` but above 0 goes to `parked`. Since the goal is for wrong-segment
cars to land in `rejected`, body-type mismatch must be a categorical gate
(score forced to 0), not a weighted criterion.

## Design

### 1. Goal config

Update the active `BuyingGoal` row (`goal-01`):
- `preferredBodyTypes`: `["suv","hatch","sedan"]` → `["suv"]`
- `excludedBrandsModels`: keep existing (`["Jeep Renegade"]`) as the override
  list for specific unwanted SUVs within the `suv` bodyType (e.g. subcompact
  tier). No other fields change.

### 2. Hard gate in `computeGoalFit` (`src/lib/scoring/goalFit.ts`)

Add a third categorical gate, same shape and same position (before the
weighted criteria loop) as the existing excluded-brand/model gate (lines
13-31) and damage-signal gate (lines 33-45):

```
if goal.preferredBodyTypes.length > 0 and car.bodyType not in goal.preferredBodyTypes:
    return { score: 0, failedCriteria: ["<bodyType> is outside the preferred body types (<list>)"], ... }
```

Remove the old "Preferred body type" entry from the soft `criteria` array —
once the gate exists, any car reaching the weighted loop already has a
matching body type, so the soft check is dead weight.

No other criteria (budget, year, mileage, brand, family space) change.

### 3. Backlog cleanup

After (1) and (2) land, run `applyGoalFilter` once against all current
`new_lead`/`parked` cars (this is exactly what the function already does —
no new code needed here). Report before/after `pipelineStage` counts.

### 4. New skill: `apply-goal-filter`

Add `.claude/skills/apply-goal-filter/SKILL.md`, a thin wrapper around the
existing `scripts/ingestion/apply-goal-filter.ts` script. Triggered by
phrasing like "clean up leads against goal" or "reject leads that don't fit
the goal". No new logic — makes the existing script easy to invoke on demand
(e.g. after a bulk import), rather than only being run implicitly per the
guidance list in `goal-hint.ts`.

### 5. Tests

- `src/lib/scoring/__tests__/goalFit.test.ts`: add coverage for the new
  body-type gate (wrong body type → score 0, `failedCriteria` mentions the
  mismatch), and confirm a correct-bodyType SUV is unaffected.
- `scripts/ingestion/__tests__/apply-goal-filter.test.ts`: verify a
  wrong-bodyType fixture car routes to `rejected`, not `parked`.
- `src/lib/__tests__/aggregate-page.test.ts`: check fixtures don't rely on
  the removed soft body-type criterion; update if needed.

## Out of scope

- No schema changes — `BuyingGoal.preferredBodyTypes` and `Car.bodyType`
  already exist and are sufficient.
- No new "model tier" concept (e.g. subcompact vs compact SUV) — the
  existing `excludedBrandsModels` override list handles any individual SUV
  model the user wants excluded despite matching `bodyType: "suv"`.
- No changes to budget/year/mileage/brand/family-space criteria or their
  weights.
