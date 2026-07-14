# Todo: Multi-source auction ingestion (v2)

Spec: `SPEC.md`  
Plan: `tasks/plan.md`

Status: **T6 done** — Checkpoint B ready for human review; next T7

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
- [ ] Cross-source merge visible in Pipeline
- [ ] Human review sample rows

## Phase 3 — Polish

- [ ] **T7** Goal-aware harvest guidance + v1 skill points to v2 skills; 1000 ceiling documented
- [ ] **T8** E2E verification harvest + summary; confirm no bidding code

### Checkpoint C
- [ ] SPEC success criteria met
- [ ] Owner sign-off

## Notes

- Safety ceiling: **1000 writes/source/run**
- Bidding: out of scope
- Parallel after Checkpoint A: T4 / T5 / T6
