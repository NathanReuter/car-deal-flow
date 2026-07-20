# Todo: Aggressive Ingestion — Wide-Net Repasse/Market Discovery

Spec: `docs/aggressive-ingestion-plan.md`
Plan: `tasks/plan.md`
Prior (repasse slice 1, DONE): preserved in git history of these files.

Status: **Planned (2026-07-20)** — awaiting Phase 0 start

---

## Phase 0: Foundation (serial)

- [ ] **Task 0.1** Prisma migration: `sourceChannel` + `confidence` columns on `Car`, with backfill UPDATEs (auction → `auction_house`, OLX → `classifieds`, all → `confidence "high"`)
- [ ] **Task 0.2** Types + write-lead plumbing: `SourceChannel`/`LeadConfidence` in `types.ts`, validated `WriteLeadInput` fields, `defaultChannelForPlatform()`, olx-harvest explicit values
- [ ] **Task 0.3** `"market"` DealPhase: types, write-lead validation (like auction), `harvest.ts` phase map, UI badge labels
- [ ] **Task 0.4** UI surfacing: `aggregate.ts` mapping + confidence badge in table/detail (may trail)

### Checkpoint C1
- [ ] Full `npx vitest run` green; `npx tsc --noEmit` green
- [ ] Migration + backfill verified via sqlite GROUP BY
- [ ] OLX + one auction source `--dry-run` clean (behavior unchanged)
- [ ] Human review

---

## Phase 1: OLX expansion

- [ ] **Task 1.1** Probe regional markup → new queries ("transferir financiamento", "veículo já financiado", "quitar e transferir", "aceito repasse") + `OLX_REGION_HOSTS` south-first (sc, pr, rs, sp, rj, mg, pb, pe, ce, rn, www) + max-pages 5→8 + cross-region listId dedupe + `confidence: "medium"`

---

## Phase 2: NaPista harvester (top priority)

- [ ] **Task 2.1a** Probe (blocking): live 2026 listings, real URL pattern, embedded JSON, robots/Cloudflare; capture fixtures. Dead/gated → stop + report
- [ ] **Task 2.1b** Build `napista-list.ts` / `napista-parse.ts` / `napista-harvest.ts` (`market`, `dealer`, `aggregator`, `high`); register source + npm script; fixture tests

### Checkpoint C2
- [ ] Tests green; human eyeballs 10 dry-run rows (prices vs FIPE, no invented fields)
- [ ] One real `--limit 20` run reviewed in UI with correct badges

---

## Phase 3: Webmotors harvester (independent of Phase 2)

- [ ] **Task 3.1a** Probe (blocking, 2h timebox): keyword search, anti-bot assessment, `/api/search` XHR; fixtures. Hard-blocked → report + deprioritize
- [ ] **Task 3.1b** Build `webmotors-list.ts` / `webmotors-parse.ts` (fail-closed repasse gate) / `webmotors-harvest.ts` (`pre_repossession`, `classifieds`, `medium`, `repasse`); register + tests (repasse-positive + repasse-negative cases)

---

## Phase 4: Storefront config harvester (independent)

- [ ] **Task 4.1a** Probe: freshness-check Clube Repasse, CG Veículos, Compra Certa; fixture per live site; drop dead sites
- [ ] **Task 4.1b** Build `storefront-sites.ts` + `storefront-harvest.ts` (plain fetch, per-site try/catch; `market`, `repasse`, `storefront`, `medium`); register + tests

### Checkpoint C3
- [ ] Full suite green; every registered source passes `--dry-run --limit 5`
- [ ] Cadence untouched (new sources NOT yet scheduled)
- [ ] Human spot-check of one limited real run per source in UI

---

## Phase 5: Cadence, skills, docs — DONE (gate overridden by user)

- [x] **Task 5.1** `cadence-schedule.ts` entries (napista daily; webmotors M/W/F; storefronts Tu/F) + `.claude/skills/harvest-napista|webmotors|storefronts` (commit b06f513, 11/11 tests)

### Checkpoint C4
- [x] `cadence-schedule.test.ts` + `run-cadence.test.ts` green; cadence dry-run verified (Mon lists napista+webmotors, storefronts absent)

---

## Phase 6: Spikes (FUTURE WORK — blocked on human prerequisites)

- [ ] **Task 6.1** WhatsApp/Telegram listener spike → `docs/spikes/messaging-listener-spike.md` (needs dedicated phone number — human)
- [ ] **Task 6.2** Facebook Marketplace RapidAPI spike → `docs/spikes/facebook-marketplace-spike.md` (needs RapidAPI key — human)

## Future Work (see tasks/plan.md → Future Work)

- [ ] **FW-2** Cars-view UI scaling — design done in `docs/ui-cars-view-scaling-plan.md`; build deferred
- [ ] **FW-3** Deferred Minor review findings cleanup pass (NaPista pagination validation, Webmotors dedup, storefront slug/warn, OLX dead const)

---

## Human-provided prerequisites

- [ ] Dedicated phone number for WhatsApp groups (Task 6.1)
- [ ] RapidAPI account/key (Task 6.2)

## Out of scope (unchanged from prior plan)

Instagram/Apify, paid plate APIs, Repasse Já / Repasses.com.br (dealer-gated — revisit only if registration proves feasible), Sinesp theft checks (Phase-2 risk-check extension via Infosimples, deferred).
