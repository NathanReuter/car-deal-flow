# Todo: Tier 1 Coverage — Deterministic Full-Catalog Harvest

Spec: `SPEC.md` (v2 ingestion) + Tier 1 analysis (conversation 2026-07-15)
Plan: `tasks/plan.md`

Status: **Phases 0–6 implemented** — human spot-checks + live harvest runs pending

Goal: Scale from ~188 sample cars to full-catalog harvests via deterministic scripts (minimal agent token usage).

---

## Phase 0: Shared harvest infrastructure

- [x] **Task 0.1** `scripts/ingestion/lib/parse-common.ts` — BRL, km, year, brand, bodyType + tests
- [x] **Task 0.2** `scripts/ingestion/lib/listing-filters.ts` — batidos, insurer, sinistrado filters + tests
- [x] **Task 0.3** `scripts/ingestion/lib/harvest-runner.ts` — ceiling, spawnWriteLead, summary JSON + tests

### Checkpoint 0
- [x] `npx vitest run scripts/ingestion/__tests__/` passes
- [x] `npm test` + `npm run build` pass
- [ ] Human review before source harvests

---

## Phase 1: Bradesco full catalog

- [x] **Task 1.1** `bradesco-list.ts` — paginated JSON discovery, skip Sinistrado at list level
- [x] **Task 1.2** `bradesco-fetch.ts` — batch detail fetch with `--skip-existing`
- [x] **Task 1.3** `bradesco-harvest.ts` — promote writer; update skill

### Checkpoint 1
- [x] End-to-end: list → fetch → harvest without agent reading HTML
- [x] List/fetch/harvest CLIs + fixture tests green
- [ ] Human spot-check T-Cross / SUV rows for damage

---

## Phase 2: VIP Financeiras deep harvest

- [x] **Task 2.1** `vip-list-financeiras.ts` — dynamic event discovery (not hardcoded IDs)
- [x] **Task 2.2** `vip-fetch-batch.ts` — incremental batch detail fetch
- [x] **Task 2.3** `vip-harvest.ts` — promote `_tmp-vip-*`; optional `--exclude-insurer`

### Checkpoint 2
- [ ] ≥100 lot URLs discovered; ≥80 writes
- [ ] `--exclude-insurer` keeps Mapfre-style collision lots out of `new_lead`
- [ ] Human review sample rows

---

## Phase 3: BIDchain / Caixa at scale

- [x] **Task 3.1** `bidchain-list.ts` — vehicle lot discovery (bidchain + white-labels)
- [x] **Task 3.2** `bidchain-harvest.ts` — promote `_tmp-bidchain-harvest-write.ts`; update skill

### Checkpoint 3
- [ ] ≥30 BIDchain writes (up from 1)
- [x] Skill doc: single command
- [ ] Human review Caixa-tagged lots

---

## Phase 4: MGL corporate repossession only

- [x] **Task 4.1** `mgl-list-auctions.ts` — corp repasse only; exclude batidos/sucatas at auction level
- [x] **Task 4.2** `mgl-harvest.ts` — promote `mgl-harvest-write.ts` + auction filter; update skill

### Checkpoint 4
- [ ] Zero batidos auction writes (no MGL 7157-style bulk rejections)
- [ ] ≥30 corp repasse writes
- [ ] Human review sample rows

---

## Phase 5: Santander Retomados (new source)

- [x] **Task 5.1** Probe + `docs/superpowers/specs/2026-07-15-santander-retomados-probe.md`
- [x] **Task 5.2** `santander-list.ts` + `santander-fetch.ts` + tests
- [x] **Task 5.3** `santander-harvest.ts` + `harvest-santander` skill

### Checkpoint 5
- [ ] Probe reviewed by owner
- [ ] ≥10 Santander writes in first full run
- [ ] Human review vs insurer-lot quality

---

## Phase 6: Orchestrator + skill slim-down

- [x] **Task 6.1** `harvest.ts` orchestrator + `npm run harvest` scripts
- [x] **Task 6.2** Slim all harvest skills to orchestrator commands (≤10 lines primary instruction)

### Checkpoint 6 (Final)
- [x] `npm test` green
- [ ] `npm run build` green (Next.js /cars export hits Prisma P2023 — pre-existing UI/DB issue)
- [ ] `harvest.ts --all` produces ≥200 combined writes/updates
- [ ] No source stuck at ≤1 lot in DB
- [ ] Agent harvest = 1 script call + read summary (token benchmark)
- [ ] Owner sign-off

---

## Success Metrics

| Source | Current | Target |
|--------|---------|--------|
| Total | 188 | ≥400 |
| BIDchain | 1 | ≥30 |
| VIP | 34 | ≥80 |
| Bradesco | 100 | ≥150 |
| MGL | 52 | ≥40 corp-only, 0 batidos rejects |
| Santander | 0 | ≥10 |

---

## Notes

- Promote `_tmp-*` scripts to production; archive/delete tmp after each phase
- `--exclude-insurer` optional flag for bank-repossession focus (Mapfre lesson)
- Safety ceiling: 1000 writes/source/run
- Out of scope: cron scheduling, Tier 2 watchlist polling, Leilões PB expansion
- Prior completed work: multi-source v2 (`tasks/todo.md` git history)
- Parallel plan exists: auction date + expiry (not blocked by Tier 1)
