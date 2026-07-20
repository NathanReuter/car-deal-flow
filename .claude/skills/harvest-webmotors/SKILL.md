---
name: harvest-webmotors
description: Harvests Webmotors repasse listings into Car Deal Flow as pre_repossession leads. Use when asked to "harvest webmotors", "pull Webmotors repasse ads", "run the webmotors harvest", or "harvest pre-repossession webmotors".
---

# Harvest Webmotors

Captures private-seller repasse ads (`tipovendedor=PF`) from Webmotors via
the site's internal JSON API, using Playwright with stealth mode to avoid bot
detection.

## One command

```bash
npm run harvest:webmotors
```

Writes summary to `/tmp/webmotors-harvest/write-summary.json`.
Platform: `Webmotors`, `sellerType: repasse`, `dealPhase: pre_repossession`.

## Scraping notes

- Strategy: Playwright + stealth plugin intercepting the internal JSON search
  API (`tipovendedor=PF` filter restricts to private sellers only).
- Repasse-only gate: **fail-closed** — if the PF filter cannot be confirmed
  active, the run aborts rather than ingesting dealer stock as repasse leads.
- Stealth may degrade over time as Webmotors tightens bot detection. Upgrade
  path: switch the stealth plugin to **Camoufox** if detection rates increase.

## Cadence

Mon / Wed / Fri [1, 3, 5] — Playwright load is moderate; three runs per week
balances freshness against resource cost.

## Rules

- Damage gate + fail-closed identity fields. Ceiling **1000 writes/run**.
- Spec: `docs/superpowers/specs/2026-07-19-aggressive-ingestion-plan.md`
