# Implementation Plan: Tier 1 Coverage — Deterministic Full-Catalog Harvest

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scale ingestion from demo/sample harvests (~188 cars, 1 lot/source for BIDchain/PB) to full-catalog, repeatable harvest scripts for BIDchain/Caixa, VIP Financeiras, Bradesco Vitrine, Santander Retomados, and MGL corporate repossession — with minimal agent token usage.

**Architecture:** Promote existing `_tmp-*` harvest prototypes into production `*-harvest.ts` CLIs that run end-to-end (discover → fetch → parse → `write-lead` → `apply-goal-filter`) without the agent reading HTML. Extract shared parsing, filtering, and tally logic into `scripts/ingestion/lib/`. Each source gets a vertical slice: list discovery, batch fetch, deterministic parse/write, fixture tests, thin skill doc. A top-level `harvest.ts` orchestrator runs one or all sources and prints JSON summary.

**Tech Stack:** TypeScript, `tsx`, Playwright + stealth (VIP/MGL/BIDchain), Bradesco JSON API, Vitest fixtures, existing `write-lead.ts` / `apply-goal-filter.ts` trust boundary.

## Global Constraints

- Fail closed: never guess brand, model, year, price, body type, or bank attribution (`SPEC.md`, v1 design doc).
- Damage gate: colisão / sinistro / monta / sucata / batido → hard reject at parse and `write-lead`.
- `askingPriceBRL` = lance mínimo; stamp in notes.
- `mileageKm: null` when undisclosed.
- Safety ceiling: **1000 writes per source per run** (log + stop; do not silently truncate).
- No bidding, no login automation except existing VIP session file (human-only login).
- `--out` paths must stay under `/tmp` or `<cwd>/tmp` (`fetch-guards.ts`).
- `npm test` and `npm run build` must pass after each phase.
- Ask owner before adding npm dependencies beyond current Playwright stack.
- Ask owner before unattended scheduled/cron harvests (scripts are manual/one-shot for now; cron is follow-up).

---

## Problem Statement (context)

Current ingestion is agent-driven and sample-sized:

| Source | DB count | Issue |
|--------|----------|-------|
| Bradesco Vitrine | 100 | Single batch; 75% pre-2020; no list/fetch production scripts |
| VIP Leilões | 34 | Financeiras deep harvest exists only as `_tmp-*` |
| BIDchain | 1 | Demo lot only |
| MGL | 52 | Batidos auction contamination (18 rejections); no auction-level filter |
| Santander Retomados | 0 | Not implemented |

Agent reads HTML per lot → high token cost, inconsistent coverage. Target: **one command per source**, agent reads only JSON summary.

---

## Dependency Graph

```
Phase 0: scripts/ingestion/lib/*  (shared parse, filters, tally, write-lead spawn)
    │
    ├── Phase 1: Bradesco  (bradesco-list → bradesco-fetch → bradesco-harvest)
    │       └── harvest skill update (Bradesco section → one command)
    │
    ├── Phase 2: VIP Financeiras  (vip-list-financeiras → vip-fetch-batch → vip-harvest)
    │       └── harvest-auction-leads skill slim-down
    │
    ├── Phase 3: BIDchain  (bidchain-list → bidchain-harvest)
    │       └── harvest-bidchain skill slim-down
    │
    ├── Phase 4: MGL corporate  (mgl-list-auctions → mgl-harvest w/ auction filter)
    │       └── harvest-mgl skill slim-down
    │
    └── Phase 5: Santander Retomados  (probe → list → fetch → harvest + new skill)
            └── harvest-santander skill (new)

Top-level: scripts/ingestion/harvest.ts  (orchestrator — depends on Phases 1–5)
```

Build order: **Phase 0 first** (all sources depend on shared lib). Phases 1–4 can parallelize after Phase 0. Phase 5 starts with probe (can parallel with 1–4 but harvest depends on probe).

---

## Phase 0: Shared harvest infrastructure

### Task 0.1: `scripts/ingestion/lib/parse-common.ts`

**Files:**
- Create: `scripts/ingestion/lib/parse-common.ts`
- Create: `scripts/ingestion/__tests__/parse-common.test.ts`
- Modify: `scripts/ingestion/_tmp-bradesco-harvest.ts` (import shared helpers — temporary, removed when promoted)

**Interfaces:**
- Produces: `parseBrl(raw: string): number | null`, `parseKm(raw: string): number | null`, `parseYearFromText(text: string): { year: number; modelYear?: number } | null`, `normalizeBrand(raw: string): string`, `inferBodyType(brand: string, model: string, blob: string): BodyType | null`, `BRAND_ALIASES`, `MODEL_BODY_RULES`

Extract duplicated logic from `_tmp-bradesco-harvest.ts`, `_tmp-bidchain-harvest-write.ts`, `mgl-harvest-write.ts`, `_tmp-vip-write-from-details.ts`. Keep behavior identical to existing Bradesco body-type rules (fail closed on ambiguous).

**Acceptance criteria:**
- [ ] All parse helpers exported with types from `src/lib/types.ts`
- [ ] Tests cover BRL (`R$ 47.900,00`), km (`116.406 km`), year (`2022/2023`), T-Cross → suv, Gol → hatch
- [ ] `inferBodyType("Volkswagen", "T-Cross", "")` → `"suv"`; unknown model → `null`

**Verification:**
- [ ] `npx vitest run scripts/ingestion/__tests__/parse-common.test.ts`

---

### Task 0.2: `scripts/ingestion/lib/listing-filters.ts`

**Files:**
- Create: `scripts/ingestion/lib/listing-filters.ts`
- Create: `scripts/ingestion/__tests__/listing-filters.test.ts`

**Interfaces:**
- Produces:
  - `isBatidosAuction(url: string, title: string): boolean` — matches `batidos`, `sucatas`, `sinistrados` in slug/title
  - `isInsurerComitente(text: string): boolean` — Mapfre, Porto, Allianz, HDI, Tokio, Zurich, etc.
  - `isBradescoSinistrado(recoveryType: string): boolean` — `Sinistrado` recovery type
  - `shouldSkipListing(input: ListingFilterInput): { skip: boolean; reason?: string }`

**Acceptance criteria:**
- [ ] `isBatidosAuction(".../leilao-de-veiculos-batidos-localiza...", "")` → true
- [ ] `isInsurerComitente("MAPFRE SEGUROS GERAIS")` → true
- [ ] `isBradescoSinistrado("Sinistrado")` → true; `"Retomado"` → false
- [ ] MGL corp repasse URL → not skipped

**Verification:**
- [ ] `npx vitest run scripts/ingestion/__tests__/listing-filters.test.ts`

---

### Task 0.3: `scripts/ingestion/lib/harvest-runner.ts`

**Files:**
- Create: `scripts/ingestion/lib/harvest-runner.ts`
- Create: `scripts/ingestion/__tests__/harvest-runner.test.ts`

**Interfaces:**
- Produces:
  - `HarvestSummary` type: `{ source, scanned, written: { created, updated, merged }, skipped: Record<string, number>, errors: Array<{url, error}>, durationMs }`
  - `runWithCeiling(maxWrites: number, fn: () => Promise<void>): void`
  - `spawnWriteLead(input: WriteLeadInput): { ok: boolean; error?: string }` — wraps `write-lead.ts` via spawnSync (same pattern as `_tmp-bradesco-harvest.ts`)
  - `writeSummary(path: string, summary: HarvestSummary): void`
  - `DEFAULT_CEILING = 1000`

**Acceptance criteria:**
- [ ] Ceiling stops writes at 1000 with reason logged
- [ ] Summary JSON written to `--summary-out` path under safe tmp root
- [ ] Failed write-lead captured in `errors[]` without aborting entire run

**Verification:**
- [ ] `npx vitest run scripts/ingestion/__tests__/harvest-runner.test.ts`

---

### Checkpoint 0
- [ ] `npx vitest run scripts/ingestion/__tests__/` passes (new + existing)
- [ ] `npx tsc --noEmit` passes
- [ ] Human review before source harvests

---

## Phase 1: Bradesco full catalog (vertical slice)

### Task 1.1: `bradesco-list.ts` — paginated JSON discovery

**Files:**
- Create: `scripts/ingestion/bradesco-list.ts`
- Create: `scripts/ingestion/__tests__/bradesco-list.test.ts` (fixture-based parser tests)

**Behavior:**
- Discover Bradesco Vitrine JSON list endpoint (inspect network on `/auctions` — same API used by existing Apify actor per design doc).
- CLI: `npx tsx scripts/ingestion/bradesco-list.ts --out /tmp/bradesco-harvest/list.json [--page-size N] [--max-pages N]`
- Output: `{ lots: Array<{ guid, slug, name, price, category, ... }>, meta: { pages, total } }`
- Filter at list level: `category !== "Carro"` → skip; `vehicle_type_of_recovery === "Sinistrado"` → skip (via listing-filters)

**Acceptance criteria:**
- [ ] Produces valid JSON under `--out`
- [ ] Paginates until empty page or `--max-pages`
- [ ] Sinistrado lots excluded from output (logged in stderr counts)

**Verification:**
- [ ] Fixture test with saved list JSON snippet
- [ ] Manual: `bradesco-list.ts --max-pages 2` → ≥1 car lot

---

### Task 1.2: `bradesco-fetch.ts` — batch detail fetch

**Files:**
- Create: `scripts/ingestion/bradesco-fetch.ts`

**Behavior:**
- CLI: `npx tsx scripts/ingestion/bradesco-fetch.ts --list /tmp/bradesco-harvest/list.json --out-dir /tmp/bradesco-harvest/details [--limit N] [--skip-existing]`
- Fetch detail JSON per guid; skip files already on disk when `--skip-existing`
- Rate limit: 200ms between requests

**Acceptance criteria:**
- [ ] Writes `details/{guid}.json` per lot
- [ ] `--skip-existing` avoids re-fetching
- [ ] Failures logged; run continues

**Verification:**
- [ ] Manual smoke with `--limit 5`

---

### Task 1.3: `bradesco-harvest.ts` — promote writer to production

**Files:**
- Create: `scripts/ingestion/bradesco-harvest.ts` (from `_tmp-bradesco-harvest.ts`)
- Delete or archive: `scripts/ingestion/_tmp-bradesco-harvest.ts` after promotion
- Modify: `.claude/skills/harvest-auction-leads/SKILL.md`

**Behavior:**
- CLI: `npx tsx scripts/ingestion/bradesco-harvest.ts [--list PATH] [--details-dir PATH] [--dry-run] [--limit N]`
- Pipeline: read list + details → parse → damage gate → `spawnWriteLead` → tally
- End of run: `apply-goal-filter.ts --min-goal-fit 50` (unless `--no-goal-filter`)
- Uses `parse-common.ts`, `listing-filters.ts`, `harvest-runner.ts`

**Acceptance criteria:**
- [ ] Full run: list → fetch → write without agent reading HTML
- [ ] `--dry-run` parses and tallies skips without DB writes
- [ ] Summary includes skip reasons: damage, missing_fields, ambiguous_body, sinistrado
- [ ] ≥50 writes on full catalog run (expect ~100 based on current batch)
- [ ] SUV rate measurable in summary (bodyType counts)

**Verification:**
- [ ] `npx vitest run` (existing suite green)
- [ ] Manual full harvest + compare brand/year distribution vs current DB

---

### Checkpoint 1
- [ ] Bradesco end-to-end: `bradesco-list → bradesco-fetch → bradesco-harvest`
- [ ] Skill updated: agent runs 1 command, reads summary JSON only
- [ ] Human review sample rows (spot-check T-Cross / SUV lots for damage)

---

## Phase 2: VIP Financeiras deep harvest (vertical slice)

### Task 2.1: `vip-list-financeiras.ts` — dynamic event discovery

**Files:**
- Create: `scripts/ingestion/vip-list-financeiras.ts` (from `_tmp-vip-collect-financeiras.mjs`)
- Create: `scripts/ingestion/__tests__/vip-list-financeiras.test.ts`

**Behavior:**
- CLI: `npx tsx scripts/ingestion/vip-list-financeiras.ts --out /tmp/vip-financeiras-lots.json`
- Requires saved session: `.claude/browser-profile/vip-leiloes-state.json`
- Discover Financeiras events dynamically (parse event index for `bs*` IDs + date filters), not hardcoded list
- Paginate each event (30 page cap per event, same as tmp script)
- Output: `{ lots: Array<{ event, url, text }>, meta: { events, totalLots } }`

**Acceptance criteria:**
- [ ] Discovers ≥10 financeira events without hardcoded ID list
- [ ] Produces ≥100 lot URLs (current tmp run found more; 34 writes means parse/filter gap, not list gap)
- [ ] Session missing → clear error message pointing to `vip-leiloes-login.ts`

**Verification:**
- [ ] Fixture test for event ID extraction regex
- [ ] Manual run with valid session

---

### Task 2.2: `vip-fetch-batch.ts` — batch lot detail fetch

**Files:**
- Create: `scripts/ingestion/vip-fetch-batch.ts` (from `_tmp-vip-batch-fetch-incremental.mjs`)

**Behavior:**
- CLI: `npx tsx scripts/ingestion/vip-fetch-batch.ts --lots /tmp/vip-financeiras-lots.json --out /tmp/vip-financeiras-details.json [--limit N] [--skip-existing]`
- Uses VIP session + stealth Playwright
- Incremental: merge into details JSON, cache per URL
- Extract structured fields server-side (title, fields map, ofertaInicial, editalUrl) — no agent HTML reading

**Acceptance criteria:**
- [ ] Fetches ≥50 lot details in one run
- [ ] `--skip-existing` resumes interrupted runs
- [ ] Cloudflare block → fail with actionable error

**Verification:**
- [ ] Manual `--limit 10` smoke

---

### Task 2.3: `vip-harvest.ts` — promote writer

**Files:**
- Create: `scripts/ingestion/vip-harvest.ts` (from `_tmp-vip-write-from-details.ts`)
- Archive `_tmp-vip-*` scripts after promotion
- Modify: `.claude/skills/harvest-auction-leads/SKILL.md`

**Behavior:**
- CLI: `npx tsx scripts/ingestion/vip-harvest.ts [--details PATH] [--dry-run] [--limit N] [--exclude-insurer]`
- Parse comitente → sellerType (Caixa / bank / auction)
- Damage gate + listing-filters (optional `--exclude-insurer` skips Mapfre/Porto/etc. at parse time)
- Chain `apply-goal-filter` at end

**Acceptance criteria:**
- [ ] ≥80 writes from full financeiras catalog (up from 34)
- [ ] `--exclude-insurer` drops insurer collision lots before write
- [ ] Summary JSON with skip reason breakdown

**Verification:**
- [ ] Manual full run; compare VIP count in DB

---

### Checkpoint 2
- [ ] VIP pipeline end-to-end without agent reading HTML
- [ ] Financeiras lot count ≥100 discovered
- [ ] Human review: confirm no Mapfre-style collision lots in `new_lead` when `--exclude-insurer` used

---

## Phase 3: BIDchain / Caixa at scale (vertical slice)

### Task 3.1: `bidchain-list.ts` — vehicle lot discovery

**Files:**
- Create: `scripts/ingestion/bidchain-list.ts`
- Create: `scripts/ingestion/__tests__/bidchain-list.test.ts`

**Behavior:**
- CLI: `npx tsx scripts/ingestion/bidchain-list.ts --out /tmp/bidchain-lots.json [--category vehicles] [--max-pages N]`
- Sources: `bidchain.com.br/por-categoria/4`, active leilão pages, white-label hosts (adrileiloes, canaldeleiloes)
- Playwright + stealth; extract lot URLs + titles from listing HTML or embedded JSON
- Skip lots with sucata/batido in title at list level

**Acceptance criteria:**
- [ ] Discovers ≥50 vehicle lot URLs in one run
- [ ] Includes both bidchain.com.br and white-label URLs
- [ ] Output JSON with `{ lots: [{ id, url, title, host }] }`

**Verification:**
- [ ] Fixture test for lot URL extraction from saved HTML
- [ ] Manual list run

---

### Task 3.2: `bidchain-harvest.ts` — list + fetch + write

**Files:**
- Create: `scripts/ingestion/bidchain-harvest.ts` (from `_tmp-bidchain-harvest-write.ts`)
- Archive `_tmp-bidchain-harvest-write.ts`
- Modify: `.claude/skills/harvest-bidchain/SKILL.md`

**Behavior:**
- CLI: `npx tsx scripts/ingestion/bidchain-harvest.ts [--lots PATH] [--fetch-dir /tmp/bid-harvest/lots] [--dry-run] [--limit N]`
- If `--lots` provided: fetch each lot HTML via `fetchBidchainHtml`, parse, write
- Reuse parse logic from tmp script via `parse-common.ts`
- Chain `apply-goal-filter`

**Acceptance criteria:**
- [ ] ≥30 BIDchain writes in one full run (up from 1)
- [ ] sellerType correctly tagged from comitente (Caixa vs judicial vs bank)
- [ ] Summary with host breakdown (bidchain vs adrileiloes vs canaldeleiloes)

**Verification:**
- [ ] Manual full run
- [ ] `npx vitest run scripts/ingestion/__tests__/bidchain-fetch.test.ts` still passes

---

### Checkpoint 3
- [ ] BIDchain count in DB ≥30
- [ ] Skill doc: single command, no per-lot agent procedure
- [ ] Human review sample Caixa-tagged lots

---

## Phase 4: MGL corporate repossession only (vertical slice)

### Task 4.1: `mgl-list-auctions.ts` — discover corp repasse leilões

**Files:**
- Create: `scripts/ingestion/mgl-list-auctions.ts`
- Create: `scripts/ingestion/__tests__/mgl-list-auctions.test.ts`

**Behavior:**
- CLI: `npx tsx scripts/ingestion/mgl-list-auctions.ts --out /tmp/mgl-auctions.json`
- Crawl MGL leilão index; include only auctions matching corp repossession patterns (`repasse-de-veiculos-corporativos`, `repasse`, fleet keywords)
- Exclude via `listing-filters.isBatidosAuction`: batidos, sucatas, sinistrados slugs
- Output: `{ auctions: [{ id, url, title, slug }] }`

**Acceptance criteria:**
- [ ] Zero batidos/sucatas auctions in output
- [ ] Includes known corp repasse auction (e.g. `/leilao/repasse-de-veiculos-corporativos/7186/`)
- [ ] Excludes `/leilao-de-veiculos-batidos-localiza-e-parceiros/`

**Verification:**
- [ ] Unit tests for slug filter rules
- [ ] Manual list run

---

### Task 4.2: `mgl-harvest.ts` — promote + wire auction filter

**Files:**
- Create: `scripts/ingestion/mgl-harvest.ts` (from `mgl-harvest-write.ts` + list step)
- Modify: `scripts/ingestion/mgl-list-lots.ts` — accept `--auctions` filter file
- Modify: `.claude/skills/harvest-mgl/SKILL.md`

**Behavior:**
- CLI: `npx tsx scripts/ingestion/mgl-harvest.ts [--auctions /tmp/mgl-auctions.json] [--fetch-dir /tmp/mgl-harvest/lots] [--dry-run] [--limit N]`
- Pipeline: list auctions → list lots per auction (existing API) → fetch lot HTML → parse → write
- Auction-level batidos filter **before** lot fetch (saves tokens + time)
- Chain `apply-goal-filter`

**Acceptance criteria:**
- [ ] Zero writes from batidos auctions (no more bulk rejections like MGL 7157)
- [ ] Corp repasse lots still written (2022–2024 Polo/Onix pattern preserved)
- [ ] ≥30 MGL writes from corp auctions only

**Verification:**
- [ ] Manual run; confirm `stageReason` batidos rejections drop to 0 for new harvest

---

### Checkpoint 4
- [ ] MGL harvest excludes batidos at auction level
- [ ] Corp repasse inventory still captured
- [ ] Human review sample rows

---

## Phase 5: Santander Retomados (vertical slice — new source)

### Task 5.1: Probe + spec note

**Files:**
- Create: `docs/superpowers/specs/2026-07-15-santander-retomados-probe.md`
- Create: `scripts/ingestion/santander-probe.ts`

**Behavior:**
- Manual/automated probe of `https://www.santander.com.br/retomados` (and subdomains/CDN if redirected)
- Document: public vs login, JSON API vs HTML, pagination, field availability, Cloudflare, sample lot URL
- Probe script writes `/tmp/santander-probe/report.json`

**Acceptance criteria:**
- [ ] Probe doc answers: browse without login? pagination shape? fields for brand/model/year/price/km/plate/chassis?
- [ ] ≥1 sample lot URL captured
- [ ] Host allowlist decided for fetch guards

**Verification:**
- [ ] Human review probe doc before implementing fetch/harvest

---

### Task 5.2: `santander-list.ts` + `santander-fetch.ts`

**Files:**
- Create: `scripts/ingestion/santander-list.ts`
- Create: `scripts/ingestion/santander-fetch.ts`
- Create: `scripts/ingestion/__tests__/santander-list.test.ts`

**Behavior:** (shapes finalized by probe — plan assumes JSON or HTML listing similar to Bradesco)
- List all retomado vehicle lots to JSON
- Batch fetch lot detail
- Host allowlist in fetch-guards pattern

**Acceptance criteria:**
- [ ] Discovers ≥20 vehicle lots
- [ ] Detail fetch works without login (or documents login requirement → stop and ask owner)

**Verification:**
- [ ] Fixture tests from probe captures
- [ ] Manual `--limit 5` fetch

---

### Task 5.3: `santander-harvest.ts` + skill

**Files:**
- Create: `scripts/ingestion/santander-harvest.ts`
- Create: `.claude/skills/harvest-santander/SKILL.md`
- Modify: `scripts/ingestion/fetch-guards.ts` (Santander hosts)

**Behavior:**
- Full pipeline: list → fetch → parse → write
- `sourcePlatform: "Santander Retomados"`, `sellerType: "bank_recovery"`
- Damage gate + sinistrado filter if Santander exposes recovery type
- Chain `apply-goal-filter`

**Acceptance criteria:**
- [ ] ≥10 confident writes in first full run
- [ ] Platform string stable in DB
- [ ] Skill doc: one command

**Verification:**
- [ ] Manual full run
- [ ] `npm test` green

---

### Checkpoint 5
- [ ] Santander probe reviewed and harvest working
- [ ] Human review sample rows (compare quality vs insurer lots)

---

## Phase 6: Orchestrator + npm scripts + skill slim-down

### Task 6.1: `harvest.ts` top-level orchestrator

**Files:**
- Create: `scripts/ingestion/harvest.ts`
- Modify: `package.json` (add npm scripts)

**Behavior:**
```bash
# One source
npx tsx scripts/ingestion/harvest.ts --source bradesco
npx tsx scripts/ingestion/harvest.ts --source vip --exclude-insurer
npx tsx scripts/ingestion/harvest.ts --source bidchain
npx tsx scripts/ingestion/harvest.ts --source mgl
npx tsx scripts/ingestion/harvest.ts --source santander

# All Tier 1 sources sequentially
npx tsx scripts/ingestion/harvest.ts --all

# Common flags forwarded: --dry-run, --limit N, --no-goal-filter
```

- Runs source harvest sequentially; prints combined summary JSON
- Exit code non-zero if any source errors > threshold

**Acceptance criteria:**
- [ ] `npm run harvest -- --source bradesco --dry-run` works
- [ ] `--all` runs 5 sources, combined summary at `/tmp/harvest-summary.json`
- [ ] Agent token usage: **zero HTML reading** when following skill

**Verification:**
- [ ] Manual `--all --dry-run`

---

### Task 6.2: Slim all harvest skills to orchestrator commands

**Files:**
- Modify: `.claude/skills/harvest-auction-leads/SKILL.md`
- Modify: `.claude/skills/harvest-bidchain/SKILL.md`
- Modify: `.claude/skills/harvest-mgl/SKILL.md`
- Create: `.claude/skills/harvest-santander/SKILL.md`

**Acceptance criteria:**
- [ ] Each skill primary instruction is ≤10 lines: run command, read summary, report counts
- [ ] Per-lot HTML reading steps removed (moved to "debugging only")
- [ ] Damage/goal rules referenced but not repeated in full

**Verification:**
- [ ] Read-through review

---

### Checkpoint 6 (Final)
- [ ] `npm test` + `npm run build` green
- [ ] Full Tier 1 harvest (`--all`) produces ≥200 new/updated leads combined
- [ ] DB source distribution: no source stuck at ≤1 lot
- [ ] SUV / target-brand rate logged in summary for owner review
- [ ] Token benchmark: agent harvest of one source uses ≤1 tool call (run script) + read summary file

---

## Success Metrics (Tier 1 complete)

| Metric | Current | Target |
|--------|---------|--------|
| Total cars | 188 | ≥400 after full `--all` run |
| BIDchain | 1 | ≥30 |
| VIP Leilões | 34 | ≥80 |
| Bradesco | 100 | ≥150 (full catalog) |
| MGL | 52 (18 batidos rejects) | ≥40 corp-only, 0 batidos rejects |
| Santander | 0 | ≥10 |
| Agent steps per harvest | ~N lots × read HTML | 1 script + read summary |
| SUVs in DB | 23 (12%) | measure after full run; expect ≥15% from corp/bank sources |

---

## Risks and Mitigations

| Risk | Impact | Mitigation |
|------|--------|------------|
| Bradesco/VIP API shape changes | High | Fixture tests + fail-closed skips; probe step for Santander |
| VIP session expiry | Med | Clear error → owner re-runs `vip-leiloes-login.ts` |
| Cloudflare on MGL/BIDchain | Med | Existing stealth stack; `--skip-existing` for resume |
| Santander requires login | Med | Probe first; stop and ask owner if login needed |
| Over-filtering good lots | Med | `--exclude-insurer` optional; log skip counts per reason |
| Duplicate cross-source cars | Low | Existing `write-lead` merge by chassis/plate |

---

## Out of Scope (this plan)

- Scheduled/cron unattended harvests (follow-up after Tier 1 proven)
- Tier 2 model watchlist polling (separate plan)
- Tier 3 goal-filter relaxation (mileage null, budget floor)
- Leilões PB expansion (insurer-heavy; deprioritized given Mapfre T-Cross lesson)
- Auction date capture / expiry (see prior plan in git history — can merge later)

---

## Prior Plans (reference)

- Multi-source ingestion v2: **completed** (`tasks/todo.md` history)
- Auction date + expiry: **planned separately** — not blocked by Tier 1; can run in parallel on different branch
