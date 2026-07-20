# Implementation Plan: Aggressive Ingestion — Wide-Net Repasse/Market Discovery

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/aggressive-ingestion-plan.md`
**Prior plan:** Pre-repossession repasse slice 1 — completed (Phases 0–5 DONE, Repasso/Repasses cancelled as dead); preserved in git history of this file.

**Goal:** Extend ingestion from 6 sources (5 auction + OLX repasse) to a multi-channel harvester fleet catching **pre-repossession repasse deals** and **below-FIPE dealer stock** days-to-weeks before auction. Phase-1 goal is discovery volume and speed; verification depth stays with the existing RiskCheck flow.

**Architecture:** Every new source mirrors the canonical OLX vertical slice under `scripts/ingestion/` (list → parse → harvest → `write-lead.ts` → `apply-goal-filter.ts`), reusing `lib/harvest-runner.ts`, `lib/parse-common.ts`, `fetch-guards.ts`, and fixture-based Vitest coverage. Data model gains `sourceChannel` + `confidence` on `Car`; a third `DealPhase = "market"` covers dealer below-FIPE listings.

## Confirmed decisions (2026-07-20)

- Full scope including WhatsApp/Telegram + Facebook Marketplace **spikes** (decision docs only, no pipeline code)
- New `DealPhase = "market"` for dealer below-FIPE listings (NaPista, storefronts)
- Webmotors is **repasse-only**: fail-closed `repasse-economics.ts` gate like OLX; non-repasse ads skipped
- Regions: all major regions, **south prioritized (SC first, then PR/RS)** — buyer lives in SC; southern cars are cheaper to inspect/transport
- New sources enter daily cadence **only after ≥3 clean supervised runs** (AD-7)
- **Probe-first rule**: every harvester task starts with a live-site freshness probe + fixture capture. Repasso was found dead — never build before probing.

## Global constraints (carried over, all still binding)

- Fail closed: never guess brand, model, year, price, body type. Ambiguous repasse economics → `null`.
- Damage gate (colisão/sinistro/monta/sucata/batido) applies to all new sources.
- Safety ceiling: 1000 writes per source per run.
- Public unauthenticated pages only; never bypass logins/CAPTCHA/anti-bot. If a site blocks hard, stop and report — do not escalate evasion.
- LGPD minimization: one seller contact handle max, stored only in `sellerContact`; no CPF; contact never copied into notes.
- `--out` paths under `/tmp` or `<cwd>/tmp` (`fetch-guards.ts`).
- `npm test` and `npx tsc --noEmit` green after each phase.

## Architecture decisions

### AD-1 — New `Car` columns

- `sourceChannel String @default("classifieds")` — `classifieds | aggregator | messaging_group | forum | storefront | auction_house`
- `confidence String @default("high")` — `low | medium | high`
- Backfill: auction platforms → `auction_house`, OLX → `classifieds`; existing rows `confidence = "high"`
- Validation in `write-lead.ts` (mirror `VALID_SELLER_TYPES`); types in `src/lib/types.ts`; mapping in `src/lib/aggregate.ts`

### AD-2 — `"market"` DealPhase

Added to `DealPhase` + `DEAL_PHASE_LABEL` (`src/lib/types.ts`). Validated like auction in `write-lead.ts` (`askingPriceBRL` required, repasse fields forbidden). `HarvestPhase`/`PHASE_SOURCES`/`parseHarvestPhase` in `scripts/ingestion/harvest.ts` gain `market`. No Prisma migration needed (plain string column).

### AD-3 — Per-source assignments

| Source | sourceChannel | confidence | dealPhase | sellerType |
|---|---|---|---|---|
| Existing auctions | auction_house | high | auction | (unchanged) |
| OLX repasse | classifieds | medium | pre_repossession | repasse |
| NaPista | aggregator | high | market | dealer |
| Webmotors | classifieds | medium | pre_repossession | repasse |
| Storefronts | storefront | medium | market | repasse |
| WhatsApp/Telegram (spike) | messaging_group | low | pre_repossession | owner |
| Facebook (spike) | classifieds | low | pre_repossession | owner |

### AD-4 — NaPista scope control

230k listings vs 1000-write ceiling → constrain at discovery via `NAPISTA_TARGETS` config (cities × years ≥2021, page caps). South-first city ordering: Florianópolis/Joinville/Curitiba/Porto Alegre, then SP/RJ/BH/Nordeste. Probe must verify the real URL pattern (`/busca/carro/{city}/{year}/valor-abaixo-da-fipe` is unverified) before code.

### AD-5 — One config-driven storefront harvester

`storefront-sites.ts` config array + single `storefront-harvest.ts` (plain fetch, no Playwright — static HTML). Adding a storefront later = one config entry + one fixture.

### AD-6 — Spikes produce decision docs, not code

Integration contract if greenlit: `spawnWriteLead` with `confidence: "low"`, `sourceChannel: "messaging_group"`, single `sellerContact` handle (LGPD column-only rule).

### AD-7 — Gated cadence entry

Register in `harvest.ts` + npm scripts immediately (manual runs); add to `lib/cadence-schedule.ts` SCHEDULE only after ≥3 clean supervised runs per source.

## Reused infrastructure (do not rebuild)

- `scripts/ingestion/write-lead.ts` — central writer, 3-tier dedup (sourceUrl → chassis → plate), CarSource merge, LGPD contact rule, 1000-write ceiling
- `scripts/ingestion/lib/harvest-runner.ts` — `spawnWriteLead`, `HarvestSummary`, `throttleFetch`
- `scripts/ingestion/lib/parse-common.ts` — `parseBrl`, `parseKm`, `parseYearFromText`, `normalizeBrandModel`, `inferBodyType`
- `scripts/ingestion/lib/repasse-economics.ts` + `repasse-urgency.ts` — fail-closed extraction (Webmotors reuses as-is)
- `scripts/ingestion/fetch-guards.ts` — `assertHost`, `assertNotCloudflareBlock`, `assertSafeOutPath`
- `scripts/ingestion/apply-goal-filter.ts` — auto post-harvest triage (0→rejected, <50→parked, ≥50→new_lead)
- Test pattern: Vitest + `__tests__/fixtures/` snapshots + `createTestDb()`

## Phases and tasks

### Phase 0 — Foundation (serial, gates everything)

**Task 0.1 — Prisma migration: sourceChannel + confidence (S)**
Add columns to `Car` in `prisma/schema.prisma`; `npx prisma migrate dev --name add_source_channel_confidence`; hand-append backfill UPDATEs (auction platforms → `auction_house`, OLX → `classifieds`).
- Accept: migration applies; backfill correct per platform; `npx prisma validate` passes.
- Verify: `npx prisma migrate dev`; sqlite `GROUP BY sourcePlatform, sourceChannel, confidence` spot-check.

**Task 0.2 — Types + write-lead plumbing (S)** — deps: 0.1
`SourceChannel`/`LeadConfidence` types + labels in `src/lib/types.ts`; extend `WriteLeadInput` with validated `sourceChannel`/`confidence`; `defaultChannelForPlatform()` in write-lead (auction harvesters unchanged); `olx-harvest.ts` passes explicit values.
- Accept: write-lead.test.ts covers validation/defaults/persistence; OLX + one auction dry-run behavior unchanged.
- Verify: `npx vitest run scripts/ingestion/__tests__/write-lead.test.ts`; `npm run harvest -- --source olx --dry-run --limit 3`.

**Task 0.3 — "market" DealPhase (S)** — deps: 0.2
Per AD-2 across `types.ts`, `write-lead.ts`, `harvest.ts` (`PHASE_SOURCES.market: []`), badge labels in `cars-table-view.tsx` + `car-detail-tabs.tsx`.
- Accept: write-lead rejects market leads carrying `entryAskBRL`; `--phase market` parses; UI renders market badge.
- Verify: `npx vitest run scripts/ingestion/__tests__`; `npx tsc --noEmit`.

**Task 0.4 — UI surfacing of channel/confidence (S, may trail to any later phase)** — deps: 0.2
Map both fields in `src/lib/aggregate.ts`; confidence badge (low = amber "verify") next to phase badge in table + detail views.
- Verify: `npx vitest run src`; `npm run dev` glance.

**CHECKPOINT C1**: full `npx vitest run` green · migration + backfill verified · OLX and one auction source dry-run clean · human review.

### Phase 1 — OLX expansion (quick win)

**Task 1.1 — Queries, regions, pagination (S)** — deps: C1
Probe regional subdomain markup first; refresh fixture if drifted. Extend `OLX_QUERIES` with "transferir financiamento", "veículo já financiado", "quitar e transferir", "aceito repasse". Add `OLX_REGION_HOSTS` south-first: `sc`, `pr`, `rs`, then `sp`, `rj`, `mg`, `pb`, `pe`, `ce`, `rn`, plus `www`. Raise `--max-pages` 5→8. Dedupe by `listId` across regions before fetch. `confidence: "medium"` in olx-harvest.
- Accept: URL construction + cross-region dedupe tested; live run yields more unique ads than baseline; no dup Car rows.
- Verify: `npx vitest run scripts/ingestion/__tests__/olx-parse.test.ts`; `npm run harvest -- --source olx --dry-run --limit 10`.

### Phase 2 — NaPista harvester (top priority)

**Task 2.1 — NaPista vertical slice (M)** — deps: C1 (incl. 0.3)
**Probe (blocking):** verify live 2026 listings; confirm/correct URL pattern; find embedded JSON (`__NEXT_DATA__`?); check robots/Cloudflare; capture `fixtures/napista-search-snippet.html`. Dead/gated → stop, report, re-prioritize.
Build `napista-list.ts` (plain fetch if probe allows, Playwright+stealth otherwise; `NAPISTA_TARGETS` south-first cities × years ≥2021), `napista-parse.ts` (deterministic; parse-common; damage gate; no financing gate), `napista-harvest.ts` (`dealPhase: "market"`, `sellerType: "dealer"`, `sourceChannel: "aggregator"`, `confidence: "high"`; auto goal-filter). Register `HarvestSource` + `PHASE_SOURCES.market` + `harvest:napista` npm script.
- Accept: fixture tests ≥5 assertions incl. price/year/city; dry-run end-to-end works; writes bounded by config.
- Verify: `npx vitest run scripts/ingestion/__tests__/napista-parse.test.ts`; `npm run harvest -- --source napista --dry-run --limit 5`.

**CHECKPOINT C2**: tests green · human eyeballs 10 dry-run rows (prices vs FIPE, no invented fields) · one real `--limit 20` run reviewed in UI with correct badges.

### Phase 3 — Webmotors harvester

**Task 3.1 — Webmotors vertical slice, repasse-only (M)** — deps: C1; independent of Phase 2
**Probe (blocking, 2h timebox):** Playwright+stealth keyword search ("financiado", "repasse"); expect Cloudflare/Akamai; check `/api/search` XHR in browser context; capture fixtures. Hard-blocked → report + deprioritize (do not escalate evasion).
Mirror OLX: `webmotors-list.ts`, `webmotors-parse.ts` (fail-closed repasse gate — non-repasse ads skipped), `webmotors-harvest.ts` (`pre_repossession`, `classifieds`, `medium`, `repasse`). Register `PHASE_SOURCES.pre` + npm script.
- Accept: fixture tests incl. one repasse-positive + one repasse-negative case; pre_repossession invariants honored (no askingPriceBRL supplied).
- Verify: `npx vitest run scripts/ingestion/__tests__/webmotors-parse.test.ts`; `npm run harvest -- --source webmotors --dry-run --limit 5`.

### Phase 4 — Storefront config harvester

**Task 4.1 — Clube Repasse + CG Veículos + Compra Certa (M)** — deps: C1
**Probe:** freshness-check all three (only Clube Repasse verified live in spec); one fixture per live site; drop dead sites from config with comment.
Build `storefront-sites.ts` (config: id, name, listUrl, selector/regex hints, city/state defaults) + `storefront-harvest.ts` (plain fetch + fetch-guards + throttleFetch; per-site try/catch so one failure doesn't kill the run) → `spawnWriteLead` (`market`, `repasse`, `storefront`, `medium`). Register `storefronts` source + npm script.
- Accept: one fixture test per live site; dry-run covers all sites; graceful per-site failure skip.
- Verify: `npx vitest run scripts/ingestion/__tests__/storefront-parse.test.ts`; `npm run harvest -- --source storefronts --dry-run`.

**CHECKPOINT C3**: full suite green · every registered source passes `--dry-run --limit 5` · cadence untouched · human spot-check of one limited real run per source in UI.

### Phase 5 — Cadence, skills, docs (serial convergence)

**Task 5.1 — Gated cadence + skill registration (S)** — deps: C3 + ≥3 clean supervised runs per source
Add to `CadenceSource` + `SCHEDULE` in `lib/cadence-schedule.ts` (proposal: napista daily; webmotors Mon/Wed/Fri; storefronts Tue/Fri). Create `.claude/skills/harvest-napista`, `harvest-webmotors`, `harvest-storefronts` SKILL.md mirroring `harvest-repasse`. Update this file + `tasks/todo.md`.
- Verify: `npx vitest run scripts/ingestion/__tests__/cadence-schedule.test.ts scripts/ingestion/__tests__/run-cadence.test.ts`; cadence dry-run for a future date.

### Phase 6 — Spikes (independent; anytime after C1; docs only, no pipeline code)

**Task 6.1 — WhatsApp/Telegram listener spike (M, timebox 1–2 days)**
Join 10–15 repasse groups (dedicated phone number — human action); prototype capture via `whatsapp-web.js` (TOS/ban risk) vs Telegram Bot API/MTProto; prove LLM extraction on ~20 real messages → WriteLeadInput shape. Deliverable: `docs/spikes/messaging-listener-spike.md` (go/no-go, architecture sketch, cost/ban-risk, LGPD posture).

**Task 6.2 — Facebook Marketplace RapidAPI spike (S, timebox half day)**
Trial RapidAPI FB scraper free tier (needs key — human provisioning); repasse terms in SC/PR/SP; assess field coverage vs WriteLeadInput, freshness, rate limits, cost. Deliverable: `docs/spikes/facebook-marketplace-spike.md`.

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| Webmotors anti-bot (stronger than OLX) | Phase 3 blocked | Probe-first, 2h timebox; in-browser XHR fallback; deprioritize rather than fight |
| NaPista URL pattern in spec wrong | Phase 2 rework | Mandatory blocking probe before code |
| Source death (CG Veículos/Compra Certa unverified) | Wasted build | Freshness probe per source; config-driven drops are one-line |
| NaPista volume vs 1000-write ceiling | DB flooded with parked leads | City×year config, page caps, `--limit`; goal filter auto-runs |
| Cross-source dupes (NaPista+Webmotors; OLX regional overlap) | Duplicate Cars | listId dedupe pre-fetch; write-lead 3-tier dedup + CarSource merge |
| WhatsApp TOS / number ban | Account loss | Spike-only; burner number; prefer Telegram official API; human go/no-go |
| LGPD — contacts from messaging groups | Compliance | Single handle in `sellerContact` column only, never notes |
| confidence default "high" over-scores noisy sources | Bad triage | New harvesters set confidence explicitly; default covers legacy callers only |

## Parallelization

- Phase 0 strictly serial (0.1 → 0.2 → 0.3; 0.4 can trail).
- After C1: Tasks 1.1, 2.1, 3.1, 4.1 mutually independent (disjoint files; shared touchpoints are the `HarvestSource` union + one npm-script line each — trivial merges). Up to 4 parallel worktrees.
- Spikes 6.1/6.2 fully independent, can start after C1.
- Phase 5 is the serial convergence point.

## End-to-end verification

1. `npx vitest run` — full suite green
2. `npx prisma validate` + sqlite GROUP BY check of backfill
3. `npm run harvest -- --source <each> --dry-run --limit 5` for olx, napista, webmotors, storefronts
4. One real `--limit 20` run per new source → review in UI: phase/channel/confidence badges, no invented fields, goal filter applied
5. Cadence dry-run for a future date shows new sources only after Task 5.1
