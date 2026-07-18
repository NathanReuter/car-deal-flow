# Implementation Plan: Pre-Repossession (Repasse) Lead Ingestion — Slice 1

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-17-pre-repossession-repasse-ingestion-design.md`
**Prior plan:** Tier 1 full-catalog harvest — archived at `tasks/plan-tier1.md` / `tasks/todo-tier1.md` (implemented; human spot-checks still pending there).

**Goal:** Add a phase-1 (pre-repossession) acquisition stage: harvest repasse / "assumo financiamento" ads from OLX, Repasso.com.br, and Repasses.com.br; verify financing via the existing risk-check agent; flag urgency; surface leads in the existing pipeline alongside auction lots.

**Architecture:** Mirror the auction-harvest pattern. Each source is a vertical slice under `scripts/ingestion/` (list → fetch → parse → `write-lead.ts` → `apply-goal-filter.ts`), reusing dedup (`identity.ts`), the damage gate, fixture tests, and the `harvest.ts` orchestrator (new `--phase` selector). Verification extends `scripts/risk-checks/` + the `sync-risk-checks` skill. Data model gains `dealPhase` + flat repasse columns on `Car`.

## Status (updated 2026-07-18)

- **Phase 0 — Data model + repasse libs: DONE.** `dealPhase`, repasse columns, `write-lead` pricing rule, `repasse-economics.ts`, `repasse-urgency.ts` all shipped.
- **Phase 1 — Repasso + Repasses: CANCELLED.** Both sources probed dead (2026-07-17) and re-confirmed dead (2026-07-18) — see `docs/superpowers/specs/2026-07-17-repasso-repasses-probe.md`. Repasses is app-only behind an expired cert (out of policy); Repasso's newest content is Nov 2020. OLX is the sole live phase-1 source.
- **Phase 2 — OLX: DONE.** `olx-list.ts` / `olx-parse.ts` / `olx-harvest.ts` shipped.
- **Phase 3 — Orchestrator + skill: DONE.** `harvest.ts` `--phase` selector, npm scripts, `harvest-repasse` skill.
- **Phase 4 — Verification gate: DONE.** `list-targets --phase pre`, `write-result` phase-1 outcome mapping.
- **Phase 5 — UI surfacing: IN PROGRESS.** Table badges + phase filter and the detail economics block are the remaining work.

## Global Constraints (carried over from Tier 1, all still binding)

- Fail closed: never guess brand, model, year, price, body type. Ambiguous repasse economics → `null`.
- Damage gate (colisão/sinistro/monta/sucata/batido) unchanged, applies to repasse ads too.
- Safety ceiling: 1000 writes per source per run.
- Public unauthenticated pages only; never bypass logins/CAPTCHA/anti-bot. If OLX blocks hard, stop and report — do not escalate evasion.
- LGPD minimization: one seller contact handle max, stored only in the dedicated column; no CPF; contact never copied into notes.
- `--out` paths under `/tmp` or `<cwd>/tmp` (`fetch-guards.ts`).
- Manual one-shot runs only; no cron.
- `npm test` and `npx tsc --noEmit` green after each phase (`npm run build` has a pre-existing P2023 issue — see todo-tier1 Checkpoint 6).
- Ask owner before new npm dependencies.

## Pricing rule (repeated because it is the easiest thing to get wrong)

For `dealPhase = "pre_repossession"`:
- Both entrada and saldo known → `askingPriceBRL = entryAskBRL + outstandingDebtBRL`; note stamps the breakdown.
- Saldo unknown → `askingPriceBRL = entryAskBRL`, mandatory note "saldo devedor não informado"; goal filter must treat as needs-research (park, never auto-promote as bargain).
- Entrada unknown → lead is skipped (no anchor price at all fails the fail-closed rule).

---

## Task List

### Phase 0: Data model + shared repasse libs (foundation)

- [x] **Task 0.1: Schema + domain types for deal phase and repasse economics**
  - **Description:** Add to `prisma/schema.prisma` `Car`: `dealPhase String @default("auction")`, `entryAskBRL Int?`, `outstandingDebtBRL Int?`, `installmentBRL Int?`, `installmentsRemaining Int?`, `sellerContact String?`, `repasseUrgency String?`. Migrate SQLite (existing rows get `"auction"` via default). Update `src/lib/types.ts`: `DealPhase` type, `sellerType "repasse"` + label, optional `repasse` block on `Car` (nested object in domain, flat columns in DB), and mapping in `src/lib/aggregate.ts`.
  - **Acceptance criteria:**
    - [ ] Migration applies cleanly to the existing DB; all existing cars read back with `dealPhase === "auction"`.
    - [ ] `sources.test.ts` / existing type consumers compile; new `SELLER_TYPE_LABEL.repasse` present.
  - **Verification:** `npx prisma migrate dev` ok; `npm test`; `npx tsc --noEmit`.
  - **Dependencies:** None. **Files:** `prisma/schema.prisma`, migration, `src/lib/types.ts`, `src/lib/aggregate.ts`. **Scope:** M.

- [x] **Task 0.2: `write-lead.ts` repasse support**
  - **Description:** Extend `WriteLeadInput` with `dealPhase?`, `entryAskBRL?`, `outstandingDebtBRL?`, `installmentBRL?`, `installmentsRemaining?`, `sellerContact?`. Add `"repasse"` to `VALID_SELLER_TYPES`. Enforce the pricing rule above (compute/validate `askingPriceBRL`, stamp breakdown or "saldo devedor não informado" note; phase-2 leads keep the lance-mínimo note). Persist new columns; merge behavior: cross-phase merge keeps the car, appends source, and stamps a "window closed — reappeared at auction" note when an existing pre_repossession car is re-written by an auction source.
  - **Acceptance criteria:**
    - [ ] Repasse lead with entrada+saldo writes with summed price and breakdown note.
    - [ ] Saldo-unknown lead writes with flag note; entrada-unknown lead is rejected with `WriteLeadError`.
    - [ ] Auction re-harvest of an existing repasse car merges (no duplicate) and stamps window-closed note.
  - **Verification:** new cases in `write-lead` tests; `npm test`.
  - **Dependencies:** 0.1. **Files:** `scripts/ingestion/write-lead.ts`, its tests. **Scope:** M.

- [x] **Task 0.3: `lib/repasse-economics.ts` — conservative ad-text extraction**
  - **Description:** Pure functions extracting `entryAskBRL`, `outstandingDebtBRL`, `installmentBRL`, `installmentsRemaining`, and contact handle from Portuguese ad text ("entrada de R$ 15.000", "saldo devedor 42 mil", "48x de R$ 1.250", "restam 30 parcelas", phone/WhatsApp patterns). Ambiguity (two candidate values, ranges, "consulte") → `null`. Reuses `parse-common.ts` BRL parsing.
  - **Acceptance criteria:**
    - [ ] Table-driven tests cover the common phrasings plus ≥5 ambiguous cases asserting `null`.
    - [ ] Never throws on arbitrary text.
  - **Verification:** `npx vitest run scripts/ingestion/__tests__/repasse-economics.test.ts`.
  - **Dependencies:** None. **Files:** `scripts/ingestion/lib/repasse-economics.ts`, test. **Scope:** S.

- [x] **Task 0.4: `lib/repasse-urgency.ts` — heuristic urgency flag**
  - **Description:** Pure function `computeRepasseUrgency(input) → "high" | "medium" | "low"` from: restriction check results (judicial/RENAJUD found → high), ad-text markers ("urgente", "entrega amigável", "banco vai tomar", parcelas atrasadas), FIPE discount depth (when available), ad age. No day-countdowns.
  - **Acceptance criteria:**
    - [ ] Restriction signal alone forces `high`; plain ad with no signals → `low`.
    - [ ] Deterministic, documented signal weights in one place.
  - **Verification:** unit tests; `npm test`.
  - **Dependencies:** None. **Files:** `scripts/ingestion/lib/repasse-urgency.ts`, test. **Scope:** S.

### Checkpoint 0: Foundation
- [ ] `npm test` + `npx tsc --noEmit` green; migration applied; no UI regressions on `/cars` dev render.
- [ ] Human review of pricing-rule behavior before any source harvests.

---

### Phase 1: Repasso + Repasses (low-risk sources, prove the phase-1 path end-to-end)

- [x] ~~**Task 1.1: Repasso probe + spec note**~~ (CANCELLED — source dead)
  - **Description:** Fetch Repasso.com.br listing + one detail page (plain HTTP), save fixtures, record structure/selectors/volume in a short probe doc (pattern: `2026-07-15-santander-retomados-probe.md`). Confirm robots.txt still permits.
  - **Acceptance criteria:** probe doc committed with listing URL scheme, pagination, detail selectors, observed ad count.
  - **Verification:** fixtures saved under `scripts/ingestion/__tests__/fixtures/`.
  - **Dependencies:** None. **Files:** probe doc, 2 fixtures. **Scope:** S.

- [x] ~~**Task 1.2: `repasso-harvest.ts` (list + parse + write)**~~ (CANCELLED — source dead)
  - **Description:** Single CLI: paginate listings → fetch details (plain HTTP, `--skip-existing` cache dir under `/tmp/repasso-harvest/`) → parse (identity fields fail-closed, damage gate, `repasse-economics`) → `write-lead` with `dealPhase: "pre_repossession"`, `sellerType: "repasse"`, `sourcePlatform: "Repasso"` → summary JSON.
  - **Acceptance criteria:**
    - [ ] Fixture tests for listing + detail parse, including one economics-bearing ad and one damage-gated ad.
    - [ ] `--dry-run` and `--limit` supported; ceiling enforced.
  - **Verification:** fixture tests; live `--dry-run --limit 5` run shows sane parsed output.
  - **Dependencies:** 0.1–0.3, 1.1. **Files:** `repasso-harvest.ts`, tests, fixtures. **Scope:** M.

- [x] ~~**Task 1.3: Repasses.com.br wp-json probe + `repasses-harvest.ts`**~~ (CANCELLED — source dead)
  - **Description:** Probe `wp-json/wp/v2/` for a vehicle post type (fallback: HTML). Then same harvest shape as 1.2 with `sourcePlatform: "Repasses"`; JSON payload fixture test.
  - **Acceptance criteria:**
    - [ ] Probe outcome recorded (API vs HTML fallback) in the probe doc.
    - [ ] Fixture test on real payload; `--dry-run`/`--limit`; ceiling.
  - **Verification:** fixture tests; live `--dry-run --limit 5`.
  - **Dependencies:** 0.1–0.3. **Files:** `repasses-harvest.ts`, tests, fixture, probe doc. **Scope:** M.

### Checkpoint 1: Phase-1 path proven
- [ ] Real repasse leads in DB with `dealPhase = "pre_repossession"`, correct pricing/notes.
- [ ] `npm test` green; human reviews ~10 sample rows before OLX work.

---

### Phase 2: OLX slice (highest volume, highest risk)

- [x] **Task 2.1: OLX probe — search access + anti-bot posture**
  - **Description:** Playwright + stealth (existing stack) against OLX Autos search for "repasse" / "assumo financiamento" / "passo financiamento", constrained by active-goal price band + region. Determine: results markup (or embedded `__NEXT_DATA__` JSON), pagination, detail-page shape, block behavior. Save search + detail fixtures. **If OLX hard-blocks, stop and report options to owner — do not escalate evasion.**
  - **Acceptance criteria:** probe doc with access verdict, selectors/JSON paths, expected volume per query.
  - **Verification:** fixtures saved; probe doc committed.
  - **Dependencies:** None (parallel with Phase 1). **Files:** probe doc, fixtures. **Scope:** S–M.

- [x] **Task 2.2: `olx-list.ts` + `olx-fetch.ts`**
  - **Description:** `olx-list.ts`: run the query set, dedupe ad URLs across queries, `--out /tmp/olx-harvest/list.json`. `olx-fetch.ts`: batch detail fetch with `--skip-existing` into `/tmp/olx-harvest/details/`. Shared browser instance, polite pacing.
  - **Acceptance criteria:**
    - [ ] List output: url, title, price, city/UF, postedAt per ad; fixture test.
    - [ ] Fetch resumable via `--skip-existing`; `--limit` honored.
  - **Verification:** fixture tests; live run capped at `--limit 10`.
  - **Dependencies:** 2.1. **Files:** `olx-list.ts`, `olx-fetch.ts`, tests. **Scope:** M.

- [x] **Task 2.3: `olx-parse.ts` + `olx-harvest.ts`**
  - **Description:** Parse detail fixtures → identity fields (fail closed), damage gate, `repasse-economics` on description, plate `null` expected. Harvest writer mirrors 1.2 (`sourcePlatform: "OLX"`). Non-repasse ads matched by the query but lacking any financing signal in text → skip + tally (`skipReason: "no_financing_signal"`).
  - **Acceptance criteria:**
    - [ ] Fixture tests: economics-bearing ad, damage ad (rejected), no-signal ad (skipped).
    - [ ] Live `--dry-run --limit 10` produces ≥1 plausible qualified-shape lead.
  - **Verification:** fixture tests; dry-run output human-scanned.
  - **Dependencies:** 2.2, 0.2–0.3. **Files:** `olx-parse.ts`, `olx-harvest.ts`, tests, fixtures. **Scope:** M.

### Checkpoint 2: OLX live
- [ ] Live capped run (`--limit 25`) writes real OLX repasse leads; skip tallies look sane (not 100% skips, not 0).
- [ ] Human review of written rows + LGPD spot-check (contact only in `sellerContact`).

---

### Phase 3: Orchestrator, npm scripts, skill doc

- [x] **Task 3.1: `harvest.ts` phase selector + new sources**
  - **Description:** Add `"olx" | "repasso" | "repasses"` to `HarvestSource`; add `--phase pre|auction|all` (default `all`; `--source` implies its phase). Post-harvest cleanup: broken-link sweep applies to phase-1 leads too (dead ad = sold or pulled → expire). Update `package.json` scripts (`harvest:pre`, etc.).
  - **Acceptance criteria:**
    - [ ] `--phase pre` runs exactly olx+repasso+repasses; `--all` runs everything; summary JSON groups per source.
    - [ ] Existing auction-only invocations unchanged.
  - **Verification:** orchestrator unit tests for source selection; `npm test`.
  - **Dependencies:** 1.2, 1.3, 2.3. **Files:** `harvest.ts`, `package.json`, tests. **Scope:** S–M.

- [x] **Task 3.2: `harvest-repasse` skill doc**
  - **Description:** Thin skill (≤10-line primary instruction, matching the slimmed Tier 1 skills) for running the phase-1 harvest and reading the summary.
  - **Acceptance criteria:** skill invokes orchestrator, no HTML reading by the agent.
  - **Verification:** doc review.
  - **Dependencies:** 3.1. **Files:** `.claude/skills/harvest-repasse/SKILL.md`. **Scope:** XS.

### Checkpoint 3: Orchestrated
- [ ] One command runs all phase-1 sources end-to-end with goal filter + cleanup.
- [ ] `npm test` green.

---

### Phase 4: Verification via sync-risk-checks (qualification gate)

- [x] **Task 4.1: `list-targets.ts` phase-1 mode + outcome mapping in `write-result.ts`**
  - **Description:** `list-targets.ts` gains `--phase pre` (pre_repossession cars with a plate, active stages). `write-result.ts` maps phase-1 outcomes: gravame confirmed → stage `researching` + note; no gravame → `financing_lien` item `warning` + "possível golpe / não financiado" note, stays `new_lead`; judicial/RENAJUD hit → `repasseUrgency = "high"` (via `repasse-urgency` recompute).
  - **Acceptance criteria:**
    - [ ] Three outcome paths unit-tested against a seeded car.
    - [ ] Plateless phase-1 cars excluded from targets.
  - **Verification:** `scripts/risk-checks/__tests__/` green; `npm test`.
  - **Dependencies:** 0.1, 0.4. **Files:** `scripts/risk-checks/list-targets.ts`, `write-result.ts`, tests. **Scope:** M.

- [x] **Task 4.2: `sync-risk-checks` skill update**
  - **Description:** Document the phase-1 flow (financing_lien + judicial_restriction only for repasse leads; the human step of obtaining the plate from the seller; outcome meanings).
  - **Acceptance criteria:** skill doc covers phase-1 invocation and outcome table from the spec.
  - **Verification:** doc review.
  - **Dependencies:** 4.1. **Files:** `.claude/skills/sync-risk-checks/SKILL.md`. **Scope:** XS.

### Checkpoint 4: Qualification gate live
- [ ] One real repasse lead with a plate driven through the browser checks; correct stage/urgency result.
- [ ] Owner review.

---

### Phase 5: UI surfacing

- [ ] **Task 5.1: Table badges + phase filter**
  - **Description:** `cars-table-view.tsx`: phase badge (Pré-apreensão / Leilão) + urgency badge (high=red, medium=amber, low=neutral); phase filter alongside existing filters. `aggregate.ts` already maps fields from 0.1.
  - **Acceptance criteria:**
    - [ ] Auction rows unchanged visually except the phase column/badge; repasse rows show urgency.
    - [ ] Filter narrows correctly.
  - **Verification:** dev-server render check; existing component tests green.
  - **Dependencies:** 0.1. **Files:** `src/components/cars/cars-table-view.tsx`. **Scope:** S.

- [ ] **Task 5.2: Detail economics block**
  - **Description:** `car-detail-tabs.tsx`: for pre_repossession cars, a "Repasse" block: entrada, saldo devedor, parcela × restantes, contato, urgency, with "não informado" for nulls.
  - **Acceptance criteria:** block absent for auction cars; nulls render as "não informado", never 0.
  - **Verification:** dev-server render of one repasse + one auction car.
  - **Dependencies:** 0.1, data from Phase 1. **Files:** `src/components/cars/car-detail-tabs.tsx`. **Scope:** S.

### Checkpoint 5 (Final)
- [ ] `npm test` green; `npx tsc --noEmit` green.
- [ ] Full `--phase pre` run: ≥20 combined phase-1 leads written (OLX expected to dominate).
- [ ] ≥1 lead driven through verification to `researching`.
- [ ] LGPD spot-check: no CPF anywhere; contacts only in `sellerContact`.
- [ ] Owner sign-off.

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| OLX anti-bot blocks search scraping | High | Probe first (2.1); stop-and-report rule; Repasso/Repasses keep phase 1 alive meanwhile |
| Economics regexes misread free text (wrong saldo) | High | Conservative null-on-ambiguity, table-driven tests, breakdown stamped in note for human check |
| Golpe do repasse (scam ads) | Med | Verification gate is the filter; no-gravame → warning; no money moves from this tool |
| Very few ads expose plates → verification bottleneck | Med | Expected; plateless leads stay `new_lead` with human follow-up step; paid plate APIs are the follow-up spec |
| Repasso/Repasses volume too small to matter | Low | They are the safe proving ground; OLX is the volume source |
| Cross-phase dedup misses (no plate/chassis) | Med | `identity.ts` proximity match; worst case duplicate car, caught at human review |

## Open Questions

- OLX region scope: active goal's UF only, or nationwide? (Default in plan: goal band + region; owner can widen.)
- Should `apply-goal-filter` score repasse leads differently (e.g., ignore mileage nulls more leniently)? Default: same rules, revisit after Checkpoint 2 data.
