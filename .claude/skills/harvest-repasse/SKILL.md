---
name: harvest-repasse
description: Harvests pre-repossession repasse ads (OLX "assumo financiamento") into Car Deal Flow as pre_repossession leads. Use when asked to "harvest repasse", "pull OLX repasse ads", "run the pre-repossession harvest", or "harvest phase 1".
---

# Harvest Repasse (Pré-Apreensão)

Captures cars still owned by defaulting debtors during the CONTRAN 1.018/2025
window, before the bank repossesses them into auction.

## One command

```bash
npm run harvest:pre
```

(Equivalent: `npm run harvest -- --source olx`.) Writes summary to
`/tmp/olx-harvest/write-summary.json`. Platform: `OLX`,
`sellerType: repasse`, `dealPhase: pre_repossession`.

Pricing: `askingPriceBRL` = entrada + saldo devedor (derived, never supplied);
saldo unknown → flagged "saldo devedor não informado". Goal triage + cleanup
run automatically.

## Qualification (after harvest)

Leads with a plate go through `sync-risk-checks` (financing_lien +
judicial_restriction). Gravame confirmed → `researching`; no gravame →
scam warning; RENAJUD hit → urgency `high`. Plateless leads stay `new_lead`
until the plate is obtained from the seller (human step).

## Rules

- Structured-props gate: `Quitado: Sim` / `Financiado: Não` ads are skipped
  (`not_financed`) — kills dealer "preço de repasse" false positives.
- Damage gate, fail-closed identity fields, ceiling **1000 writes/run**.
- LGPD: one contact handle max, stored only in `sellerContact`; never bypass
  logins/CAPTCHA; never contact sellers automatically.
- Specs: `docs/superpowers/specs/2026-07-17-pre-repossession-repasse-ingestion-design.md`,
  `docs/superpowers/specs/2026-07-17-olx-repasse-probe.md`

## Known failure modes (2026-07)

- Run Playwright with `PLAYWRIGHT_BROWSERS_PATH="$HOME/Library/Caches/ms-playwright"` set.
- OLX sits behind Cloudflare and intermittently drops mid-navigation
  (`net::ERR_NETWORK_CHANGED` and similar). `olx-list.ts` retries each page
  navigation up to 3 times with backoff for these transient network errors
  only — genuine blocks/parse failures still fail closed immediately.
