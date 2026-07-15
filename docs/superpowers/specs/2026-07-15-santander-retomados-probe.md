# Santander Retomados — probe notes (2026-07-15)

## Target

- URL: `https://www.santander.com.br/retomados`
- Platform string: `Santander Retomados`
- Default `sellerType`: `bank_recovery`

## Probe script

```bash
./node_modules/.bin/tsx scripts/ingestion/santander-probe.ts --out /tmp/santander-probe/report.json
```

Writes JSON with `finalUrl`, HTTP status, Cloudflare/block flags, and any lot URLs found in first-page HTML.

## Findings (initial)

| Check | Result |
|---|---|
| Plain `curl` | **403** (bot/WAF) |
| Playwright + stealth (`santander-probe.ts`) | Run locally to confirm; may still block headless |
| Listing shape | Likely SPA — list step accepts `--html` capture from human browser when probe finds no URLs |
| Host allowlist | `santander.com.br`, `www.santander.com.br`, `retomados.santander.com.br` |

## Harvest pipeline

When listing HTML is available (probe or manual save):

```bash
./node_modules/.bin/tsx scripts/ingestion/santander-list.ts --html /tmp/santander-retomados.html --out /tmp/santander-lots.json
./node_modules/.bin/tsx scripts/ingestion/santander-harvest.ts --lots /tmp/santander-lots.json --fetch-dir /tmp/santander-harvest/lots
```

Or via orchestrator (requires `/tmp/santander-lots.json` already built):

```bash
./node_modules/.bin/tsx scripts/ingestion/harvest.ts --source santander
```

## Owner review checklist

- [ ] Confirm browse works without login in normal browser
- [ ] Save listing HTML if headless probe is blocked
- [ ] Spot-check first 5 writes for brand/year/price accuracy
- [ ] Compare quality vs insurer-lot sources (VIP Mapfre lesson)
