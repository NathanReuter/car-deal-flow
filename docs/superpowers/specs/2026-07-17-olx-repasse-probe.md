# Probe: OLX repasse search + detail (2026-07-17)

Verdict: **GO — existing Playwright+stealth stack works; parsing is JSON-based.**

## Access

- Plain HTTP → Cloudflare 403. Playwright + stealth (same stack as MGL/BIDchain)
  → 200 on search and detail, no challenge, headless.
- Search: `https://www.olx.com.br/autos-e-pecas/carros-vans-e-utilitarios?q=<query>`;
  pagination via `&o=<n>`. 50 `<section class="olx-adcard">` cards per page;
  probe query "repasse financiamento" reported 788 offers (ld+json `offerCount`).
  Ads are fresh (posted "Ontem", "Hoje").

## Search card fields (HTML regex, fixture: `olx-search-snippet.html`)

- title `<h2>`, price `R$ 54.990`, href (regional subdomain
  `https://<uf>.olx.com.br/<region>/autos-e-pecas/carros-vans-e-utilitarios/<slug>-<listId>`),
  posted date `olx-adcard__date`.

## Detail page (fixture: `olx-detail-snippet.html`, PII sanitized)

`<script id="initial-data" data-json="...">` holds HTML-escaped JSON with
`ad.{adId,listId,subject,body,priceValue,origListTime,properties,location,user,phone}`:

- `body` = full description ("Repasse de veiculo / 30 mil de parte + 48x2600 /
  Wtpp 9198566xxxx") — feed to `repasse-economics` + urgency.
- `priceValue` ("R$ 30.000") = **the entrada ask** for repasse ads (a 2024 Onix
  listed at 30k is the transfer ask, not the car's value).
- properties: Marca, Modelo, Ano, Quilometragem, Combustível, Câmbio, Cor.
- `location.municipality` / `location.uf`; `origListTime` ISO date (ad age).
- `phone.maskedPhone` empty; contact only appears inside `body` free text.

## Parse decisions

1. Repasse classification: subject/body must match financing-transfer signals
   ("repasse", "assumo/assumir financiamento", "passo financiamento",
   "quitar e transferir"); otherwise skip `no_financing_signal`.
2. `entryAskBRL` = description-extracted entrada when present, else the listed
   `priceValue` (the ad's own price field — provenance stamped in notes).
3. "X de parte" is common phrasing for entrada → added to `repasse-economics`.
4. LGPD: seller *name* (`ad.user.name`) is never stored; only a contact handle
   from the body via the conservative contact regex. Committed fixtures are
   PII-sanitized.
5. Query set for list runs: "repasse financiamento", "assumo financiamento",
   "passo financiamento". Nationwide (regional narrowing is a goal-filter
   concern, not an ingestion concern).
