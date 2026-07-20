# Aggressive Ingestion Plan — Catching Repasse/Pre-Repossession Deals Early

## 1. Objective and Framing

The current pipeline is auction-heavy (BIDchain, MGL, Leilões PB, VIP, Bradesco Vitrine) but auctions are, by definition, too late — the car has already been repossessed, gone through legal process, and often lost condition/paperwork clarity. The highest-value leads are **pre-repossession repasse deals**: owners who are behind on payments and want to transfer the financing before the bank acts. These deals surface first on informal channels — WhatsApp/Telegram groups, Facebook Marketplace, dedicated repasse sites, OLX free-text search, and niche forums — days to weeks before any auction house would ever see the car.

This plan treats **discovery volume and speed** as the primary goal for Phase 1, deferring verification depth to Phase 2 (the existing RiskCheck/`sync-risk-checks` skill already covers this well). The instruction is explicit: cast a wide net now, filter and verify later.

## 2. Source Audit — What Was Rejected and Why

Two originally-proposed dedicated repasse marketplaces were checked directly and disqualified. **Do not build harvesters for these:**

| Source | Verdict | Evidence |
|---|---|---|
| Repasso (repasso.com.br) | Dead/stale | Featured and "latest" listings dated 25/11/2020 and 10/09/2020 — over 5 years old. Site has effectively stopped receiving new inventory. |
| Repasse Brasil (repassebrasil.com) | Not scrapable, wrong model | Not a listings site — a paid subscription funnel ("clube de assinatura"). All actual car listings are gated inside a private WhatsApp group accessible only after payment. Public page is pure marketing copy with MLM-style testimonials. No public catalog exists to harvest. |
| Repasses.com.br | Unverifiable, likely B2B-gated | Homepage is a company shell page with zero visible listings; matches a dedicated Android app aimed at lojistas (dealers), not individual buyers. Downgraded — investigate registration access before investing engineering time. |

**Lesson applied:** every source below has been checked for actual live 2026 listing dates before being included, not assumed from name/branding alone.

## 3. Verified Sources — Full Ranked List

### Tier 1: Confirmed Active — Build Now

| Source | Type | Verified freshness / scale | Access notes |
|---|---|---|---|
| NaPista (napista.com.br) | Bank-backed aggregator (Banco BV) | 230,000+ active listings, indexed July 2026. Only credentialed dealer partners can post — built-in quality filter. | Public web search, no login needed to browse. Has explicit "Tudo abaixo da Fipe" filter plus city/price/year filters — does significant pre-filtering automatically. **Top priority** — highest scale + structured data quality of any source found. |
| OLX (repasse-focused queries) | General classifieds | Confirmed live — 788 results for "repasse financiamento" query alone; ads timestamped "Ontem"/"Hoje" | Already partially built in existing pipeline (`olx-list.ts`/`olx-parse.ts`). Needs breadth, not new infra (see Section 5). |
| Webmotors | Largest Brazilian classifieds site | Confirmed scrapable at scale — a commercial vendor (Bright Data) already runs a production Webmotors scraper | Currently absent from the pipeline — real gap. Supports keyword search including "financiado" queries. |
| Clube Repasse (cluberepasse.com.br) | Single-dealer repasse catalog | Listings dated up to 09/06/2026, continuous postings through Apr–Jun 2026 | Small inventory (~18 cars visible) but genuinely live; simple static HTML — trivial to scrape. Each listing tags % discount below FIPE explicitly. |

### Tier 2: Conditional / Gated — Investigate Access First

| Source | Type | Status | Notes |
|---|---|---|---|
| Repasse Já App (repasseja.com.br) | Dealer-to-dealer repasse trading app | Launched Nov 2025, still active per Nov 2025 promo | Gated to registered "lojistas" (dealers) — same limitation as Repasses.com.br. Only pursue if dealer registration is feasible; otherwise skip. |
| Repasses.com.br | B2B repasse trading platform | Unclear public access | See Section 2. Check if the Android app (`br.com.apprepasse`) exposes any public endpoint or open registration before deprioritizing further. |

### Tier 3: Regional Single-Dealer Repasse Storefronts — Low Priority, Long Tail

- **CG Veículos Repasse** (cgveiculos.com) — Trindade/Goiânia-GO, explicit "sem sinistro, sem leilão" claims
- **Compra Certa Repasse** (compracertarepasse.com.br) — Goiânia-GO, claims daily inventory updates, 5,000+ historical units sold
- Unverified peers worth a freshness check before investing time: WC Repasse, Nacional Repasses, RepassAqui Veículos

### Tier 4: High-Friction Channels — Require Different Architecture

| Source | Why it matters | Why it's hard | Recommended approach |
|---|---|---|---|
| WhatsApp / Telegram repasse groups | Earliest possible signal | No scraping API exists for group messages | Join 10–15 active groups, build a message-listener service, run LLM extraction reusing `write-lead.ts` logic |
| Facebook Marketplace | High volume, large city coverage | No official API; scraping fragile/TOS-risky | Trial a paid scraper API (e.g. RapidAPI) before building custom |
| Niche forums (e.g. 4x4Brasil) | Near-zero anti-bot friction | Low volume, enthusiast bias | Light harvester, long-tail only |

## 4. Final Priority Stack (Effort vs. Signal)

| Priority | Source | Effort | Expected signal |
|---|---|---|---|
| 1 | NaPista | Medium | Very high — 230k+ listings, dealer-verified, explicit below-FIPE filter |
| 2 | OLX query/region expansion | Very low | High — proven pipeline |
| 3 | Webmotors | Medium | High — largest volume classifieds site, currently missing |
| 4 | Clube Repasse + regional storefronts | Low each | Medium — small but pre-filtered, zero noise |
| 5 | WhatsApp group listener | Medium-high | Very high — earliest signal |
| 6 | Facebook Marketplace (paid API trial) | Low to start | Medium-high, uncertain reliability |
| 7 | Repasse Já / Repasses.com.br | Medium, conditional | Unclear — gated to registered dealers |

## 5. Concrete Build Instructions Per Source

### NaPista (new — build first)
- Public search: `napista.com.br/busca/carro/{city}/{year}/valor-abaixo-da-fipe`
- No login required to browse
- Implement pagination handling and rate-limit respectfully
- Treat as higher-confidence tier in scoring (bank-backed dealer network)

### OLX (expand existing)
- Add rotating query terms: "assumo financiamento", "passo financiamento", "transferir financiamento", "veículo já financiado", "quitar e transferir", "aceito repasse"
- Add per-region subdomains (`sp.olx.com.br`, `rj.olx.com.br`, etc.)
- Increase pagination depth (`&o=<n>`) beyond page 1

### Webmotors (new harvester)
- Mirror existing OLX harvester pattern (`webmotors-list.ts` / `webmotors-parse.ts` / `webmotors-harvest.ts`)
- Search by keyword ("financiado", "repasse") plus price-below-FIPE-threshold filter
- Reuse existing Playwright + stealth stack

### Clube Repasse + regional storefronts
- Simple static HTML — no anti-bot measures observed
- Batch several regional storefronts into one lightweight harvester config

### WhatsApp/Telegram group listener (new architecture)
1. Manually join 10–15 active repasse-branded groups
2. Stand up a message-logging bridge (`whatsapp-web.js` or Telegram Bot API client)
3. Pipe messages through LLM extraction (brand/model/year/price/city/contact)
4. Tag leads: `dealPhase: pre_repossession`, `sourcePlatform: "WhatsApp Group — <name>"`, `sellerContact` capped per LGPD-minimization field

### Facebook Marketplace (defer to paid API trial)
- Trial RapidAPI's Facebook Scraper API free tier first
- Escalate to custom Playwright scraping only if insufficient

## 6. Data Model Adjustments Needed

1. **`sourceChannel` field** — distinguish "classifieds site" vs "messaging group" vs "forum" vs "aggregator"
2. **`confidence: "low" | "medium" | "high"` field** — allow noisy aggressively-ingested leads to enter as `new_lead` flagged for scrutiny rather than being silently skipped, while keeping strictness everywhere else (price, chassis, never inventing fields)

## 7. Phase 2 (Deferred, Not Now)

Apply the existing RiskCheck 13-point checklist and `sync-risk-checks` skill to triage once volume is flowing. One flagged addition for later: extend `sync-risk-checks` to cover theft/roubo history via a paid Infosimples endpoint, since Sinesp Cidadão has no web-scrapable equivalent.

## 8. Immediate Next Actions (Handoff Checklist)

1. Build a NaPista harvester using the `busca/carro/{city}/{year}/valor-abaixo-da-fipe` URL pattern
2. Expand OLX query set and regional subdomains
3. Build a Webmotors harvester reusing existing Playwright+stealth stack
4. Build a lightweight harvester covering Clube Repasse + CG Veículos + Compra Certa Repasse
5. Join 10 repasse-branded WhatsApp groups manually, start a message-logging bridge spike
6. Trial RapidAPI's Facebook Scraper free tier before committing to custom scraper
7. Add `sourceChannel` and `confidence` fields to the lead schema before ingestion volume ramps up
