---
name: harvest-bidchain
description: Harvests vehicle lots from BIDchain and Caixa white-label auctions (Adri Leilões / canaldeleiloes) into Car Deal Flow as new_lead records. Use when asked to "harvest BIDchain", "pull Caixa auction lots", or "ingest bidchain".
---

# Harvest BIDchain / Caixa-channel lots

Public browse + lot detail (no login). Login is only required to bid — do not
log in and never place bids.

## Entry points

| Path | Notes |
|---|---|
| `https://bidchain.com.br/leiloes` | Auction index (Caixa, judicial, etc.) |
| `https://bidchain.com.br/por-categoria/4` | Vehicles (SPA filter; content may stay on `/`) |
| Caixa event cards → often `adrileiloes.com.br` or `canaldeleiloes.net` | White-label Plataforma Leiloar hosts |

Tag `sellerType` from comitente text: `caixa_recovery` only if Caixa is
explicit; named bank → `bank_recovery`; else `auction`. Do **not** assume
every vehicle on BIDchain is Caixa (many are judicial/TJMS).

## Procedure

1. List lots (category or specific Caixa leilão). Prefer lot detail URLs like
   `https://bidchain.com.br/lote/{id}/{slug}` or the white-label equivalent.
2. For each lot (safety ceiling **1000 writes per run**):

```bash
npx tsx scripts/ingestion/bidchain-fetch.ts "<lotUrl>" --out /tmp/bid-lot.html
```

3. Read the HTML. Extract only confident fields. Fail closed on ambiguous
   `bodyType`. Prefer lance mínimo / oferta inicial for `--price`.
4. Write:

```bash
npx tsx scripts/ingestion/write-lead.ts \
  --brand "<brand>" \
  --model "<model>" \
  --year <year> \
  --price <minimumBidBRL> \
  --source-url "<canonicalLotUrl>" \
  --source-platform "BIDchain" \
  --seller-type <auction|bank_recovery|caixa_recovery> \
  --body-type <hatch|sedan|suv|pickup|minivan|coupe|wagon> \
  [--mileage <km|null>] \
  [--plate "<plate>"] \
  [--chassis "<chassis>"] \
  [--city "<city>"] \
  [--state "<UF>"] \
  [--notes "<comitente / procedência>"]
```

5. After the run:

```bash
npx tsx scripts/ingestion/apply-goal-filter.ts --min-goal-fit 50
```

6. Report: found / written / merged / skipped (with reasons) / parked / rejected.

## Goal-aware harvest

```bash
./node_modules/.bin/tsx scripts/ingestion/goal-hint.ts
```

When year/price/brand clearly miss the active goal, skip the write and log why.
Never invent fields. Ceiling **1000 writes/source/run**. `--out` must stay under
`/tmp` or `<cwd>/tmp` (enforced by the fetch script).

## Notes

- Use `domcontentloaded` fetch (built into `bidchain-fetch.ts`). Stealth is kept
  for CF insurance (same stack as VIP/MGL); browse still requires no login.
- Allowed hosts are enforced by the fetch script (final URL re-checked after
  redirects); add new white-labels only after a public-access probe.
- Cross-source dedup is handled by `write-lead` via chassis/plate + `CarSource`.
- Fail closed: never invent brand/model/year/price/bodyType.
