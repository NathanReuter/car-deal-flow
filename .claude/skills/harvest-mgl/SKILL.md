---
name: harvest-mgl
description: Harvests vehicle lots from MGL Leilões (mgl.com.br) into Car Deal Flow as new_lead records. Use when asked to "harvest MGL", "pull mgl.com.br", or "ingest MGL auctions".
---

# Harvest MGL Leilões lots

Browse + lot detail are public in a normal browser. Login is for bidding /
proposals — do **not** log in and never place bids.

## Probe (2026-07-14)

| Check | Result |
|---|---|
| Plain `curl` / bare Playwright Chromium | Cloudflare **403** |
| `mgl-fetch.ts` (Playwright + stealth, same stack as BIDchain) | Lot + listing HTML OK |
| Lot URL shape | `https://www.mgl.com.br/lote/{auction-slug}/{id}/` |
| Listing entry | e.g. `https://www.mgl.com.br/leilao/repasse-de-veiculos-corporativos/7186/` |
| Search UI | Hash-routed `/busca/#Engine=Start&…&ID_Categoria=…` (SPA; prefer leilão or known lot URLs) |

If fetch throws a Cloudflare block error, retry later or save HTML from a
normal browser — do not invent fields.

## Procedure

1. Open a vehicle leilão or known lot URL.
2. For each lot (safety ceiling **1000 writes per run**):

```bash
./node_modules/.bin/tsx scripts/ingestion/mgl-fetch.ts "<lotUrl>" --out /tmp/mgl-lot.html
```

3. Extract only confident fields. Prefer:
   - **Price:** label `valor mínimo` / abertura amount (fail closed if unclear —
     ignore despesas, percent discounts, and unrelated R$ lines)
   - Skip when status is `Finalizado` / `Vendido` if the operator only wants open lots
   - **Damage:** copy `Sinistro` / `Monta` / sucata into `--notes`; run
     `check-damage` — skip colisão / monta / sucata / batido lots
   - Brand/model/year from `MARCA/MODELO` + `ANO` / `ANO/MODELO`
   - Mileage when labeled `KM:`
   - Plate/chassis only when clearly present (many lots say “No chassi”)
   - Auction date/time, typically labeled `Encerramento` or shown on the
     leilão listing page; leave it off if unclear or only a countdown —
     never guess an absolute date from a countdown
4. Write:

```bash
./node_modules/.bin/tsx scripts/ingestion/write-lead.ts \
  --brand "<brand>" \
  --model "<model>" \
  --year <year> \
  --price <minimumBidBRL> \
  --source-url "<canonicalLotUrl>" \
  --source-platform "MGL" \
  --seller-type <auction|bank_recovery|caixa_recovery> \
  --body-type <hatch|sedan|suv|pickup|minivan|coupe|wagon> \
  [--mileage <km|null>] \
  [--plate "<plate>"] \
  [--chassis "<chassis>"] \
  [--city "<city>"] \
  [--state "<UF>"] \
  [--auction-date "<ISO-8601 date/time>"] \
  [--notes "<comitente / código / status>"]
```

Tag `sellerType`: Caixa comitente → `caixa_recovery`; named bank →
`bank_recovery`; judicial / MGL Direto / generic auction → `auction`.

5. After the run:

```bash
./node_modules/.bin/tsx scripts/ingestion/apply-goal-filter.ts --min-goal-fit 50
./node_modules/.bin/tsx scripts/ingestion/expire-stale-leads.ts
```

`expire-stale-leads.ts` soft-deletes `new_lead`/`parked` cars whose known
auction date(s) have all passed (moved to `expired`, hidden from default
views but still queryable). Any unknown auction date blocks expiry.

6. Report: found / written / merged / skipped (with reasons) / parked /
   rejected / expired.

## Goal-aware harvest

```bash
./node_modules/.bin/tsx scripts/ingestion/goal-hint.ts
./node_modules/.bin/tsx scripts/ingestion/check-damage.ts "<notes excerpt>"
```

**Damage gate:** skip colisão / sinistro / monta / sucata / batido. Copy sinistro
lines into `--notes`. Only integral/conservado/sem sinistro.

When year/price/brand clearly miss the active goal, skip the write and log why.
Never invent fields. Ceiling **1000 writes/source/run**. `--out` must stay under
`/tmp` or `<cwd>/tmp`.
