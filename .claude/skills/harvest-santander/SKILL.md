---
name: harvest-santander
description: Harvests Santander Retomados vehicle lots into Car Deal Flow as new_lead records. Use when asked to "harvest Santander", "pull retomados", or "ingest Santander repossession cars".
---

# Harvest Santander Retomados

## One command (preferred)

```bash
./node_modules/.bin/tsx scripts/ingestion/harvest.ts --source santander
```

This runs `santander-probe.ts` → `santander-list.ts --html` → the harvest
automatically. Read `/tmp/santander-harvest/write-summary.json`. Platform:
`Santander Retomados`, `sellerType: bank_recovery`.

## Manual fallback (if the probe is blocked)

If `harvest.ts` fails with "Santander probe detected a block", the site is
Cloudflare-walling headless browsers this run. Save the listing HTML from a
normal logged-out browser to `/tmp/santander-retomados.html`, then:

```bash
./node_modules/.bin/tsx scripts/ingestion/santander-list.ts --html /tmp/santander-retomados.html --out /tmp/santander-lots.json
./node_modules/.bin/tsx scripts/ingestion/harvest.ts --source santander
```

(the harvest step will re-probe and re-use the freshly-saved HTML file since
it's already at the expected path — only necessary if the probe itself
remains blocked).

## Rules

- Damage gate + fail-closed fields. Ceiling **1000 writes/run**.
- Spec: `docs/superpowers/specs/2026-07-15-santander-retomados-probe.md`

## Known failure modes (2026-07)

- Run Playwright with `PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright"` set.
- `harvest.ts --source santander` now runs the probe automatically (writing
  both the JSON report and the HTML capture to `/tmp/santander-retomados.html`
  via `--html-out`) before invoking `santander-list.ts` — no manual `--html`
  flag needed for the common case. If the probe reports `blocked: true`
  (Cloudflare/403), the run fails closed with an actionable error; fall back
  to saving the listing HTML manually to that same path from a normal browser
  and rerun.
