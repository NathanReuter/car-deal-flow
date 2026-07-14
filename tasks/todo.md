# Todo: Multi-source auction ingestion (v2)

Spec: `SPEC.md`  
Plan: `tasks/plan.md`

Status: **T7–T8 done** — Checkpoint C ready for owner sign-off (human Pipeline review still recommended)

Schema decision: keep **`CarSource` table** (confirmed).

## Phase 1 — Dedup foundation

- [x] **T1** `CarSource` schema + migration + backfill from existing `Car` primary source
- [x] **T2** `write-lead`: upsert `CarSource`; merge by chassis/plate (first-wins primary) + tests
- [x] **T3** Car detail UI lists all source links

### Checkpoint A
- [x] `npm test` + `npm run build` green
- [x] CLI merge demo: one car, two `CarSource` rows
- [ ] Human review before harvests

## Phase 2 — Per-source harvests

- [x] **T4** BIDchain: public fetch script + `harvest-bidchain` skill (+ fixture/checklist)
- [x] **T5** Leilões PB: probe → fetch + `harvest-leiloes-pb` skill (live: VW T-Cross Mapfre lot 40329)
- [x] **T6** MGL: probe → fetch + `harvest-mgl` skill (live: Ford Ka lot 208255; CF needs stealth fetch)

### Checkpoint B
- [x] ≥1 live write per source — BIDchain + Leilões PB + MGL
- [x] Cross-source merge demo — chassis `9BWZZZ377VT000001` → one car, VIP primary + BIDchain `CarSource`
- [ ] Human review sample rows (owner)

## Phase 3 — Polish

- [x] **T7** Goal-aware harvest guidance + v1 skill points to v2 skills; `goal-hint.ts`; 1000 ceiling documented
- [x] **T8** E2E verification: review fetch hardening + live writes; grep — no bid-placement scripts; `npm test` + `npm run build` green

### Checkpoint C
- [x] SPEC success criteria met (code/skills path)
- [ ] Owner sign-off

## Review follow-ups (2026-07-14)

- [x] Shared `fetch-guards.ts`: case-insensitive hosts, post-redirect allowlist, CF/HTTP fail-closed, safe `--out` roots
- [x] Aligned BIDchain / Leilões PB / MGL fetch CLIs

## E2E summary (T8)

| Source | Live write example | Notes |
|---|---|---|
| BIDchain | Saveiro lot `78224` | Stealth + CF/HTTP guards |
| Leilões PB | VW T-Cross lot `40329` | Plain Playwright; re-probe if CF |
| MGL | Ford Ka lot `208255` | Stealth required (CF) |
| Cross-source | Virtus demo chassis | `merged: true`; primary VIP unchanged |

Goal hint (active): Family SUV/Hatch — budget 40–100k, minYear 2022, brands Toyota/Honda/VW/Hyundai/Chevrolet/Byd.

Bidding: skills forbid login/bid; no placement scripts under `scripts/ingestion`.

## Notes

- Safety ceiling: **1000 writes/source/run** (documented; not hard-enforced in code)
- Bidding: out of scope
- **Damage gate:** colisão / sinistro / monta / sucata / batido → hard reject; only integral/conservado
- Parallel after Checkpoint A: T4 / T5 / T6
