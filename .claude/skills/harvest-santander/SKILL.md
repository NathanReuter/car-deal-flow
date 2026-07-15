---
name: harvest-santander
description: Harvests Santander Retomados vehicle lots into Car Deal Flow as new_lead records. Use when asked to "harvest Santander", "pull retomados", or "ingest Santander repossession cars".
---

# Harvest Santander Retomados

## Probe first (if list empty)

```bash
./node_modules/.bin/tsx scripts/ingestion/santander-probe.ts --out /tmp/santander-probe/report.json
```

If headless is blocked, owner saves listing HTML from a normal browser, then:

```bash
./node_modules/.bin/tsx scripts/ingestion/santander-list.ts --html /tmp/santander-retomados.html --out /tmp/santander-lots.json
```

## One command (after `/tmp/santander-lots.json` exists)

```bash
./node_modules/.bin/tsx scripts/ingestion/harvest.ts --source santander
```

Read `/tmp/santander-harvest/write-summary.json`. Platform: `Santander Retomados`, `sellerType: bank_recovery`.

## Rules

- Damage gate + fail-closed fields. Ceiling **1000 writes/run**.
- Spec: `docs/superpowers/specs/2026-07-15-santander-retomados-probe.md`
