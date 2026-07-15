---
name: harvest-bidchain
description: Harvests vehicle lots from BIDchain and Caixa white-label auctions (Adri Leilões / canaldeleiloes) into Car Deal Flow as new_lead records. Use when asked to "harvest BIDchain", "pull Caixa auction lots", or "ingest bidchain".
---

# Harvest BIDchain / Caixa-channel lots

Public browse + lot detail (no login). Login is only required to bid — do not log in.

## One command (preferred)

```bash
./node_modules/.bin/tsx scripts/ingestion/harvest.ts --source bidchain
```

Read `/tmp/bid-harvest/write-summary.json` — report scanned / written / skipped / errors. Do **not** read lot HTML unless debugging a specific skip.

`--dry-run` tallies without DB writes. `--limit N` caps lots. `--no-goal-filter` skips triage.

After the harvest, run the expiry sweep so soft-deleted lots stay out of the
default views:

```bash
npx tsx scripts/ingestion/expire-stale-leads.ts
```

**Known gap:** `bidchain-harvest.ts` does not currently extract or write an
auction date, so `CarSource.auctionDate` stays `null` for every BIDchain lot
and the sweep above will never expire them (null dates fail closed — this is
safe, just inert for this source). If per-lot extraction is added back, wire
it through `write-lead.ts --auction-date` and re-run manual steps below with
a real date to verify. Once wired, re-extract and re-pass the date on every
re-harvest — `write-lead.ts` overwrites the stored value unconditionally, so
skipping it on a routine refresh silently erases a date already known.

## Manual steps (debugging only)

```bash
./node_modules/.bin/tsx scripts/ingestion/bidchain-list.ts --out /tmp/bidchain-lots.json
./node_modules/.bin/tsx scripts/ingestion/bidchain-harvest.ts --lots /tmp/bidchain-lots.json --fetch-dir /tmp/bid-harvest/lots
```

## Rules

- Damage gate: colisão / sinistro / monta / sucata / batido → hard reject (see `check-damage.ts`).
- Fail closed on ambiguous body type. Ceiling **1000 writes/run**.
- `sellerType`: Caixa explicit → `caixa_recovery`; named bank comitente → `bank_recovery`; else `auction`.
