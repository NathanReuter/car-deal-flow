# Todo: Pre-Repossession (Repasse) Lead Ingestion — Slice 1

Spec: `docs/superpowers/specs/2026-07-17-pre-repossession-repasse-ingestion-design.md`
Plan: `tasks/plan.md`
Prior (Tier 1, implemented, human checks pending): `tasks/plan-tier1.md` / `tasks/todo-tier1.md`

Status: **Phase 0 implemented (2026-07-17)** — awaiting Checkpoint 0 human review

---

## Phase 0: Data model + shared repasse libs

- [x] **Task 0.1** Schema + types: `dealPhase`, repasse columns, `sellerType "repasse"`, aggregate mapping, migration + backfill (560 cars → auction)
- [x] **Task 0.2** `write-lead.ts`: repasse input fields, pricing rule, cross-phase "window closed" merge note
- [x] **Task 0.3** `lib/repasse-economics.ts`: entrada/saldo/parcela/contact extraction, null-on-ambiguity + tests
- [x] **Task 0.4** `lib/repasse-urgency.ts`: high/medium/low heuristic + tests

### Checkpoint 0
- [x] `npm test` (242) + `npx tsc --noEmit` green; migration applied; `/` renders 200
- [ ] Human review of pricing rule behavior

---

## Phase 1: Repasso + Repasses — **CANCELLED (both sources dead)**

- [x] **Task 1.1** Repasso probe: site dead since Nov 2020 (see `docs/superpowers/specs/2026-07-17-repasso-repasses-probe.md`)
- [x] ~~**Task 1.2** `repasso-harvest.ts`~~ — dropped
- [x] **Task 1.3** Repasses probe: app-only landing page; marketplace SPA has expired SSL — dropped

### Checkpoint 1 → folded into Checkpoint 2 (OLX proves the phase-1 path)

---

## Phase 2: OLX

- [ ] **Task 2.1** OLX probe: access/anti-bot verdict, fixtures (stop-and-report if hard-blocked)
- [ ] **Task 2.2** `olx-list.ts` + `olx-fetch.ts` (resumable, capped)
- [ ] **Task 2.3** `olx-parse.ts` + `olx-harvest.ts` (no-signal skip tally)

### Checkpoint 2
- [ ] Live capped run writes real OLX leads; sane skip tallies
- [ ] Human review + LGPD spot-check (contact only in `sellerContact`)

---

## Phase 3: Orchestrator + skill

- [ ] **Task 3.1** `harvest.ts`: olx/repasso/repasses sources + `--phase pre|auction|all`; npm scripts; link-check covers phase 1
- [ ] **Task 3.2** `harvest-repasse` skill doc (thin)

### Checkpoint 3
- [ ] One command runs phase-1 end-to-end; `npm test` green

---

## Phase 4: Verification gate

- [ ] **Task 4.1** `list-targets.ts --phase pre` + outcome mapping (qualified → researching; no gravame → warning; RENAJUD → urgency high)
- [ ] **Task 4.2** `sync-risk-checks` skill doc update

### Checkpoint 4
- [ ] One real lead verified through the browser flow; owner review

---

## Phase 5: UI

- [ ] **Task 5.1** Table: phase + urgency badges, phase filter
- [ ] **Task 5.2** Detail: repasse economics block ("não informado" for nulls)

### Checkpoint 5 (Final)
- [ ] `npm test` + `npx tsc --noEmit` green
- [ ] `--phase pre` run: ≥20 phase-1 leads written
- [ ] ≥1 lead verified to `researching`
- [ ] LGPD spot-check clean; owner sign-off

---

## Notes

- Pricing rule: entrada+saldo when both known; saldo unknown → flag note + needs-research; entrada unknown → reject.
- Never bypass anti-bot; OLX hard-block → stop and report.
- Manual one-shot runs only; no cron.
- Out of scope: Instagram/Apify, paid plate APIs, Webmotors, Motorez/RepassaMais, scheduling, lost-to-auction analytics.
