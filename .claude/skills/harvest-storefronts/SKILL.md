---
name: harvest-storefronts
description: Harvests repasse storefront listings (Clube Repasse, Compra Certa) into Car Deal Flow as market leads. Use when asked to "harvest storefronts", "pull storefront listings", "run the storefronts harvest", or "harvest clube repasse".
---

# Harvest Storefronts

Captures repasse-storefront vehicle listings from a config-driven set of
sources. Currently active: **Clube Repasse** (HTML scrape) and **Compra Certa**
(JSON API). CG Veículos was evaluated and dropped.

## One command

```bash
npm run harvest:storefronts
```

Writes summary to `/tmp/storefronts-harvest/write-summary.json`.
Platform varies per storefront (e.g. `Clube Repasse`, `Compra Certa`),
`sellerType: repasse`, `dealPhase: market`.

## Scraping notes

- Strategy: config-driven — each storefront entry declares its URL pattern and
  parser type (HTML or JSON). Adding a new storefront requires only a config
  entry, not a new harvester file.
- Clube Repasse: HTML scrape of listing pages.
- Compra Certa: JSON API endpoint, no headless browser needed.
- CG Veículos: evaluated, dropped (low yield / unstable structure).

## Cadence

Tue / Fri [2, 5] — storefronts refresh inventory mid-week and end-of-week;
two runs per week captures the main update windows.

## Rules

- Damage gate + fail-closed identity fields. Ceiling **1000 writes/run**.
- Spec: `docs/superpowers/specs/2026-07-19-aggressive-ingestion-plan.md`
