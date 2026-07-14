# Implementation Plan: Multi-source auction ingestion (v2)

## Overview

Extend Car Deal Flow’s harvest pipeline beyond Bradesco + VIP: add **BIDchain**
(Caixa channel / white-label lots), **Leilões PB**, and **MGL**, with
**cross-source dedup** via a `CarSource` table (first source wins primary link).
No in-app bidding. Spec: `SPEC.md` (decisions locked 2026-07-14).

v1 plan (`tasks/plan.md` history / completed T1–T6) remains valid background;
this document replaces the active plan going forward.

## Architecture decisions

- **`CarSource` table** — not JSON; global unique `sourceUrl`; cascade on car delete.
- **First-wins primary** — `Car.sourceUrl` / `sourcePlatform` never overwritten by merge.
- **Dedup keys** — chassis (strongest) → normalized plate → same `sourceUrl` update; never brand+model+year alone.
- **Per-source skills** — `harvest-bidchain`, `harvest-leiloes-pb`, `harvest-mgl`; v1 skill stays for Bradesco/VIP.
- **BIDchain** — public HTML (no login session); follow white-label hosts (`adrileiloes.com.br`, etc.); tag `sellerType` from comitente.
- **Trust boundary** — all writes through `write-lead.ts`; fetch scripts are I/O only.
- **Volume** — prefer goal-aware skip when cheap; **safety ceiling 1000 writes/source/run**.

## Dependency graph

```
CarSource migration + backfill
    │
    ├── write-lead: upsert CarSource on create/update
    │       │
    │       ├── write-lead: merge by chassis/plate (first-wins)
    │       │       │
    │       │       └── tests (create / update / merge / no weak merge)
    │       │
    │       └── aggregate + types + car detail UI (multi-source links)
    │
    ├── bidchain-fetch.ts + harvest-bidchain skill (+ fixture parse)
    ├── leiloes-pb fetch/skill (after public-access probe)
    └── mgl fetch/skill (after public-access probe)
            │
            └── apply-goal-filter (unchanged semantics) + live harvest checkpoint
```

## Task list

### Phase 1 — Dedup foundation

#### Task 1: `CarSource` schema + backfill

**Description:** Add `CarSource` model and migration. Backfill one `CarSource` row
per existing `Car` from primary `sourceUrl`/`sourcePlatform`. Wire Prisma relation
on `Car`.

**Acceptance criteria:**
- [ ] `CarSource` matches SPEC (unique `sourceUrl`, `carId` index, cascade delete)
- [ ] Existing cars each have exactly one `CarSource` after migrate/backfill
- [ ] App still loads (`npm run build`)

**Verification:**
- [ ] `npx prisma migrate dev` applies cleanly
- [ ] `npm run build`
- [ ] Spot-check: `SELECT COUNT(*) FROM Car` equals `SELECT COUNT(*) FROM CarSource` post-backfill

**Dependencies:** None  
**Files likely touched:** `prisma/schema.prisma`, `prisma/migrations/*`, small backfill script or migration SQL  
**Estimated scope:** S

#### Task 2: `write-lead` always records `CarSource` + merge by identity

**Description:** Extend `writeLead` so every create/update upserts a `CarSource`
row. On new URL: if chassis or normalized plate matches an existing car, **merge**
(append source, fill null scalars, note disagreements) without changing primary
`sourceUrl`/`sourcePlatform` or non-resettable stages.

**Acceptance criteria:**
- [ ] Same `sourceUrl` → update car + bump `CarSource.lastSeenAt` (existing behavior + source row)
- [ ] New URL + matching chassis → merge into existing car; primary unchanged
- [ ] New URL + matching normalized plate (no chassis conflict) → merge
- [ ] New URL + no identity match → create car; primary = this source
- [ ] No merge on brand+model+year alone
- [ ] Result JSON indicates `created` | `updated` | `merged`

**Verification:**
- [ ] `npm test` — extend `scripts/ingestion/__tests__/write-lead.test.ts`
- [ ] Manual: two write-lead calls same chassis different URLs → one `Car`, two `CarSource`

**Dependencies:** Task 1  
**Files likely touched:** `scripts/ingestion/write-lead.ts`, `scripts/ingestion/__tests__/write-lead.test.ts`, optional `scripts/ingestion/identity.ts` for normalize helpers  
**Estimated scope:** M

#### Task 3: Show all sources in car detail UI

**Description:** Load `sources` with the car; keep primary link as today; list
additional `CarSource` links (platform + external URL).

**Acceptance criteria:**
- [ ] Detail page shows every source URL for the car
- [ ] Primary remains `car.sourceUrl` / `car.sourcePlatform` (first-wins)
- [ ] Cars with a single source look unchanged aside from using the same component path

**Verification:**
- [ ] `npm run build`
- [ ] Manual: open a merged car (or seed two sources) and confirm both links

**Dependencies:** Task 1 (Task 2 preferred for real merge data)  
**Files likely touched:** `src/lib/types.ts`, `src/lib/aggregate.ts`, `src/components/cars/car-detail-tabs.tsx`, any page loader that fetches the car  
**Estimated scope:** S–M

### Checkpoint A — After Tasks 1–3

- [ ] `npm test` and `npm run build` green
- [ ] Dedup merge demo works via CLI
- [ ] UI shows multi-source links
- [ ] **Human review** before source harvests

---

### Phase 2 — Source harvests (vertical slices)

#### Task 4: BIDchain harvest path

**Description:** Add public `bidchain-fetch.ts` (Playwright, `domcontentloaded`, no
session). Add `.claude/skills/harvest-bidchain/SKILL.md` documenting list → detail
→ `write-lead` → `apply-goal-filter`, white-label hosts, `sellerType` rules, 1000
write ceiling. Add a sanitized HTML fixture + parser test or documented extraction
checklist in the skill if parsing stays agent-side.

**Acceptance criteria:**
- [ ] Fetch script writes HTML for a public lot URL without login
- [ ] Skill procedure is runnable by an agent end-to-end
- [ ] Confidence rules match v1 (fail closed on body/price/URL)
- [ ] Safety ceiling documented (1000 writes/run)

**Verification:**
- [ ] `npx tsx scripts/ingestion/bidchain-fetch.ts "<lotUrl>" --out /tmp/bid.html` succeeds
- [ ] Dry-run: write ≥1 confident lot via `write-lead` with `--source-platform "BIDchain"`
- [ ] `npm test` still green

**Dependencies:** Checkpoint A (Tasks 1–2 minimum)  
**Files likely touched:** `scripts/ingestion/bidchain-fetch.ts`, `.claude/skills/harvest-bidchain/SKILL.md`, optional fixture under `scripts/ingestion/__tests__/fixtures/`  
**Estimated scope:** M

#### Task 5: Leilões PB harvest path

**Description:** Short public-access probe, then fetch helper (login only if probe
proves necessary — ask owner before adding login flow). Per-source skill
`harvest-leiloes-pb` with same confidence + ceiling rules.

**Acceptance criteria:**
- [ ] Probe result recorded in skill (public vs login)
- [ ] Agent can harvest confident vehicle lots into DB as `Leilões PB`
- [ ] Uses `write-lead` merge path (no duplicate cars when chassis/plate known)

**Verification:**
- [ ] Fetch at least one lot HTML successfully
- [ ] ≥1 `write-lead` create/merge with platform `Leilões PB`
- [ ] `npm test` green

**Dependencies:** Checkpoint A  
**Files likely touched:** `scripts/ingestion/leiloes-pb-*.ts`, `.claude/skills/harvest-leiloes-pb/SKILL.md`  
**Estimated scope:** M

#### Task 6: MGL harvest path

**Description:** Same vertical slice as Task 5 for `mgl.com.br` /
`harvest-mgl`.

**Acceptance criteria:**
- [ ] Probe result in skill
- [ ] Confident lots land via `write-lead` as `MGL`
- [ ] 1000 write ceiling documented

**Verification:**
- [ ] Fetch + ≥1 write-lead
- [ ] `npm test` green

**Dependencies:** Checkpoint A  
**Files likely touched:** `scripts/ingestion/mgl-*.ts`, `.claude/skills/harvest-mgl/SKILL.md`  
**Estimated scope:** M

### Checkpoint B — After Tasks 4–6

- [ ] Each new source has a skill + fetch path
- [ ] At least one live write per source (or documented blocker)
- [ ] Cross-source: same chassis from VIP + BIDchain → one car, two links
- [ ] **Human review** of sample Pipeline rows

---

### Phase 3 — Polish + close

#### Task 7: Goal-aware harvest guidance + v1 skill cleanup

**Description:** Document in each v2 skill (and lightly in v1) how to prefer lots
near active goal (year/budget/body) before writing, while keeping fail-closed
extraction. Update v1 skill “Deferred” section to point at v2 skills. Optional:
shared helper that reads active `BuyingGoal` and prints a filter hint (no silent
drops of valid lots without logging).

**Acceptance criteria:**
- [ ] Skills say: filter by goal when cheap; never invent fields; ceiling 1000
- [ ] v1 skill links to per-source v2 skills instead of “deferred” for these sources

**Verification:**
- [ ] Skill markdown reviewed
- [ ] `npm test` if helper code added

**Dependencies:** Tasks 4–6  
**Files likely touched:** `.claude/skills/harvest-*/SKILL.md`, optional `scripts/ingestion/goal-hint.ts`  
**Estimated scope:** S

#### Task 8: End-to-end verification harvest

**Description:** Run (or agent-run) BIDchain + one regional source, then
`apply-goal-filter`, capture summary counts (written / merged / skipped / parked /
rejected). Confirm no bidding code landed.

**Acceptance criteria:**
- [ ] Summary logged in `tasks/todo.md` or chat
- [ ] Pipeline usable same day (`new_lead` / `parked` populated from new sources)
- [ ] Grep confirms no bid-placement scripts

**Verification:**
- [ ] `npm test && npm run build`
- [ ] Manual Pipeline check

**Dependencies:** Tasks 4–7  
**Files likely touched:** `tasks/todo.md` (status only)  
**Estimated scope:** S

### Checkpoint C — Complete

- [ ] SPEC success criteria met
- [ ] `npm test` + `npm run build` green
- [ ] Ready for owner sign-off

## Parallelization

| Parallel-safe after Checkpoint A | Must stay sequential |
|---|---|
| Tasks 4, 5, 6 (different sources) | Task 1 → 2 → 3 |
| Task 7 skill docs (after each source exists) | Task 8 last |

## Risks and mitigations

| Risk | Impact | Mitigation |
|---|---|---|
| Plate-only false merges (masked/shared plates) | Med | Prefer chassis; note weak plate merges; never merge without plate/chassis |
| BIDchain white-label domain sprawl | Med | Skill lists known hosts; canonicalize lot URL as written `sourceUrl` |
| Leilões PB / MGL need login after all | Med | Probe first; VIP-style session only with owner approval |
| Large harvest fills DB | Low | 1000 writes/source/run ceiling + goal-aware skip |
| UI forgets secondary sources | Low | Task 3 before declaring Phase 1 done |

## Out of scope (do not schedule)

- In-app bidding / lance placement
- Cron / unattended harvest
- Fuzzy dedup without plate/chassis
