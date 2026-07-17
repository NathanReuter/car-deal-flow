# Pre-Repossession (Repasse) Lead Ingestion — Design

**Date:** 2026-07-17
**Status:** Approved by owner (brainstorming session)
**Depends on:** Tier 1 harvest architecture (`tasks/plan.md`, 2026-07-14 auction-lead-ingestion design), `sync-risk-checks` skill.

## Problem

Car Deal Flow currently harvests only **phase 2** of a defaulted financed car's life: after the bank has repossessed it and it appears in an auction catalog (Bradesco, VIP, Santander, BIDchain, MGL, Leilões PB). CONTRAN Resolution 1.018/2025 formalized extrajudicial repossession: after electronic/postal notification the debtor has ~20 days to pay, defend, or surrender the car, and a RENAVAM restriction lands before physical repossession. The best deals exist **before** that window closes — debtors selling the repasse ("assumo financiamento") at deep discounts to escape the debt. We currently see none of them.

## Goal

Add a **phase 1 (pre-repossession)** acquisition stage: harvest repasse ads from public classifieds, verify the financing is real, flag urgency, and surface these leads in the existing pipeline alongside auction lots.

## Scope (slice 1)

In scope:

- Ingestion from **OLX** (search scraping), **Repasso.com.br** (HTML, robots.txt-permitted), **Repasses.com.br** (WordPress REST `wp-json`).
- Data-model extension for deal phase and repasse economics.
- Verification via the existing **sync-risk-checks** browser agent (plate-gated).
- Heuristic urgency flag.
- Minimal UI: badges, filter, economics block.

Out of scope (follow-up specs): Instagram/Apify monitoring; paid plate APIs (BrasilDados, Infosimples); Webmotors partner API; anything behind logins/anti-bot (Motorez, RepassaMais — pursue commercial partnership instead); scheduled/unattended runs; cross-phase "lost to auction" analytics.

## Architecture

Approach chosen: **mirror the auction-harvest pattern** (vs. a standalone scheduled radar service, or agent-driven skills). Each phase-1 source is a vertical slice under `scripts/ingestion/` — list → fetch → parse → `write-lead.ts` → `apply-goal-filter.ts` — reusing the existing trust boundary, dedup, damage gate, fixtures, and the `harvest.ts` orchestrator. Manual one-shot runs only.

## Data model

Extend `Car` (types + Prisma schema + `write-lead.ts` validation):

- `dealPhase: "pre_repossession" | "auction"` — all existing rows backfilled to `"auction"`.
- New `SellerType` value `"repasse"`, label "Repasse (assumir financiamento)".
- Optional `repasse` block:
  - `entryAskBRL: number | null` — entrada asked by the debtor.
  - `outstandingDebtBRL: number | null` — saldo devedor with the bank.
  - `installmentBRL: number | null`, `installmentsRemaining: number | null`.
  - `sellerContact: string | null` — one contact handle (phone/WhatsApp), stored only here.
  - `urgency: "high" | "medium" | "low" | null`.

**Pricing rule:** for repasse leads, `askingPriceBRL = entryAskBRL + outstandingDebtBRL` when both are known (total effective cost — keeps FIPE/market comparison honest). When saldo is undisclosed, write the lead with `askingPriceBRL = entryAskBRL` plus a mandatory note "saldo devedor não informado"; goal-filter must treat these as unpriced/needs-research, never as bargains. All Tier 1 fail-closed rules apply unchanged (never guess brand, model, year, price, body type).

## Ingestion slices

### OLX (`olx-list.ts`, `olx-fetch.ts`, `olx-parse.ts`, `olx-harvest.ts`)

- Search-results harvesting in the Autos category for terms: "repasse", "assumo financiamento", "passo financiamento"; constrained by the active goal's price band and region.
- Playwright + stealth (existing stack). The official OLX API is for posting ads, not searching, so it does not apply.
- Parse extracts title/brand/model/year/km/price/city plus repasse economics from the free-text description via **conservative regexes** (entrada/saldo/parcela patterns). Ambiguous numbers → `null`, never guessed. Plate is expected `null` (rarely published).

### Repasso.com.br (`repasso-harvest.ts`)

- Plain HTTP HTML scrape — `robots.txt` allows crawling. Listing pages → detail pages → parse → write.

### Repasses.com.br (`repasses-harvest.ts`)

- WordPress REST first (`wp-json/wp/v2/...`, probing for a vehicle custom post type); HTML fallback only if the CPT is not exposed.

### Shared behavior

- All writes go through `write-lead.ts` with the new fields, then `apply-goal-filter.ts`.
- Damage gate (colisão/sinistro/monta/sucata/batido → reject) unchanged.
- Safety ceiling: 1000 writes per source per run, unchanged.
- `harvest.ts` orchestrator gains the three sources and a `--phase pre|auction|all` selector.
- Dedup via existing `identity.ts` (brand/model/year/city/price proximity), since plates are usually absent. **Cross-phase dedup is a feature:** the same car later appearing in an auction harvest is merged as an additional source and is a strong "window closed" signal.

## Verification (qualification gate)

Extend `sync-risk-checks` with a phase-1 mode. For pre-repossession leads **with a plate** (from the ad, photos, or obtained from the seller and recorded manually), run the existing `financing_lien` and `judicial_restriction` checks. Outcomes:

| Check result | Meaning | Effect |
|---|---|---|
| Gravame / restrição financeira confirmed | Financing is real → qualified lead | Stage → `researching` |
| No gravame found | Likely not a genuine financed repasse, or a scam | `warning` risk item; stays `new_lead` with note |
| Restrição judicial / RENAJUD present | Repossession clock already running | Urgency → `high` |

Leads without a plate remain `new_lead` / unverified; obtaining the plate from the seller is the human step. No paid APIs in this slice.

## Urgency heuristic

A pure function in `scripts/ingestion/lib/` returning `high | medium | low` from observable signals only:

1. Risk-check restriction results (strongest — restriction found means the clock is running).
2. Ad-text markers: "urgente", "entrega amigável", "banco vai tomar", counts of parcelas atrasadas.
3. Discount depth vs FIPE (when FIPE is synced).
4. Ad age.

Stored on the lead; rendered as a badge. No day-countdown is computed — the notification date is unobservable and a countdown would be false precision.

## UI

Minimal additions, no new pages:

- Phase badge + urgency badge in `cars-table-view.tsx`; phase filter alongside existing filters.
- Repasse economics block (entrada / saldo / parcela / contato) in `car-detail-tabs.tsx`.

## Compliance & operational guardrails

- Public, unauthenticated pages only. Never bypass logins, CAPTCHAs, or anti-bot protection (this excludes Motorez and RepassaMais by construction).
- LGPD data minimization: store only what evaluating the deal needs — ad contents and one seller contact handle. No CPF, no seller profiling; contact stays in the `repasse` block, out of notes/exports.
- Scam defense ("golpe do repasse"): the verification gate is the primary filter; ads reposted across sources with mismatched details receive a `warning` note.
- Manual one-shot runs only; scheduled harvests remain a separate owner-approved follow-up.

## Error handling

- Fetch failures: per-item retry once, then skip and tally (matching existing harvest scripts); orchestrator reports per-source JSON summary.
- Parse ambiguity: field-level `null` (fail closed), lead still written when identity fields (brand/model/year/price) are solid; otherwise skipped and tallied.
- Site structure drift: parsers are fixture-tested so drift surfaces as test failures, not silent garbage.

## Testing

- Fixture-based Vitest per parser: OLX search page + OLX detail, Repasso detail, Repasses `wp-json` payload.
- Unit tests for repasse-economics regex extraction (riskiest parsing) — entrada/saldo/parcela variants, ambiguous cases must yield `null`.
- Urgency function unit tests.
- `write-lead` tests for `dealPhase`, `repasse` block, pricing rule, and backfill.
- `npm test` and `npm run build` green per phase.
