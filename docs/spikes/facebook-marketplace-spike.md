# Spike: Facebook Marketplace via RapidAPI

**Task:** 6.2 (aggressive ingestion Phase 6)  
**Date:** 2026-07-21  
**API trialed:** [facebook-scraper-api9](https://rapidapi.com/pullapi-pullapi-default/api/facebook-scraper-api9) (PullAPI) — `GET /facebook/marketplace`  
**Status:** Spike complete (paid plan). **Conditional go** — full south-first grid in `docs/spikes/fb-marketplace-query-grid.json` (2026-07-21 evening).

---

## Verdict

| Decision | Detail |
|---|---|
| **Go / no-go** | **Conditional go** — BR inventory + financing/repasse signal are reachable with a strict query contract. |
| **Build harvester now?** | **Not yet** — need remap helpers + vehicle/non-vehicle filter fixtures on ≥50 remapped rows, then cost OK from product. |
| **Recommended posture** | Intent queries (`financiado` / `financiamento` / `assumo financiamento` / `passo financiamento` / `repasse`) × `{Florianopolis, Curitiba, Joinville}` → remap → **reject non-cars** → financing gate → `write-lead` `pre_repossession` / `classifieds` / `confidence: "low"`. Wide-net `Veiculos`/`carros` as recall backup. |

Native FB proves inventory exists. This API is **not** a drop-in for `category_id=546583916084032`.

---

## Auth / quota

- `RAPIDAPI_KEY` authenticates (HTTP 200).
- BASIC monthly quota was exhausted mid-day; **paid upgrade restored access** and completed the full grid (~40 calls, all 200).
- `country=br` works only when location/query stay ASCII **and** the city format is accepted (see location table).

---

## Working query contract (proven)

### Hard rules

1. **ASCII only** for `query` and `location` — accents / `, SC` suffixes cause US$ drift.
2. Always pass **`country=br`**.
3. **Location allowlist (BR hits):** `Florianopolis`, `Curitiba`, `Joinville` only (plain city name).
4. **Location denylist (US$ junk despite `country=br`):** `Florianopolis, SC`, `Sao Jose`, `Sao Jose, SC`, `Porto Alegre`, `Sao Paulo`.
5. **Do not trust `price`** — null; remap from `title` (or from `location` when title is a badge).
6. Drop remapped rows with `US$` / leading `$`.
7. **Stage-2 must reject non-vehicles** — intent queries also return apartments, houses, “carta contemplada”, clothing (`Polo`).

### Location grid (`query=Veiculos`, limit=10)

| location | br | us | notes |
|---|---:|---:|---|
| `Curitiba` | 9 | 0 | best BR density |
| `Florianopolis` | 9 | 0 | +4 repasse-ish already on Veiculos |
| `Joinville` | 8 | 0 | good |
| `Florianopolis, SC` | 0 | 9 | **broken** — US drift |
| `Sao Jose` / `Sao Jose, SC` | 0 | 9 | broken |
| `Porto Alegre` | 0 | 9 | broken |
| `Sao Paulo` | 0 | 9 | broken |

### Query grid @ `Curitiba` (ranked by repasse-hint → br)

| rank | query | br | us | repasse-hint | note |
|---|---|---:|---:|---:|---|
| 1 | `financiado` | 6 | 0 | 10 | high recall; **includes apartments** |
| 2 | `financiamento` | 7 | 0 | 7 | strong (“PRA ASSUMIR FINANCIAMENTO”) |
| 3 | `assumo financiamento` | 8 | 0 | 6 | good |
| 4 | `passo financiamento` | 10 | 0 | 4 | good |
| 5 | `repasse` | 6 | 0 | 2 | explicit but thinner |
| — | `Veiculos` / `carros` / `automovel` / brands | 7–10 | ~0 | 0–1 | wide-net / filter-later |
| — | `transferir financiamento`, `quitar` | high br | 0 | 0 | weak intent signal in text |
| — | `venda`, `auto` | high br | 0 | 0 | **houses / carta contemplada** — avoid as primary |

Cross-check: top intent queries also score well on `Florianopolis` and `Joinville` (br 8–10, repasse-hint 2–9).

### Remap reminder

- `title` → price (`R$21.900`) or badge (`Acabou de ser anunciado`)
- `location` → description / year-make-model (sometimes city)
- `listing_url`, `listing_id`, `image_url`, `seller_name` → usable when present

---

## Recommended harvest strategy (intent-first, wide-net backup)

```
Stage 1 — Intent discover (preferred)
  queries = financiado | financiamento | assumo financiamento | passo financiamento | repasse
  locations = Florianopolis | Curitiba | Joinville
  country=br, limit=20..50

Stage 1b — Wide-net backup (recall)
  queries = Veiculos | carros
  same locations

Stage 2 — Remap + vehicle gate (mandatory)
  priceBRL ← parseBrl(title) or parseBrl(location) if title is badge
  textBlob ← join(title, location, seller_name)
  reject US$ / non-BRL
  reject non-cars (apartamento, casa, moto, carta contemplada, clothing, …)
  brand/model/year ← normalizeBrandModel + parseYearFromText  # fail-closed
  bodyType ← inferBodyType; skip if ambiguous

Stage 3 — Financing / repasse gate
  keep if text matches: repasse|financi|assumo|passo financiamento|transferir|quitar
  (Stage 1 already biases here; still required for wide-net path)

Stage 4 — write-lead
  dealPhase: pre_repossession
  sellerType: owner
  sourceChannel: classifieds
  confidence: low
  sourcePlatform: "Facebook Marketplace"
  sourceUrl: listing_url
  photos: [image_url] if present
  sellerContact: null unless a real handle (LGPD)
  economics: fail-closed via repasse-economics.ts
```

**Last-resource note:** prefer Stage 1b volume over fragile query tuning; precision lives in Stages 2–3.

---

## Field coverage vs `WriteLeadInput`

| WriteLead field | FB API field | Coverage |
|---|---|---|
| `sourceUrl` | `listing_url` | Good |
| `photos` | `image_url` (single) | Partial (1 image) |
| `askingPriceBRL` / money | remapped from `title` | Fragile; needs `parseBrl` |
| `brand` / `model` / `year` | buried in remapped `location` text | Fragile; fail-closed parse |
| `bodyType` | infer from model text | Same as OLX |
| `city` / `state` | sometimes in blob (`Blumenau, SC`) | Partial |
| `sellerContact` | `seller_name` | Weak (display name, not phone/WA) |
| `mileageKm`, fuel, transmission, plate, chassis | — | **Missing** |
| Repasse economics (`entryAskBRL`, debt, installments) | free text only | Fail-closed via `repasse-economics.ts` |
| `category_id` / radius / “just listed” | — | **Not exposed** |

Net: enough for a **low-confidence** lead skeleton when text parse succeeds; not enough for high-confidence triage without a detail fetch (API has no reliable detail endpoint in the free Surface we used).

---

## Cost / rate / freshness

- **Freshness:** live scrape (`cache_hit: false` on successful calls); titles/badges like “Acabou de ser anunciado” appear in remapped fields.
- **Cost:** BASIC free tier too small for iterative probing + daily cadence. Expect paid plan before wiring into `cadence-schedule.ts`.
- **Latency:** ~8–30s per call in our probes.
- **Cadence gate (AD-7):** do not schedule until ≥3 clean supervised runs after remap/filter land.

---

## Risks

| Risk | Mitigation |
|---|---|
| Accent → US geo drift | ASCII normalize; reject `US$` |
| Swapped title/location | Central remap helper + fixture tests from captured JSON |
| No category filter | Wide `Veiculos` + Stage 3 keyword gate |
| Monthly quota / 429 | Paid plan; cache list responses; low cadence (e.g. 2–3×/week) |
| TOS / ToS of FB + scraper vendor | Spike-only until legal/product OK; prefer public classifieds we already own (OLX/Webmotors) for volume |
| LGPD | Never copy seller into `notes`; one handle max in `sellerContact` |
| False “repasse” (buyers “compro veículos”) | Gate + damage/non-car filters; human spot-check |

---

## Native GraphQL note (browser)

User URL:  
`https://www.facebook.com/marketplace/florianopolis/search/?category_id=546583916084032&query=Veículos…`

A selected `graphql/` response showed `feed_units.edges: []` with `has_next_page: true` while the UI showed cars. That call is almost certainly **pagination / secondary**, not the primary listing payload. When inspecting DevTools, filter for a response whose `edges` contain listing nodes (title/price), not an empty page with only `end_cursor`.

Direct Playwright against FB GraphQL is **out of scope** for this spike (anti-bot, login, ToS). RapidAPI remains the trial path.

---

## Open items (human)

- [x] Upgrade RapidAPI plan / restore quota
- [x] Re-run location/query grid (south-first) — `docs/spikes/fb-marketplace-query-grid.json`
- [ ] Decide: keep paid credits vs relying on OLX + Webmotors for pre-repossession
- [ ] If go: implement remap + **vehicle gate** fixtures before any `write-lead` wiring

---

## Sample remapped hits (from live probes)

Successful `repasse` @ `Florianopolis` (pre-quota):

1. price≈`R$21.900` — `2013 REPASSE FORD FIESTA 1.0 BÁSICO financia sem entrada 48x 799,00`
2. price≈`R$49.900` — `2014 REPASSE CITRÖEN DS5 1.6 AUT 21 mil abaixo da fipe financia 100%`

Successful `Veiculos` @ `Florianopolis`:

1. price≈`R$28.990` — `2004 Honda civic ex 1.7`
2. price≈`R$1.000` — `2012 FIAT uno … negativados negociamos e financiamos` (noise / risk — filter later)
