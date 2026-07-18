# Spec: UI/data-layer reconstruction + build/CI hygiene

**Status:** Approved for planning (owner OK 2026-07-17).
**Companion:** repo evaluation that surfaced the gaps (this session).

---

## Problem

The ingestion pipeline is healthy and well-tested, but the product it feeds is not
wired up:

- `src/app/page.tsx` is still the stock create-next-app template; no route renders
  the pipeline. Harvested leads are invisible.
- The three UI components (`kanban-board`, `cars-table-view`, `car-detail-tabs`)
  and the data aggregator (`src/lib/aggregate.ts`) import ~16 modules that were
  never committed: `@/lib/db`, `@/lib/format`, `@/lib/utils`,
  `@/lib/actions/{pipeline,fipe-sync}`, `@/lib/scoring/{decision,market,risk,condition}`,
  `@/lib/integrations/fipe`, `@/components/ui/*`, `@/components/domain/*`.
- `npm run build` fails typecheck (`scripts/ingest-real-cars.ts` → missing
  `../src/lib/integrations/fipe`).
- `npm test` does not pass on a clean checkout: `playwright`, `playwright-extra`,
  and `puppeteer-extra-plugin-stealth` are imported but undeclared in
  `package.json` (breaks collection of 9 test files), and
  `scripts/risk-checks/__tests__/list-targets.test.ts` reuses `sourceUrl: "https://x"`
  across all 6 fixtures → guaranteed unique-constraint failure.
- No CI enforces build/test/lint, which is why the above rotted undetected.
- Pipeline code duplicates inference logic (body-type ×3, brand aliases ×2,
  seller-type ×2), a divergence risk.

## Objective

Make Car Deal Flow a working product again: reconstruct the missing UI/data layer
**to the contracts already fixed in `src/lib/types.ts`** (no interface invention),
surface leads in the browser, green the build/test/lint, add CI, and remove the
pipeline duplication. Personal single-owner decision-support app; no bidding.

## Non-goals

- No bidding/purchase automation, no scheduled harvests (SPEC boundaries hold).
- No goal-editing UI — the buying goal is seeded and edited via seed/Prisma Studio.
- No redesign of the existing components' structure; reconstruct their missing
  dependencies faithfully.

---

## Design

### 1. Infra & utilities

| Module | Contract | Notes |
|---|---|---|
| `src/lib/db.ts` | `export const prisma: PrismaClient` | better-sqlite3 adapter from `DATABASE_URL`; `globalThis` guard so dev hot-reload doesn't leak clients. Mirrors the adapter wiring already used in `scripts/**` and `test-db.ts`. |
| `src/lib/utils.ts` | `cn(...inputs)` | clsx + tailwind-merge (both installed). |
| `src/lib/format.ts` | `formatBRL, formatKm, formatDate, formatFipe, formatPct` | pt-BR locale; `formatFipe`/nullable helpers render an em-dash for null so "not synced" never shows as R$0. |

### 2. Scoring (pure functions; output shapes locked by `types.ts`)

All return the exact interfaces in `types.ts`. Deterministic, no I/O, unit-tested.

- **`risk.ts` — `computeRiskScore(items: RiskCheckItem[]): number`**
  Start at 100. Subtract per non-verified item weighted by severity
  (low/medium/high/severe). A `failed` + `severe` item floors the score near 0
  (mirrors the `severeRiskGate` concept). `pending` costs less than `failed`.
  Empty list → 100 (nothing known against it yet — matches `aggregate.ts` default).

- **`condition.ts` — `computeConditionScore(fields: ConditionField[]): number`**
  Map rating → points (good=100, fair=60, poor=20), average over rated fields;
  `not_inspected` excluded from the average. Empty/all-uninspected → 50 (matches
  the `aggregate.ts` "Not inspected yet" default).

- **`market.ts` — `computeMarketAssessment(car, fipe: number | null): MarketAssessment`**
  - `fipe === null` → `verdict: "unavailable"`, fair range null, `premiumOverFairPct: null`.
  - else fair range = FIPE ±7%; `premiumOverFairPct = (asking - fipe)/fipe * 100`
    (negative = discount); verdict `under_market` / `fair` / `overpriced` by band.
  - `resaleEase` + `resaleTimeBucket` from a body-type/brand liquidity heuristic
    (SUV/hatch from mainstream brands = high/fast; niche = low/slow).

- **`decision.ts` — `computeDecision(car, goal, risk, condition): DecisionResult`**
  - Sub-scores: `goalFitScore` (from `computeGoalFit`), `documentationRiskScore`
    (`risk.score`), `conditionScore` (`condition.score`), `valueScore` (from market:
    higher discount → higher score; **null when FIPE unknown**), `resaleLiquidityScore`.
  - Weighted blend with `DEFAULT_WEIGHTS`. **When `valueScore` is null, drop the
    `value` weight and renormalize the remaining four so they still sum to 1.**
  - `severeRiskGate`: any `failed`+`severe` risk item clamps `verdict` to `avoid`
    regardless of score.
  - `manualVerdictOverride` (if set) wins and sets `manualOverrideApplied: true`.
  - Verdict thresholds map `finalScore` → safe_buy / good_deal_verify /
    only_if_negotiated / avoid. Populate `reasoning[]` with the human-readable
    drivers (gate, top failing criteria, value stance).

### 3. FIPE integration (live public API)

- `src/lib/integrations/fipe.ts`:
  - `findFipeValue(car: Car): Promise<number>` — queries the public parallelum FIPE
    API via `fetch` (no npm dep). Walks brand → model → year. On no/ambiguous
    match, throws `FipeError`; callers keep `fipeValueBRL` null (**fail-closed**,
    per SPEC "never store a fake valuation").
  - `export class FipeError extends Error`.
  - Also consumed by `scripts/ingest-real-cars.ts` (fixes the build).
  - Network failures are the caller's to catch; the function does not retry
    silently or invent a value.

### 4. Server actions (`"use server"`)

- `actions/pipeline.ts` — `updateCarStage(carId: string, stage: PipelineStage)`:
  validate `stage` against `PIPELINE_STAGES`, update `pipelineStage`,
  `revalidatePath("/")` and the detail path. Reject unknown stages.
- `actions/fipe-sync.ts` — `syncFipeValue(carId): Promise<FipeSyncResult>`:
  load car, call `findFipeValue`, persist `fipeValueBRL`, return a tagged result
  `{ ok: true, value }` / `{ ok: false, reason }` (shape must satisfy the
  `FipeSyncResult` import in `car-detail-tabs.tsx`). Never throws to the client.

### 5. UI primitives, domain badges, tokens

- `src/components/ui/{card,badge,button,input,select,table,tabs}.tsx` — thin
  shadcn-style wrappers over the **already-installed** Radix packages
  (`@radix-ui/react-{dialog,label,progress,select,slot,tabs,tooltip}`) + cva.
  Export exactly the names the components import (e.g. `Table, TBody, TD, TH,
  THead, TR`; `Card, CardContent, CardHeader, CardTitle`; etc.).
- `src/components/domain/verdict-badge.tsx` (`VerdictBadge`) and
  `check-status-badge.tsx` (`CheckStatusBadge`) — map `Verdict` / `CheckStatus`
  to colored badges using `*_LABEL` maps from `types.ts`.
- `src/app/globals.css` — add the semantic tokens the components reference under
  `@theme`, for light + dark: `--color-text-primary`, `--color-text-secondary`,
  `--color-text-muted`, `--color-surface`, `--color-surface-hover`,
  `--color-border`, `--color-accent`.

### 6. Routes & shell

- `src/app/page.tsx` — server component: `const bundles = await getAllBundles()`,
  render a header + Kanban ↔ table toggle. **Empty DB / no active goal must not
  500**: catch the "No active goal" case and render a friendly empty state with a
  hint to seed.
- `src/app/cars/[id]/page.tsx` — dynamic route: `getBundle(id)`; `notFound()` when
  absent; render `CarDetailTabs`. Follow this Next.js version's params/async
  conventions.
- `src/app/layout.tsx` — real `metadata` (title "Car Deal Flow", real description).
- `prisma/seed.ts` — seed one active `BuyingGoal` (see §8) so the app works after
  `npm run db:seed`.

**Framework-version guard:** per `AGENTS.md`, read the relevant App-Router docs in
`node_modules/next/dist/docs/` (server actions, dynamic route params, metadata)
before writing route/action code — this Next.js may differ from training data.

### 7. Pipeline dedup refactor

- Consolidate into `scripts/ingestion/lib/parse-common.ts` (single source of truth):
  body-type inference (`inferBodyType`), `BRAND_ALIASES` + `normalizeBrand`,
  seller-type detection. Delete the duplicate copies in `bidchain-parse.ts` and
  `mgl-*`.
- Delete `scripts/ingestion/mgl-harvest-write.ts` if confirmed superseded by the
  modular `mgl-list-auctions.ts` + `mgl-harvest.ts` (verify no importer first).
- Keep behavior identical; update/extend tests to cover the shared helpers.

### 8. Seed — active buying goal (owner-supplied)

```
name: "Primary buy — prefer T-Cross / Nivus / HR-V / BYD / RAV4"
active: true
budgetMinBRL: 60_000
budgetMaxBRL: 1_000_000
minYear: 2021
maxMileageKm: 90_000
preferredBodyTypes: ["hatch", "sedan", "suv"]
preferredBrands: []          // "any brand" — no penalty for others
excludedBrandsModels: []
familySpaceRequired: false
fuelEconomyThresholdKmL: 10
minResaleLiquidityScore: 50
requiredFeatures: []
```

**Open note:** the schema has no "preferred models" field and the owner wants *any
brand*, so target models (T-Cross, Nivus, HR-V, BYD, RAV4) are recorded in `name`
only and do not affect scoring. Owner can adjust post-seed.

### 9. Build / test / CI hygiene

- `package.json`: add `playwright`, `playwright-extra`, `puppeteer-extra-plugin-stealth`
  to dependencies (pin to installed-compatible versions).
- Fix `list-targets.test.ts`: unique `sourceUrl` per fixture car.
- Add `.github/workflows/ci.yml`: on push/PR → `npm ci` → `npm run build` →
  `npm test` → `npm run lint`.
- Run `npm audit fix` (non-breaking only; breaking upgrades to next/prisma are out
  of scope and flagged separately).

---

## Data flow (target)

```
SQLite ──Prisma(db.ts)──▶ aggregate.ts (getAllBundles/getBundle)
                              │  builds CarBundle via scoring/* + FIPE
                              ▼
      page.tsx (server) ─▶ KanbanBoard / CarsTableView
      cars/[id]/page.tsx ─▶ CarDetailTabs
                              │  user actions
                              ▼
      actions/{pipeline,fipe-sync} ─▶ Prisma write ─▶ revalidatePath
```

## Testing strategy

| Level | What |
|---|---|
| Unit | `computeRiskScore` (severe floor, empty=100), `computeConditionScore` (uninspected excluded, empty=50), `computeMarketAssessment` (null-FIPE → unavailable; verdict bands), `computeDecision` (**weight renormalization when valueScore null**, severe-risk gate, manual override) |
| Unit | `fipe.ts` fail-closed: ambiguous/no match → `FipeError` (mocked fetch); never returns a guessed number |
| Unit | dedup helpers in `parse-common.ts` after consolidation |
| Fixture | existing source-parser tests keep passing after dedup refactor |
| Build | `npm run build` typecheck green (routes + all `src/**`) |
| Smoke | seed goal → `getAllBundles()` returns without throwing on empty and non-empty DB |

**Acceptance:** `npm run build`, `npm test`, and `npm run lint` all pass locally
and in the new CI workflow. Home route renders the pipeline; a car detail route
renders tabs; FIPE sync button persists a real value or fails to null.

## Risks & mitigations

- **FIPE API shape/availability** — treat as untrusted: fail closed to null, never
  block a render on it; server action returns a tagged error, never throws to UI.
- **Scoring semantics drift** — types constrain shapes but not exact formulas;
  keep formulas simple, documented, and unit-tested so behavior is legible.
- **Dedup refactor regressions** — land it behind the existing parser fixture tests;
  no behavior change intended.
- **Next.js version differences** — mitigated by reading the bundled docs first.

## Rollout

Single feature branch `ui-reconstruction`; incremental commits per layer
(infra → scoring → fipe → actions → ui → routes → seed → dedup → CI). Verify
build+test+lint green before finishing.
