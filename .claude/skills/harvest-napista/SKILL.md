---
name: harvest-napista
description: Harvests NaPista dealer stock into Car Deal Flow as market leads. Use when asked to "harvest napista", "pull NaPista listings", "run the napista harvest", or "harvest market dealers".
---

# Harvest NaPista

Captures dealer-sold vehicles priced below FIPE (market phase), ingested via
plain-fetch of embedded `__NEXT_DATA__` JSON — no Playwright required.

## One command

```bash
npm run harvest:napista
```

Writes summary to `/tmp/napista-harvest/write-summary.json`.
Platform: `NaPista`, `sellerType: market`, `dealPhase: market`.

## Scraping notes

- Strategy: plain HTTP fetch + parse `<script id="__NEXT_DATA__">` JSON; fast
  and low-cost compared to Playwright sources.
- Pagination: `?pn=N` query parameter. The pagination depth should be validated
  on the **first full production run** — confirm maximum page number before
  assuming the current limit is correct.
- City priority: south-first (Florianópolis, Joinville, Blumenau, Curitiba,
  Porto Alegre, São Paulo, Rio de Janeiro, Belo Horizonte) to maximise
  geographic density of actionable leads.
- Year gate: `year >= 2021` (aligned with the 2021+ goal filter).

## Cadence

Daily [Sun–Sat] — high value, low cost.

## Rules

- Damage gate + fail-closed identity fields. Ceiling **1000 writes/run**.
- Spec: `docs/superpowers/specs/2026-07-19-aggressive-ingestion-plan.md`
