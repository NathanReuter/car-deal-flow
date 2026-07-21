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
- PF protection (three layers): (1) `tipovendedor=PF` query param on every API
  call; (2) per-result `Seller.SellerType` check — any result whose SellerType
  is present and !== "PF" is skipped with reason `not_pf` rather than ingested;
  (3) `hasFinancingSignal` text gate rejects plain-sale ads without a
  financing-transfer phrase. Dealer stock cannot pass all three layers.
- Stealth may degrade over time as Webmotors tightens bot detection. Upgrade
  path: switch the stealth plugin to **Camoufox** if detection rates increase.
- Fail-closed anti-bot handling (issue #8): the internal JSON API is
  classified per page. A PerimeterX block — non-OK HTTP (403/429), an HTTP-200
  anti-bot HTML wall (*"Access to this page has been denied"* / `px-captcha`),
  or a non-JSON body — is recorded as `skipped.blocked` + an `errors[]` entry
  and **aborts the run** (non-zero exit via the orchestrator), rather than
  being mistaken for end-of-results. A completed default run that scanned zero
  raw results also aborts as a probable warm-up block; a suspiciously low yield
  is flagged `skipped.low_yield`. A genuinely empty page still ends pagination
  normally. (Resolves PR #7 review finding #2.)

## Cadence

Mon / Wed / Fri [1, 3, 5] — Playwright load is moderate; three runs per week
balances freshness against resource cost.

## Rules

- Damage gate + fail-closed identity fields. Ceiling **1000 writes/run**.
- Spec: `docs/superpowers/specs/2026-07-19-aggressive-ingestion-plan.md`
