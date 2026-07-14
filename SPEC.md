# Spec: Multi-source auction ingestion (v2)

Living spec for expanding Car Deal Flow beyond Bradesco Vitrine + VIP Leilões.
Companion history: `docs/superpowers/specs/2026-07-14-auction-lead-ingestion-design.md` (v1).

**Status:** Decisions locked; plan in `tasks/plan.md` / `tasks/todo.md` — awaiting owner OK to implement.

---

## Objective

Build a **high-quality, fail-closed ingestion pipeline** that pulls distress /
repossession / auction inventory from additional Brazilian sources into the
existing triage flow (`write-lead` → `apply-goal-filter` → Pipeline UI), so the
owner sees **good-fit deals quickly** without duplicate noise.

**User:** single owner (personal decision-support app).

**Not in this scope:** placing bids from the app, automated bidding, purchase
flows, or unattended scheduled harvests (may follow later).

### User stories

1. As the owner, I can harvest **BIDchain / Caixa-channel**, **Leilões PB**, and
   **MGL** lots into the same pipeline as Bradesco/VIP, with the same confidence
   rules (no guessed brand/model/year/price/bodyType).
2. As the owner, when the same vehicle appears on two houses, I see **one car**
   with multiple source links — not two competing rows.
3. As the owner, after a harvest I get a clear summary (written / skipped /
   merged / parked / rejected) and can open Pipeline to act on `new_lead`s.

### Acceptance criteria

- [ ] **Per-source** harvest skills cover BIDchain (Caixa-accredited channel), Leilões PB, and MGL.
- [ ] Each source uses the established trust boundary: extract → `write-lead.ts`
      (or a thin source adapter that calls the same write path).
- [ ] Missing required fields → skip + log reason; never invent body type or price.
- [ ] Cross-source dedup: same chassis (preferred) or normalized plate merges into
      one `Car`; secondary source URLs retained. **First source seen wins** the
      primary `sourceUrl` / `sourcePlatform` shown in UI.
- [ ] Goal filter still soft-triages (`new_lead` / `parked` / hard `rejected` on exclusions).
- [ ] No bidding UI or bid-placement code ships in this phase.
- [ ] `npm test` and `npm run build` pass after implementation.

---

## Tech Stack

| Layer | Choice |
|---|---|
| App | Next.js 16 (App Router), React 19, TypeScript |
| DB | Prisma 7 + SQLite (`@prisma/adapter-better-sqlite3`) |
| Harvest I/O | `tsx` scripts under `scripts/ingestion/`; Playwright (+ stealth) only when SPA/Cloudflare requires a saved owner session |
| Tests | Vitest |
| Skills | Claude/Cursor skills under `.claude/skills/` (procedure docs, not runtime) |

Reuse v1 patterns: Bradesco JSON API where available; VIP-style
`*-login.ts` + `*-fetch.ts` when public HTML is insufficient.

---

## Commands

```bash
# App
npm run dev
npm run build
npm test
npm run lint

# DB
npm run db:migrate
npm run db:studio

# Existing ingestion (v1)
npx tsx scripts/ingestion/write-lead.ts --help
npx tsx scripts/ingestion/apply-goal-filter.ts --min-goal-fit 50
npx tsx scripts/ingestion/vip-leiloes-login.ts   # human-only
npx tsx scripts/ingestion/vip-leiloes-fetch.ts "<url>" --out /tmp/lot.html

# v2 (to be added — names indicative)
# BIDchain: public fetch only (no login) — confirmed 2026-07-14
npx tsx scripts/ingestion/bidchain-fetch.ts "<url>" --out /tmp/lot.html
npx tsx scripts/ingestion/apply-goal-filter.ts --min-goal-fit 50
# Dedup/merge lives in write-lead via CarSource (first-wins primary)```

Harvest orchestration remains skill-driven (agent or human runs sources, then filter).

---

## Project Structure

```text
scripts/ingestion/
  write-lead.ts              # trust boundary (extend for multi-source / merge)
  apply-goal-filter.ts
  vip-leiloes-*.ts           # v1 VIP session fetch
  bidchain-*.ts              # v2 — BIDchain/Caixa channel
  leiloes-pb-*.ts            # v2 — or HTML parsers if fully public
  mgl-*.ts                   # v2
  dedupe-leads.ts            # optional if merge lives outside write-lead
  __tests__/                 # vitest for write/merge/dedupe/filter

.claude/skills/
  harvest-auction-leads/     # v1 Bradesco + VIP (keep)
  harvest-bidchain/          # v2 per-source
  harvest-leiloes-pb/        # v2 per-source
  harvest-mgl/               # v2 per-source
  # shared dedup rules live in write-lead / CarSource — skills only orchestrate

prisma/schema.prisma         # Car + possible CarSource / sourceUrls JSON
src/lib/scoring/             # unchanged triage semantics unless dedup needs helpers
src/app/pipeline/            # show multi-source links when present
docs/superpowers/specs/      # v1 design (historical)
SPEC.md                      # this file (v2 living spec)
```

---

## Code Style

Follow existing ingestion scripts: typed inputs, fail-closed validation, JSON
line output from CLIs, no silent defaults for body type / price / year.

```ts
// Good: merge when identity is strong; otherwise insert
if (chassis && existingByChassis) {
  return mergeSourceIntoCar(existingByChassis, incoming);
}
if (normalizedPlate && existingByPlate) {
  return mergeSourceIntoCar(existingByPlate, incoming);
}
// Same sourceUrl → update in place (already true via @@unique)
return createCar(incoming);

// Bad: guess identity from brand+model+year+price alone
```

**Conventions**

- CLI flags kebab-case (`--source-url`, `--body-type`).
- `askingPriceBRL` = lance mínimo; stamp that semantics in notes.
- `sellerType: caixa_recovery` only when Caixa is explicit; named bank →
  `bank_recovery`; else `auction`.
- Source platform strings stable: `"BIDchain"`, `"Leilões PB"`, `"MGL"`,
  `"Bradesco Vitrine"`, `"VIP Leilões"`.

---

## Testing Strategy

| Level | What |
|---|---|
| Unit | Dedup key normalization (plate/chassis); merge preserves researching+ stages; skip reasons |
| Unit | `write-lead` create vs update vs merge; `caixaApplicable` sync |
| Fixture | Saved HTML/JSON per source (sanitized) → parser extracts expected fields or skips |
| Regression | `apply-goal-filter` still parks / rejects correctly with multi-source cars |
| Manual | One live harvest per new source → ≥ N confident writes + summary |

Coverage expectation: new merge/dedup paths have tests before merge to main workflow.
Do not add brittle live network tests in CI.

---

## Boundaries

### Always

- Fail closed on ambiguous body type / missing price / missing URL.
- Prefer API or edital PDF over fragile HTML when both exist.
- Preserve owner notes and non-resettable pipeline stages on re-harvest
  (same rules as v1 `write-lead`).
- Run `npm test` after ingestion logic changes.
- Keep bidding / purchase actions out of the app.

### Ask first

- Adding npm dependencies beyond current Playwright stack.
- Changing goal-filter thresholds or hard-reject rules.
- Any automation that runs harvests unattended on a schedule.
- Expanding into true bid placement later.
- Raising or removing the 1000 writes/source/run safety ceiling.

### Never

- Place bids or register interest on the owner’s behalf.
- Store owner passwords in repo or logs (session files gitignored only).
- Invent FIPE, mileage, or chassis to force a write.
- Dedup on weak signals alone (brand+model+year without plate/chassis).
- Scrape behind login by asking the owner for their password in chat.

---

## Sources (v2)

| Priority | Source | Notes |
|---|---|---|
| 1 | **BIDchain** (`bidchain.com.br`) — Caixa channel | **Confirmed 2026-07-14:** listings + lot detail fully public; login only to bid. No VIP-style session. Plain Playwright/`domcontentloaded` enough. Caixa lots often hosted on white-label domains (e.g. `adrileiloes.com.br` Leilão 657); vehicle category also includes judicial inventory — tag `sellerType` from comitente, don’t assume Caixa. |
| 2 | **Leilões PB** (`leiloespb.com.br`) | Public catalog expected; regional; fill gaps VIP misses. Confirm with a short probe at implement time. |
| 3 | **MGL** (`mgl.com.br`) | Public catalog expected; regional. Confirm with a short probe at implement time. |

v1 sources (Bradesco, VIP Financeiras) remain supported and should keep working.

**Volume:** no hard product cap. Prefer filtering by active buying goal during
harvest when cheap; otherwise allow large runs with a **safety ceiling of 1000
writes per source per run** (skip/log past that so a runaway loop can’t fill the DB).

**Deferred beyond v2:** in-app bidding, bid reminders, scheduled unattended harvests,
other leiloeiras, ML-based fuzzy dedup without plate/chassis.

---

## Cross-source dedup

### Identity strength (strong → weak)

1. **Chassis** (VIN / chassi) — strongest; merge when equal after normalization.
2. **Plate** — merge when normalized plates equal (strip spaces/hyphens; casefold).
3. **`sourceUrl`** — unique; re-harvest updates same row (existing).
4. **Do not merge** on brand+model+year+price alone.

### Merge behavior

- Keep a single `Car` row (canonical = earliest created or highest pipeline stage).
- Attach additional sources (URL + platform + optional edital URL + fetchedAt).
- **Primary link rule (locked):** the **first** source that created the row keeps
  `Car.sourceUrl` / `Car.sourcePlatform`. Later sources only append to `CarSource`.
- On conflict of scalar fields: prefer non-null; if both non-null and disagree,
  keep existing scalars and append a note (`Source X disagrees on mileage: …`).
- Never downgrade `researching` / later stages back to `new_lead` solely because
  a second source was seen (same resettable-stage rules as v1).

### Schema decision: `CarSource` table (not JSON)

**Chosen:** relational `CarSource` child table.

| | `CarSource` table | JSON `sourceUrls` on `Car` |
|---|---|---|
| Query | Easy (“all BIDchain cars”, unique URL across sources) | Awkward / full-table scan |
| Integrity | `sourceUrl @unique`, FKs, cascade | App-enforced only |
| UI | Join / include cleanly | Parse JSON in every reader |
| Migrations | Explicit, reviewable | Faster first PR, debt later |
| Cost | One migration + small write-lead change | Smaller diff now |

JSON is fine for throwaway prototypes; we already have multi-source identity and
Pipeline UI needs, so the table pays for itself immediately.

```prisma
model CarSource {
  id             String   @id @default(cuid())
  carId          String
  car            Car      @relation(fields: [carId], references: [id], onDelete: Cascade)
  sourceUrl      String   @unique
  sourcePlatform String
  editalUrl      String?
  firstSeenAt    DateTime @default(now())
  lastSeenAt     DateTime
  @@index([carId])
}
// Car.sourceUrl / sourcePlatform = first-wins primary; never overwritten by merge.
```

---

## Success Criteria

1. Owner can run (or agent-run via skill) harvests for BIDchain, Leilões PB, and MGL
   and land confident lots in SQLite with real source URLs.
2. A vehicle listed on VIP and BIDchain with the same chassis appears **once** in
   Pipeline, with both links visible.
3. Skip log explains every discarded lot (no silent drops).
4. Time-to-signal: after harvest + filter, `new_lead` list is usable the same day
   (no manual re-entry).
5. Bidding remains absent; app stays decision support only.
6. Tests cover dedup/merge; build green.

---

## Decisions log (2026-07-14)

| # | Question | Decision |
|---|---|---|
| 1 | Schema | **`CarSource` table** (see comparison above) |
| 2 | BIDchain login | **Not required for browse/detail** — login only to bid. Public HTML harvest. Probe: [BIDchain access report](33631db9-2100-40dc-9944-ffb83287b1b9) |
| 3 | Primary link when merged | **First source wins** |
| 4 | Skills | **Per-source** (`harvest-bidchain`, `harvest-leiloes-pb`, `harvest-mgl`) |
| 5 | Volume | No product cap; filter by goal when cheap; **safety ceiling 1000 writes/source/run** |

---

## Out of scope (explicit)

- In-app bidding, max-bid tracking, or “register lance” automation.
- Scheduled/cron harvests.
- Changing scoring weights except as required for null-safe multi-source data.
- Mobile apps / multi-user auth.
