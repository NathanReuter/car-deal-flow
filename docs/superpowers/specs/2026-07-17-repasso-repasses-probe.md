# Probe: Repasso.com.br + Repasses.com.br (2026-07-17)

Verdict: **both sources are dead — dropped from the pre-repossession plan.**

## Repasso.com.br

- WordPress + ClassiPress (AppThemes). Ads at `/ads/<slug>/`, listing at
  `/ad-category/veiculos/` (218 pages). `robots.txt` allows crawling; no ad CPT
  in `wp-json` (posts/pages only).
- **Newest content site-wide is 25 Nov 2020** (RSS `pubDate`, listing dates,
  detail pages). Listing page 1 mixes 2008–2019 cars with spam ads
  (pharma, phone-number lists). Prices in broken US format ("R$ 92,000.00").
- Harvesting would ingest ~6-year-old leads with dead contacts. Rejected.

## Repasses.com.br

- Root domain is a landing page for the "Repasse Motors" mobile app
  (iTunes id1189648633 / br.com.apprepasse). `wp-json` exposes no vehicle CPT.
  Latest blog posts: none returned.
- The actual marketplace, `web.repasses.com.br`, serves a React SPA behind an
  **expired SSL certificate** (Locaweb hosting) — abandoned. App-only inventory
  would require reverse-engineering a private mobile API (out of policy).
  Rejected.

## Consequence for the plan

Phase 1 (Repasso + Repasses) is cancelled. OLX (former Phase 2) becomes the
first and primary phase-1 ingestion source; the end-to-end pre-repossession
path is proven on OLX instead. Follow-up spec candidates for additional
pre-repossession volume: Instagram hashtag monitoring, Webmotors partner API,
Facebook Marketplace (all previously out of scope, unchanged).
