# UI Plan — Scaling the "All Vehicles" View

> Design plan (no build yet). Grounded in `ui-ux-pro-max` design intelligence ("Data-Dense Dashboard" style) + the current code in `src/components/cars/cars-table-view.tsx` and `src/app/cars/page.tsx`.

## Problem

The aggressive-ingestion harvesters will push the pipeline from hundreds of cars to **tens of thousands** (NaPista alone ≈53k below-FIPE listings). The current view does not scale:

1. **`src/app/cars/page.tsx`** calls `getAllBundles()` — loads **every** car, computes a decision/score for each, and ships the full set to the browser.
2. **`cars-table-view.tsx`** filters + sorts the entire array client-side in `useMemo`, then renders **one `<TR>` per filtered row** (no pagination, no virtualization).
3. Filters are client-only, **not in the URL** — no sharing, no back/forward, state lost on reload.

At 53k rows this means a multi-MB payload, tens of thousands of decision computations per request, and thousands of DOM nodes — the page will hang.

## Design direction (from ui-ux-pro-max)

- **Style:** *Data-Dense Dashboard* — minimal padding, grid layout, space-efficient, status colors (green/amber/red), tabular figures for numbers. Filtering is mandatory ("No filtering" is an explicit anti-pattern).
- **Relevant rules:** `virtualize-lists` (50+ items), `deep-linking` (URL reflects filter state), `state-preservation` (restore scroll/filters on back), `empty-states`, `sortable-table` (aria-sort), `debounce-throttle` (search input), `number-tabular` (prices/deltas), `progressive-loading` (skeleton >1s), `bulk-actions` (multi-select triage), responsive `Table Handling` (card layout on mobile), `color-not-only` (badges carry icon+text, not color alone).

## Architecture change (the real fix): server-side filter + paginate

Move filtering, sorting, and pagination to the **server**, driven by URL search params.

### 1. Data layer — `src/lib/aggregate.ts`
Add `getBundlesPage(params)` alongside `getAllBundles`:
```
getBundlesPage({ page, pageSize, q, brand, stage, phase, sourceChannel,
                 confidence, state, verdict, priceMin, priceMax,
                 belowFipePct, sort }) → { rows: CarBundle[], total: number, facets }
```
- Translate params into a Prisma `where` + `orderBy` + `skip`/`take`. Push everything expressible in SQL down to the DB (brand, stage, dealPhase, sourceChannel, confidence, state, price range, year, mileage, text search on brand/model/city).
- **Scoring caveat:** `finalScore`/`verdict` are computed in `aggregate`, not stored. Two options — call this out for the human:
  - **(A, recommended)** Persist `finalScore` + `verdict` as columns on `Car` (written at harvest/goal-filter time), so sort-by-score and verdict filter become SQL. Cleanest for scale.
  - **(B, interim)** Keep scoring in memory but only over the *paginated + pre-filtered* SQL result; disable server sort-by-score until (A) lands (offer score sort only within the current page). Ships now, weaker at scale.
- Return lightweight `facets` (counts per phase/channel/verdict/confidence) via `GROUP BY` for filter badges.

### 2. Page — `src/app/cars/page.tsx`
- Read `searchParams` (Next.js server component), pass to `getBundlesPage`. Keep `force-dynamic`.
- Render a `<Suspense>` skeleton while the page query runs.

### 3. URL as source of truth
- Every filter/sort/page → a query param (`?phase=market&channel=aggregator&state=SC&sort=score&page=2`).
- Filter controls become client components that `router.push` updated params (shallow), debounced for the text search. Back/forward and sharing "just work"; scroll/state preserved via URL.

## UI layout

```
┌───────────────────────────────────────────────────────────────────────┐
│  All Vehicles                                   [FIPE Sync]  [Columns ▾]│
│  1,240 of 53,204 vehicles · Region: SC ✕  Phase: Market ✕  Clear all    │  ← active-filter chips
├───────────────────────────────────────────────────────────────────────┤
│ [🔍 Search…]  Brand▾  Phase▾  Channel▾  Confidence▾  State▾  Verdict▾  … │  ← primary filter bar
│                                              [ More filters ▾ ]          │  ← price/FIPE-delta/year/km/stage
├───────────────────────────────────────────────────────────────────────┤
│ ☐ Vehicle ▲▼ │ Year/KM │ Price ▲▼ │ FIPE Δ ▲▼ │ Loc │ Phase │ … │ Score ▲▼│  ← sticky, sortable header
│ ☐ …rows (server page, ~50)…                                             │
├───────────────────────────────────────────────────────────────────────┤
│  ‹ Prev   Page 2 of 1,065   Next ›        Rows: [50 ▾]                   │  ← pagination
└───────────────────────────────────────────────────────────────────────┘
```

- **Primary filter bar** (always visible): Search, Brand, Phase, Source channel, Confidence, State/Region, Verdict, Sort. Keep the existing controls; add `sourceChannel`, `confidence`, `state`, and a **FIPE-delta** filter (`preco/fipe` %-below-FIPE — the core value signal for this pipeline).
- **"More filters" drawer** (progressive disclosure): price min/max, year, mileage, pipeline stage, urgency — collapsed by default so the bar stays scannable.
- **Active-filter chips** row: each active filter as a dismissible chip + "Clear all" — visible state of what's applied.
- **New/updated columns:** add a **FIPE Δ%** column (tabular-nums, color-coded green deeper-below-FIPE); keep Phase/Confidence/Verdict badges. A **Columns ▾** toggle lets the user hide columns for density.
- **Sortable headers:** click to sort, `aria-sort` on the active column, ▲▼ affordance (Vehicle, Price, FIPE Δ, Year, KM, Score).
- **Row rendering:** server pagination (~50/page) is the default; if a "load more"/infinite mode is added later, wrap the body in a virtualizer (`@tanstack/react-virtual`) per `virtualize-lists`.
- **Region-first affordance:** since the buyer is in **SC** and prioritizes southern cars, default the State filter to remember last choice and surface SC/PR/RS first in the dropdown.

## States

- **Loading:** skeleton rows (not a blocking spinner) while the server page resolves (`progressive-loading`).
- **Empty:** "No vehicles match these filters." + a "Clear filters" action (`empty-states`).
- **Mobile (<768px):** collapse the table to a **card layout** (one card per car with the key fields) instead of horizontal-scrolling a 9-column table (`Table Handling`); filters collapse into a "Filters" sheet.

## Accessibility & performance checklist (from the skill)

- Contrast ≥4.5:1 for text, ≥3:1 for badges; badges carry icon/text, not color alone.
- Sortable headers expose `aria-sort`; filter chips are keyboard-dismissible; focus rings visible.
- Search input debounced (~250ms); avoid layout shift when results swap (reserve row height).
- `prefers-reduced-motion` respected on any filter/expand transitions (150–300ms otherwise).
- `tabular-nums` on Price / FIPE Δ / Score / KM so columns don't jitter.

## Suggested implementation phases (when built)

1. **Server pagination + URL params** (page.tsx + `getBundlesPage`, SQL-pushable filters) — the load-bearing fix; keeps current columns.
2. **New filters** (sourceChannel, confidence, state, FIPE-delta) + active-filter chips + facet counts.
3. **Sortable headers + FIPE Δ column + Columns toggle.**
4. **Score/verdict to SQL** — persist `finalScore`/`verdict` (Option A) to make score sort/filter scale; migration + write at goal-filter time.
5. **Mobile card layout + skeleton loading + bulk-select triage.**

## Open decisions for the human

1. **Score/verdict persistence (Option A vs B)** — persist computed score to enable SQL sort at scale, or keep interim in-memory sort within a page? (A recommended.)
2. **Pagination vs infinite-scroll+virtualization** — classic pager is simpler and deep-linkable; infinite scroll feels modern but complicates URL state. (Pager recommended for an internal triage tool.)
3. **Default page size** (50?) and whether to default-filter to the buyer's region (SC) on first load.
