# Auction date capture + expired-listing soft delete — design

## Problem

Harvested auction leads never capture *when* the auction actually happens, and
lots that have already closed stay mixed in with live inventory forever —
`parked`/`rejected` are the only "deprioritized" states, and neither means
"this auction is over." The owner has no way to tell a live lot from a dead
one without opening each listing. This adds auction-date capture across all
four harvest sources plus an automated soft-delete (`expired` pipeline stage)
for lots whose auction date has passed.

## Data model changes

### 1. `CarSource.auctionDate` (new, nullable)

Auction date is **per-source**, not per-car: the same physical lot can be
listed by two leiloeiras (e.g. Bradesco Vitrine + VIP Leilões) with different
auction dates. `Car` stays the merged/display record; `CarSource` already
holds per-origin metadata (`firstSeenAt`, `lastSeenAt`, `editalUrl`) so
`auctionDate` belongs there too.

```prisma
model CarSource {
  ...
  auctionDate DateTime?   // when this leiloeira's auction happens; null = not confidently extracted
}
```

Requires a Prisma migration (`prisma migrate dev`) — the only schema-level
change in this design.

### 2. `PipelineStage` gains `"expired"`

`pipelineStage` on `Car` is a plain `String` column (not a Prisma enum), so
adding a new valid value is a `types.ts`-only change, no migration needed for
this part.

```ts
// src/lib/types.ts
export type PipelineStage =
  | "new_lead"
  | "researching"
  | "waiting_docs"
  | "inspected"
  | "negotiating"
  | "approved"
  | "parked"
  | "rejected"
  | "expired"   // new
  | "bought";

export const PIPELINE_STAGES = [
  ...existing...,
  { id: "expired", label: "Expired" },
  { id: "bought", label: "Bought" },
];
```

`ACTIVE_PIPELINE_STAGES` is **not** changed — `expired` is simply never added
to it. This means `src/lib/priority.ts`'s existing `ACTIVE_PIPELINE_STAGES`
filtering automatically excludes expired cars from the priority-review list
with zero code changes there.

## Expiry rule

A `Car` is eligible to expire only when **every** `CarSource` row belonging to
it has a **non-null** `auctionDate` that is in the past. A source with
`auctionDate: null` (date not confidently extracted at harvest time) blocks
expiry for the whole car — this codebase's existing pattern is to never guess
against missing data (see `mileageKm`/`fipeValueBRL` null-handling), and an
unknown auction date is exactly that kind of gap, not evidence the auction is
over.

New helper module `src/lib/auction.ts`:

```ts
/** Soonest known future auction date across a car's sources, or null if none/all unknown. */
export function getNextAuctionDate(sources: { auctionDate: Date | null }[]): Date | null;

/** True only if every source has a non-null auctionDate in the past. */
export function isFullyExpired(sources: { auctionDate: Date | null }[]): boolean;
```

**Scope of the auto-expire sweep:** only cars with `pipelineStage` in
(`new_lead`, `parked`) are eligible — matches the existing scoping of
`apply-goal-filter.ts`. Cars already advanced past that (researching, waiting
docs, inspected, negotiating, approved, bought) are never auto-expired: the
owner is already engaged with those and should move them manually if an
auction falls through. `rejected` and `expired` are excluded (already
terminal/soft-deleted).

## `write-lead.ts` changes

- `WriteLeadInput` gains `auctionDate?: Date | null`. CLI flag: `--auction-date
  <ISO-8601>` (e.g. `--auction-date 2026-08-01T14:00:00-03:00`). Omitted or
  unparseable → `null`, never estimated.
- Stored on the `CarSource` row (create via `upsertCarSource`, and refreshed
  on every re-harvest of that source — an auction can get rescheduled).
- `RESETTABLE_STAGES` gains `"expired"`. If a car currently `expired` is
  re-harvested and the incoming (or any existing) source now has a future
  `auctionDate`, it resets to `new_lead` and clears `stageReason` — identical
  mechanism to the existing `parked → new_lead` reset, since auctions do get
  relisted/postponed.

## New script: `scripts/ingestion/expire-stale-leads.ts`

Deterministic, no LLM judgment involved — pure date arithmetic against stored
data, same pattern as `apply-goal-filter.ts`.

- Query cars where `pipelineStage in ("new_lead", "parked")`, including their
  `sources`.
- For each, apply `isFullyExpired(car.sources)`. If true:
  - `pipelineStage: "expired"`
  - `stageReason`: a generated note listing the passed date(s), e.g.
    `"Auction date(s) passed: Bradesco Vitrine 2026-07-01, VIP Leilões 2026-07-03."`
- Nothing is deleted — `expired` cars stay fully queryable, matching the
  `parked`/`rejected` philosophy already established.
- CLI: `npx tsx scripts/ingestion/expire-stale-leads.ts`. Runnable standalone
  or as part of a harvest run.
- Idempotent: cars already `expired` are out of scope (not `new_lead`/
  `parked`), so re-running the sweep is always safe.

## Harvest skill updates (all four)

`harvest-auction-leads`, `harvest-bidchain`, `harvest-leiloes-pb`,
`harvest-mgl` each get:

1. A new extraction step: capture the auction date/time from the listing page
   (or edital PDF if the page doesn't state it), pass it through
   `--auction-date`.
2. A new confidence-rule row: *"Auction date not stated or ambiguous on page/
   edital → `auctionDate: null`. Never guess a date."*
3. Their "after harvesting" step gets `expire-stale-leads.ts` appended after
   `apply-goal-filter.ts`, so every harvest run also sweeps stale leads.

## UI changes

- **`cars-table-view.tsx`**: the Stage filter dropdown already lists all
  `PIPELINE_STAGES` (will include the new "Expired" option automatically). The
  default (`stage === "all"`) filter predicate changes to exclude `expired`
  unless the user explicitly selects it — a one-line change, so expired
  listings don't clutter the default view but stay reachable on demand.
- **`kanban-board.tsx`**: currently renders **all** `PIPELINE_STAGES` as full
  columns with no hide/collapse logic (confirmed — this is also true for
  `parked`/`rejected` today, so this is new behavior specific to `expired`,
  not a regression of existing patterns). New constant:
  ```ts
  export const KANBAN_STAGES = PIPELINE_STAGES.filter(s => s.id !== "expired");
  ```
  The board maps over `KANBAN_STAGES` instead of `PIPELINE_STAGES` so expired
  cars get no visible column. The per-card "move to stage" `<Select>` keeps
  listing all stages (including Expired), so a car can still be manually
  marked expired without waiting for the sweep.
- **Optional, small**: a "Next auction" display (using `getNextAuctionDate`)
  on the cars table and/or car detail page, so a live lot's upcoming date is
  visible at a glance.

## Testing

- `write-lead.ts`: `auctionDate` persists onto `CarSource` on create and
  refresh; `expired → new_lead` revival when a future date is reported.
- `expire-stale-leads.ts`: single source with a past date → expires; any
  source with a future or null date → stays active; only touches
  `new_lead`/`parked`, leaves other stages untouched; idempotent re-run.
- `src/lib/auction.ts`: unit tests for `getNextAuctionDate`/`isFullyExpired`
  covering empty sources, all-null, mixed past/future/null, all-past.
- UI: `cars-table-view` default-filter exclusion of `expired`; `kanban-board`
  renders `KANBAN_STAGES` (no Expired column).

## Resolved decisions

| Question | Decision |
|---|---|
| Expiry trigger | Auction date passed (not delisting detection) |
| Where auction date lives | Per-source, on `CarSource` |
| Soft-delete representation | New `PipelineStage: "expired"` |
| Sweep scope | Only `new_lead`/`parked` — advanced stages never auto-expire |
| Multi-source expiry rule | All known sources' dates must be past; unknown dates block expiry |
| Harvest scope | All 4 existing harvest skills updated together |
| Revive on re-harvest | Yes — `expired` added to resettable stages |
| Sweep trigger | New standalone script, chained after `apply-goal-filter.ts` in each harvest skill |
| UI treatment | Hidden from kanban/default list, visible via explicit stage filter |
