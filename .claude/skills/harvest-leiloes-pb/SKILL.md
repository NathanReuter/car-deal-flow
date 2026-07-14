---
name: harvest-leiloes-pb
description: Harvests vehicle lots from Leilões PB (leiloespb.com.br / Suporte Leilões) into Car Deal Flow as new_lead records. Use when asked to "harvest Leilões PB", "pull leiloespb", or "ingest PB auctions".
---

# Harvest Leilões PB lots

Public browse + lot detail (no login). Login exists for arrematante/bidding —
do **not** log in and never place bids.

## Probe (2026-07)

| Check | Result |
|---|---|
| Homepage / event pages | HTTP 200 without session |
| Lot detail | Public HTML embeds lot JSON (`valorMinimo`, `valorInicial`, `sucata`, …) |
| Login | Required only to bid, not to read listings |

Platform host: `leiloespb.com.br` / `www.leiloespb.com.br`.

## Entry points

| Path | Notes |
|---|---|
| `https://www.leiloespb.com.br/` | Auction index |
| `https://www.leiloespb.com.br/eventos/leilao/{id}/{slug}` | Event with many `/lote/{id}/…` cards |
| Example: Mapfre | `…/eventos/leilao/2013/leilao-mapfre-seguros` |

Tag `sellerType` from comitente: named insurer/bank → `bank_recovery` when
clear; else `auction`. Many lots are **sucata** — skip scrap lots unless the
operator explicitly wants them (they will fail goal fit / risk).

## Procedure

1. Open an event page; collect lot detail URLs.
2. For each lot (safety ceiling **1000 writes per run**):

```bash
./node_modules/.bin/tsx scripts/ingestion/leiloes-pb-fetch.ts "<lotUrl>" --out /tmp/leiloes-pb-lot.html
```

3. Read the HTML / embedded JSON. Prefer:
   - `valorMinimo` or `valorInicial` for `--price` (fail closed if unclear —
     ignore decorative `R$ 1,00` placeholders)
   - `sucata: true` → skip (or note heavily)
   - `descricao` for brand/model/year
   - plate/chassis only when clearly present
4. Write:

```bash
./node_modules/.bin/tsx scripts/ingestion/write-lead.ts \
  --brand "<brand>" \
  --model "<model>" \
  --year <year> \
  --price <minimumBidBRL> \
  --source-url "<canonicalLotUrl>" \
  --source-platform "Leilões PB" \
  --seller-type <auction|bank_recovery> \
  --body-type <hatch|sedan|suv|pickup|minivan|coupe|wagon> \
  [--mileage <km|null>] \
  [--plate "<plate>"] \
  [--chassis "<chassis>"] \
  [--city "<city>"] \
  [--state "<UF>"] \
  [--notes "<comitente / sucata flag / procedência>"]
```

5. After the run:

```bash
./node_modules/.bin/tsx scripts/ingestion/apply-goal-filter.ts --min-goal-fit 50
```

6. Report: found / written / merged / skipped (with reasons) / parked / rejected.

## Confidence rules

Never invent brand/model/year/price/bodyType. Prefer goal-aware skip when
year/price clearly miss the active buying goal. Cross-source dedup is handled
by `write-lead` via chassis/plate + `CarSource`.

## Notes

- Allowed hosts enforced by `leiloes-pb-fetch.ts`.
- `domcontentloaded` wait is built into the fetch script.
- Do not automate login or bidding.
