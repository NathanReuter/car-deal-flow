---
name: harvest-webmotors
description: Harvests Webmotors repasse listings into Car Deal Flow as pre_repossession leads. Use when asked to "harvest webmotors", "pull Webmotors repasse ads", "run the webmotors harvest", or "harvest pre-repossession webmotors".
---

# Harvest Webmotors

Captures private-seller repasse ads (`tipovendedor=PF`) from Webmotors via
the site's internal JSON API, using Playwright with stealth mode to avoid bot
detection.

## One command

```bash
npm run harvest:webmotors
```

Writes summary to `/tmp/webmotors-harvest/write-summary.json`.
Platform: `Webmotors`, `sellerType: repasse`, `dealPhase: pre_repossession`.

## Scraping notes

- Strategy: Playwright + stealth plugin intercepting the internal JSON search
  API (`tipovendedor=PF` filter restricts to private sellers only).
- PF protection (three layers): (1) `tipovendedor=PF` query param on every API
  call; (2) per-result `Seller.SellerType` check — any result whose SellerType
  is present and !== "PF" is skipped with reason `not_pf` rather than ingested;
  (3) `hasFinancingSignal` text gate rejects plain-sale ads without a
  financing-transfer phrase. Dealer stock cannot pass all three layers.
- Anti-bot evasion (measured 2026-07-23): a fresh warm session clears ~6 API
  pages before Cloudflare/PerimeterX returns 403. Runs **headful by default**
  (`wmLaunchOptions`): the findings flagged headless-stealth as itself a likely
  bot tell, and the harvest runs locally on a Mac with a real display. Set
  `WM_HEADLESS=1` (exactly — `true`/`yes` are ignored) to force headless (e.g.
  a Linux server, where headful needs xvfb). The IP-reputation ceiling is the
  dominant limiter, not fingerprint. Two rotation layers:
  (1) **Cookie/context rotation (always)** — the list and harvest CLIs drop the
  session cookie and re-warm via `warmWebmotorsContext` every
  `WM_ROTATE_EVERY_PAGES` (5) fetches, with jittered pacing
  (`throttleFetch` / `WM_PACING`, 1.5–4s). This alone does **not** change the
  source IP.
  (2) **IP rotation (only with `WM_PROXY_*`)** — set `WM_PROXY_SERVER` (+
  `WM_PROXY_USERNAME` / `WM_PROXY_PASSWORD`) to route each context through a
  residential proxy. A literal `{session}` in the username is replaced with a
  fresh token per warm-up (`wmProxyForContext`), so every context rotation
  lands on a new IP. When proxy is set, warm-up also aborts `image`/`media`
  requests to cut metered bandwidth (`WM_LOAD_IMAGES=1` disables). Unset ⇒
  direct connection (free path unchanged): rotate the IP manually (phone-tether
  + airplane-mode) or let it cool. **Camoufox was evaluated and rejected**
  (unresolved `chrome://juggler` automation leak — worse than the stealth
  baseline). curl-impersonate (`curl_cffi` chrome136) can spend a browser-
  minted cookie over matched JA4+H2, but only ~1–3 pages/token, so the in-
  browser rotation path above is the primary strategy; see
  `scripts/ingestion/webmotors-probe.ts` / `webmotors-spend-test.ts` for the
  diagnostics.
- Fail-closed anti-bot handling (issue #8): the internal JSON API is
  classified per page. A PerimeterX block — non-OK HTTP (403/429), an HTTP-200
  anti-bot HTML wall (*"Access to this page has been denied"* / `px-captcha`),
  or a non-JSON body — is recorded as `skipped.blocked` + an `errors[]` entry
  and **aborts the run** (non-zero exit via the orchestrator), rather than
  being mistaken for end-of-results. A completed default run that scanned zero
  raw results also aborts as a probable warm-up block; a suspiciously low yield
  is flagged `skipped.low_yield`. A genuinely empty page still ends pagination
  normally. (Resolves PR #7 review finding #2.)

## Cadence

Mon / Wed / Fri [1, 3, 5] — Playwright load is moderate; three runs per week
balances freshness against resource cost.

## Rules

- Damage gate + fail-closed identity fields. Ceiling **1000 writes/run**.
- Spec: `docs/superpowers/specs/2026-07-19-aggressive-ingestion-plan.md`
