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

After the harvest, run the expiry sweep so soft-deleted lots stay out of the
default views:

```bash
npx tsx scripts/ingestion/expire-stale-leads.ts
```

**Known gap:** `mgl-harvest.ts` does not currently extract or write an
auction date (e.g. `Encerramento`), so `CarSource.auctionDate` stays `null`
for every MGL lot and the sweep above will never expire them (null dates
fail closed — this is safe, just inert for this source). If per-lot
extraction is added back, wire it through `write-lead.ts --auction-date`.
Once wired, re-extract and re-pass the date on every re-harvest —
`write-lead.ts` overwrites the stored value unconditionally, so skipping it
on a routine refresh silently erases a date already known.

## Manual steps (debugging only)

```bash
./node_modules/.bin/tsx scripts/ingestion/mgl-list-auctions.ts --out /tmp/mgl-auctions.json
./node_modules/.bin/tsx scripts/ingestion/mgl-harvest.ts --auctions /tmp/mgl-auctions.json --fetch-dir /tmp/mgl-harvest/lots
```

## Rules

- Auction filter excludes batidos/sucatas before lot fetch.
- Damage gate + fail-closed body type. Ceiling **1000 writes/run**.
- Price = valor mínimo / abertura only.

## Known failure modes (2026-07)

- Run Playwright with `PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright"` set (Cursor agent shells otherwise can't find the installed browser).
- `mgl.com.br/leiloes` 404s (site drift) — `mgl-list-auctions.ts` now defaults to the homepage (`DEFAULT_MGL_INDEX_URL`), which still surfaces `/leilao/...` links in its rotating feed.
- The homepage feed rotates and doesn't always include corp-repasse auctions, so a run can legitimately return `auctions: []` / 0 writes with exit 0 — that's empty inventory, not a crash. If writes are consistently 0 across multiple runs, re-probe the site for a dedicated listing endpoint (`/Comitente/repasse/` renders via `apiplugin/GetBusca` client-side and wasn't wired up).
