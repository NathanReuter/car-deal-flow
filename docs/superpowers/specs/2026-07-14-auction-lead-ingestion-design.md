# Auction/repossession lead ingestion — design

## Problem

Every car currently in Car Deal Flow was entered manually (originally as
mock data, then replaced with 4 real comparison candidates by hand). That's
backwards from the product's actual purpose: the highest-opportunity,
highest-risk segment — debt-driven repossession and auction sales (Caixa,
bank repossession programs) — is exactly what this app's scoring model was
built to triage (below-market pricing, elevated documentation/condition
risk). The app should find these cars, not wait for them to be typed in.

## Research summary (informs scope below)

Live verification plus a Perplexity research pass established:

- **Caixa doesn't run its own vehicle catalog.** It delegates to accredited
  leiloeiras (auction houses) that rotate by contract. The primary 2026
  channel is Adri Leilões + BIDchain (`bidchain.com.br`) — a dynamic
  SPA, category counts public, full lot detail likely needs a free account.
- **Most sources don't actually need login to browse.** Bradesco's own
  portal (`vitrinebradesco.com.br`), Leilões PB (`leiloespb.com.br`), and
  MGL (`mgl.com.br`) all show full public catalogs with no account —
  login is only required to bid, not to browse. This is a materially
  simpler starting point than the gov.br pattern used for risk-checks,
  where login was unavoidable even for read access.
- **Bradesco Vitrine is backed by a JSON API**, not just server-rendered
  HTML — confirmed by an existing third-party Apify scraper actor built
  against it, which proves the endpoint is discoverable and stable enough
  for someone else to have already automated it.
- **VIP Leilões (`vipleiloes.com.br`) aggregates multiple banks** —
  filtering by "Financeiras" surfaces Santander, Bradesco, and Caixa lots
  in one public, server-rendered feed. Better signal-to-effort than
  chasing each bank's site individually.
- **Edital PDFs are consistently public across every leiloeira** and
  contain structured data per lot — chassis, minimum bid, condition notes,
  debt responsibility — in document form. This is a more reliable
  extraction target than scraping bespoke per-site HTML/JS.
- No source's Terms of Use was found to explicitly prohibit automated
  access (not exhaustively confirmed for every source), and none require a
  CNPJ — free CPF-based registration is enough anywhere login is needed.

## Scope for v1

**Sources:**

| Source | Access | Why v1 |
|---|---|---|
| Bradesco Vitrine (`vitrinebradesco.com.br`) | Fully public, JSON API | Proven scrapable, no login, structured data |
| VIP Leilões (`vipleiloes.com.br`), filtered to "Financeiras" | Fully public, server-rendered HTML | Multi-bank sweep (Caixa + Santander + Bradesco) in one source |

**Explicitly deferred** (follow-up once v1 is proven): BIDchain/Caixa direct
(SPA, possibly login-gated for detail), Leilões PB, MGL (regional,
redundant with VIP Leilões's aggregation for now), cross-source
deduplication by chassis/plate, scheduled/unattended runs, automated
bidding or any transaction capability (this app is decision support only —
it never bids or purchases on the owner's behalf).

## Required data model change: `mileageKm` becomes optional

Auction/repossession listings frequently **don't disclose mileage** —
common for repossessed vehicles where the odometer history itself is part
of the risk picture, not just an omission. The current schema requires
`mileageKm: Int` (non-null) on `Car`, which would force either fabricating
a number or discarding otherwise-good leads. Neither is acceptable.

**Schema change** (`prisma/schema.prisma`):
```prisma
model Car {
  // ...
  mileageKm Int?   // was: Int
  // ...
}
```

**Type change** (`src/lib/types.ts`):
```ts
export interface Car {
  // ...
  mileageKm: number | null;   // was: number
  // ...
}
```

**Downstream consumers that must handle `null`:**
- `lib/scoring/goalFit.ts` — the "mileage under max" criterion must treat
  `null` as **failed** (not exempt, not a crash) — an unknown mileage is a
  goal-fit gap worth surfacing, not an ignorable field.
- `lib/scoring/market.ts` — `computeResaleLiquidityScore`'s
  `isLowMileage` check must treat `null` as `false` (unknown mileage
  doesn't get the liquidity bonus).
- `lib/format.ts` — `formatKm` needs a null-safe caller path; display
  "Not disclosed" rather than "null km" or crashing.
- The seeded risk checklist's `mileage_inconsistency` item should default
  to `status: "warning"` (not `"pending"`) when mileage is undisclosed at
  ingestion, with a note flagging it explicitly as a risk factor, since an
  undisclosed odometer on a repossessed vehicle is itself a real signal —
  this is a deliberate exception to the "everything starts pending"
  pattern used elsewhere, because here the absence of data *is* the
  finding, not a placeholder for a finding not yet made.
- This requires a Prisma migration (`prisma migrate dev`), unlike the
  provenance-fields change in the risk-check-sync work, which was a JSON
  blob field and needed none.

## Architecture

Same split as `sync-risk-checks`: deterministic scripts own DB I/O and
validation; a skill owns judgment (reading pages, extracting structured
data, deciding what's confident enough to write).

### `.claude/skills/harvest-auction-leads/SKILL.md`

Agent-driven — auction sites don't expose a clean, documented API the way
FIPE does, so extraction requires reading rendered pages (and, where
available, edital PDFs) and judging what's real.

Procedure per source:
1. Navigate to the source's vehicle listing/category page (no login
   needed for either v1 source — browse as a normal anonymous visitor).
2. For Bradesco Vitrine specifically: first inspect network requests to
   identify the underlying JSON API endpoint (the existence of a working
   third-party scraper confirms one exists) and prefer calling it directly
   over parsing rendered HTML — more stable, faster, less brittle.
3. For each lot: extract brand, model, trim (if stated), year, mileage (if
   disclosed — leave `null` if not, never estimate), minimum bid (→
   `askingPriceBRL`), photos, source URL, and the edital PDF link if one
   exists.
4. If an edital PDF is linked, read it — it's the more reliable source for
   chassis, plate, minimum bid, and condition/debt notes. Where the PDF and
   the page disagree, prefer the PDF and note the discrepancy.
5. Infer `sellerType`: `"caixa_recovery"` if the lot is explicitly
   attributed to Caixa, `"bank_recovery"` if attributed to a named bank
   (Bradesco, Santander, etc.), `"auction"` otherwise. Never guess a
   specific bank/Caixa attribution that isn't clearly stated on the page
   or edital — default to the generic `"auction"` when unclear.
6. Write each confident lot via `write-lead.ts` (below). Skip (don't
   write, log why) anything missing a required field.

After harvesting both sources, run `apply-goal-filter.ts`, then report a
summary: lots found per source, written, skipped (with reasons), passed
the goal filter, auto-rejected (with the failed criteria).

### `scripts/ingestion/write-lead.ts`

Deterministic, validated — the trust boundary between agent extraction and
the database, same role `write-result.ts` plays for risk-checks.

- Required: `brand`, `model`, `year`, `askingPriceBRL`, `sourceUrl`,
  `sourcePlatform`, `sellerType`. Refuses (throws, doesn't write) if any
  are missing — this is where "don't guess" gets enforced in code, not
  just in the skill's instructions.
- Optional: `trim`, `mileageKm` (nullable per the schema change above),
  `plate`, `chassis`, `photos`, edital PDF URL (stored as an `Attachment`
  with `kind: "document"`).
- **Deduplication:** before creating, checks for an existing `Car` with the
  same `sourceUrl`. If found, updates it in place (price/status may have
  changed since a previous harvest run) rather than creating a duplicate.
  Known limitation, accepted for v1: the same physical lot appearing on
  both VIP Leilões and Bradesco Vitrine (VIP aggregates Bradesco too) will
  still create two separate records, since dedup is by URL, not by
  chassis/plate (often redacted pre-purchase in these catalogs anyway).
  Cross-source dedup is deferred.
- Creates the car with `pipelineStage: "new_lead"`, plus a pending
  `RiskCheck` (13 items, `status: "pending"` — except
  `mileage_inconsistency`, which is `"warning"` when mileage is
  undisclosed, per the schema section above) and a `not_inspected`
  `ConditionReview`. Same honest-defaults pattern as the real-car
  ingestion already done manually.

### `scripts/ingestion/apply-goal-filter.ts`

Pure deterministic logic — reuses the **existing** `computeGoalFit` from
`lib/scoring/goalFit.ts`, nothing new to build for scoring itself.

- For every car in `pipelineStage: "new_lead"`: compute goal fit against
  the active `BuyingGoal`.
- If the goal-fit score is below a threshold (`--min-goal-fit`, default
  `50`), move the car to `pipelineStage: "rejected"` and set
  `overrideReason` to the joined list of failed criteria from
  `GoalMatch.failedCriteria`. Nothing is deleted — `rejected` cars stay
  queryable, just out of the active working set.
- Cars at or above the threshold are left in `new_lead` for the owner to
  review and manually promote to `researching`.
- CLI usage: `npx tsx scripts/ingestion/apply-goal-filter.ts [--min-goal-fit N]`.

## Confidence rules — never guess (extends the existing pattern)

| Situation | Behavior |
|---|---|
| Missing a required field (brand/model/year/price/URL) | Skip the lot entirely, log why. Never write a partial/guessed record. |
| Mileage not disclosed | Write with `mileageKm: null`; seed `mileage_inconsistency` as `"warning"`, not `"pending"` — the absence is itself the finding. |
| Ambiguous bank/Caixa attribution | Default `sellerType` to `"auction"` rather than guessing a specific source. |
| Page/API unreachable | Skip that lot, log it, don't retry indefinitely within a single run. |
| Edital PDF and page disagree | Prefer the PDF, note the discrepancy in `notes`. |
| Same `sourceUrl` seen again | Update the existing record in place, don't duplicate. |

## Testing

- `write-lead.ts` and `apply-goal-filter.ts`: unit tests against a seeded
  test SQLite DB (the existing `scripts/risk-checks/__tests__/test-db.ts`
  helper is reusable as-is), covering: required-field rejection, dedup by
  `sourceUrl`, mileage-null handling, and goal-filter threshold behavior
  (below/at/above threshold, `rejected` reason text).
- The harvest skill: not unit-testable (LLM reading live pages). Verified
  by a real dry run against both v1 sources, confirming: lots get written
  with correct field mapping, dedup works on a second run of the same
  source, and the goal filter correctly separates fits from non-fits.

## Open questions for review

- Is browser-driven/API-discovery extraction the right tradeoff long-term
  versus a hardcoded parser per source, given these sites can change
  markup or API shape without notice?
- Is a hard goal-fit threshold for auto-rejection the right default, or
  should borderline cars get a softer "deprioritized but still visible"
  treatment instead of leaving the active pipeline?
- Is Bradesco + VIP Leilões the right v1 pair, or does Caixa's direct
  channel (via BIDchain) need to be in scope from the start despite being
  harder to access?
- `mileageKm` going nullable is a real, non-trivial schema/scoring change
  — worth a second look given it touches goal-fit and market scoring, not
  just ingestion.
