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
   - Skip or note heavily when status is `Finalizado` / `Vendido` if the operator
     only wants open lots
   - Brand/model/year from `MARCA/MODELO` + `ANO` / `ANO/MODELO`
   - Mileage when labeled `KM:`
   - Plate/chassis only when clearly present (many lots say “No chassi”)
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
  [--notes "<comitente / código / status>"]
```

Tag `sellerType`: Caixa comitente → `caixa_recovery`; named bank →
`bank_recovery`; judicial / MGL Direto / generic auction → `auction`.

5. After the run:

```bash
./node_modules/.bin/tsx scripts/ingestion/apply-goal-filter.ts --min-goal-fit 50
```

6. Report: found / written / merged / skipped (with reasons) / parked / rejected.

## Confidence rules

Never invent brand/model/year/price/bodyType. Prefer goal-aware skip when
year/price clearly miss the active buying goal. Cross-source dedup is handled
by `write-lead` via chassis/plate + `CarSource`.
