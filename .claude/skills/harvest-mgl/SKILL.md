---
name: harvest-mgl
description: Harvests vehicle lots from MGL Leilões (mgl.com.br) into Car Deal Flow as new_lead records. Use when asked to "harvest MGL", "pull mgl.com.br", or "ingest MGL auctions".
---

# Harvest MGL Leilões lots

Browse + lot detail are public. Login is for bidding — do **not** log in.

## One command (preferred)

Corp repasse auctions only (batidos/sucatas excluded at auction level):

```bash
./node_modules/.bin/tsx scripts/ingestion/harvest.ts --source mgl
```

Read `/tmp/mgl-harvest/write-summary.json`. Do **not** read lot HTML unless debugging.

## Manual steps (debugging only)

```bash
./node_modules/.bin/tsx scripts/ingestion/mgl-list-auctions.ts --out /tmp/mgl-auctions.json
./node_modules/.bin/tsx scripts/ingestion/mgl-harvest.ts --auctions /tmp/mgl-auctions.json --fetch-dir /tmp/mgl-harvest/lots
```

## Rules

- Auction filter excludes batidos/sucatas before lot fetch.
- Damage gate + fail-closed body type. Ceiling **1000 writes/run**.
- Price = valor mínimo / abertura only.
