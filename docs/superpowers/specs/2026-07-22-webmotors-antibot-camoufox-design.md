# Webmotors antibot: swap to Camoufox + jittered pacing

> **STATUS (2026-07-23): Camoufox path spiked and rejected.** The "Decision"
> and "Design" sections below describe the *original* plan, which turned out
> not to work — see **"Research findings — Task 1 spike results"** further
> down for the full evidence trail, and **"Handoff — open questions for
> further research"** at the very end for the decision this spec needs next.
> This doc is being handed off for further research/extrapolation on another
> machine; treat the Camoufox sections as historical context, not a live plan.

## Context

`npm run harvest:webmotors` is getting blocked by Webmotors' PerimeterX
mid-run. The fail-closed detection built for issue #8 (PR #11, merged) is
working correctly — a live run on 2026-07-22 was blocked at page 7 of the
`repasse` query, recorded `skipped.blocked` + an `errors[]` entry, and
aborted non-zero instead of silently truncating
(`/tmp/webmotors-harvest/write-summary.json`). The problem this spec
addresses is different: **avoiding** the block in the first place, not
detecting it.

The current bypass strategy (`webmotors-list.ts`, `webmotors-harvest.ts`) is
`playwright-extra` + `puppeteer-extra-plugin-stealth`, launched headless,
with one homepage warm-up and a fixed inter-request delay
(`throttleFetch`). `puppeteer-extra-plugin-stealth` is unmaintained and, per
2026 anti-bot research, now a well-fingerprinted signature that PerimeterX
(HUMAN Security) and similar systems specifically detect — it is no longer
"stealthy." The project's own `SKILL.md` already anticipated this
("Stealth may degrade over time... upgrade path: switch to Camoufox").

**Constraints (from brainstorming):** runs on a local/home machine (not a
datacenter IP), no budget for paid proxy/unblocking services — the fix must
be free/open-source.

## Decision

Swap the browser layer from `playwright-extra` + stealth-plugin to
**Camoufox** (`camoufox-js`), a patched-Firefox anti-detect browser with
built-in fingerprint/JA3 rotation. Combine with randomized (jittered)
inter-request pacing instead of a fixed delay. The anti-bot **detection**
layer (issue #8's classifier, `WebmotorsBlockError`, fail-closed abort) is
unchanged — this is purely a bypass-quality change.

## Design

### 1. Dependency swap

- Remove `playwright-extra`, `puppeteer-extra-plugin-stealth` from
  `package.json`.
- Add `camoufox-js` (pinned exact version — package is young/"experimental";
  do not use a caret range).
- `playwright` stays (types, and possibly `firefox.connect()` depending on
  spike outcome).
- One-time setup, **not** run automatically from harvest code: `npx
  camoufox-js fetch` downloads the patched-Firefox build (~200MB) into
  `~/.cache/camoufox`. Documented in SKILL.md as a prerequisite, same way
  Playwright's own browser download is a prerequisite today.

### 2. API spike (foundation task, before wiring)

`camoufox-js` docs show two launch shapes:

```ts
// Direct launch
import { Camoufox } from "camoufox-js";
const browserOrContext = await Camoufox({ headless: true });

// Or as a remote server
import { launchServer } from "camoufox-js";
import { firefox } from "playwright-core";
const server = await launchServer({ port: 8888 });
const browser = await firefox.connect(server.wsEndpoint());
```

Before touching `webmotors-list.ts`/`webmotors-harvest.ts`, spike the direct
`Camoufox()` launch against a live `WM_HOMEPAGE` fetch to confirm: (a)
whether it returns a `Browser` or a `BrowserContext` (changes whether
`.newPage()` is called on the result or the result *is* the context), and
(b) that a `page.evaluate(fetch(...))` call against the internal API
succeeds with `credentials: "include"` the same way it does under Chromium
today. Prefer the direct-launch shape over `launchServer` — no persistent
server process needed for a short-lived CLI harvest script.

### 3. Shared launch helper

`webmotors-list.ts` and `webmotors-harvest.ts` currently duplicate the
`chromium.use(stealth())` + `chromium.launch({headless:true})` pair. Since
both call sites need to change to Camoufox anyway, add one exported helper
(in `webmotors-list.ts`, alongside the existing classifier-as-single-source
pattern from issue #8) that both files call, instead of duplicating the
Camoufox launch config twice.

### 4. Jittered pacing

`throttleFetch()` in `lib/harvest-runner.ts` currently waits a fixed
`FETCH_DELAY_MS` between requests. Replace with a randomized delay in a
window (e.g. 1.5s–4s) — a constant interval is itself a bot signal. No
mouse-movement or scroll simulation is added: the harvester only ever calls
`fetch()` from page context and never clicks or scrolls, so there is no
surface for cursor-humanization to act on. `throttleFetch` is shared by
other harvesters (olx, storefronts, etc.) — confirm the jitter change is
harmless/beneficial for those too, since it's a shared utility, not a
Webmotors-only change.

### 5. Unchanged

`classifyWmApiResponse`, `WebmotorsBlockError`, `WM_BLOCK_MARKERS`, and the
fail-closed abort behavior in `harvestWebmotors` (issue #8 / PR #11) are not
touched. This spec only changes what launches and drives the browser and how
requests are paced — not how a block is detected or handled once it occurs.

### 6. Docs

Update `.claude/skills/harvest-webmotors/SKILL.md`:
- Replace "Stealth may degrade over time... upgrade path: Camoufox" with a
  description of the actual Camoufox setup in use, the one-time `npx
  camoufox-js fetch` prerequisite, and jittered pacing.
- Keep the existing fail-closed anti-bot paragraph (issue #8) as-is — still
  accurate.

## Testing

- Existing unit tests for `classifyWmApiResponse` / `fetchApiPage` /
  `harvestWebmotors` (fake `Page` injection) are unaffected — the
  classifier and harvester loop logic don't change, only what constructs
  the `Page` they're handed.
- No new automated test for the actual Camoufox browser launch (same as
  today — the stealth-plugin launch was never unit tested either; it's
  inherently a live-network concern). Verification is manual: a live `npx
  tsx scripts/ingestion/webmotors-harvest.ts --dry-run --limit 5` run.
- Add/adjust a unit test asserting the shared launch helper is what both
  `webmotors-list.ts` and `webmotors-harvest.ts` invoke (import-level check,
  not a live browser check), matching the "single source of truth" pattern
  already used for the classifier.

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| `camoufox-js` is experimental; real API may not match docs | Med | Spike task (§2) confirms actual shape before wiring into the harvester |
| ~200MB download on a fresh machine/CI | Low | Documented manual `npx camoufox-js fetch` step in SKILL.md; not run automatically |
| Fingerprint fix isn't sufficient (other signals still trip PerimeterX) | Low | Existing fail-closed detection (issue #8) still catches and aborts non-zero — no silent regression either way |
| Jitter change to shared `throttleFetch` affects other harvesters unexpectedly | Low | Keep jitter window close to today's fixed delay's magnitude; other harvesters already tolerate variable network latency |

## Out of scope

- Proxy/residential IP rotation (no budget, not needed — runs from a home
  IP).
- Paid unblocking APIs (ScraperAPI/Zyte/etc.) — no budget.
- Rewriting the fetch strategy to full page navigation instead of internal
  API calls (Approach C from brainstorming) — deferred; Camoufox alone
  addresses the fingerprinting root cause without this larger rewrite.

---

## Research findings — Task 1 spike results (2026-07-22 / 2026-07-23)

Full task breakdown lives in `tasks/issue-webmotors-antibot-camoufox.md`
(same worktree/branch). This section is the technical record of what was
actually tried, condensed into one place for handoff.

### Environment / reproduction

- Runs from a local machine (home IP), macOS (Darwin 25.5.0).
- Baseline (current production code) evidence: a live run on 2026-07-22
  (`/tmp/webmotors-harvest/write-summary.json`) got **6 clean pages** of
  the `repasse` query before `HTTP 403` on page 7 — i.e. the existing
  `playwright-extra` + `puppeteer-extra-plugin-stealth` setup is *not*
  instantly blocked, it degrades over a session.
- `camoufox-js@0.11.2` installed as an experiment (`npm view camoufox-js
  versions` shows `0.11.2` is latest as of 2026-07-22; no newer release
  available). Camoufox browser binary fetched via `npx camoufox-js fetch`
  (~313MB Firefox build + ~66MB GeoIP DB, cached under `~/.cache/camoufox`).
- Both spike scripts were throwaway (`scripts/ingestion/__spike_camoufox.ts`,
  deleted after each run, never committed) that mimicked
  `webmotors-list.ts`'s `fetchApiPage`: warm up `WM_HOMEPAGE`, then
  `page.evaluate(fetch(WM_API_BASE + "..."))` with `credentials: "include"`.

### Round 1 — bare Camoufox launch

`Camoufox({ headless: true })` returns a Playwright `Browser` (confirmed via
`camoufox-js`'s own `sync_api.d.ts`: no `user_data_dir` → `Browser`, with
`user_data_dir` → `BrowserContext`). Needs `.newPage()`, same shape as
today's `chromium.launch()`.

**Blocker found immediately:** `browser.newPage()` threw on every attempt:

```text
Protocol error (Browser.setDefaultViewport): ERROR: failed to call method
'Browser.setDefaultViewport' ... Found property "<root>.viewport.isMobile"
- false which is not described in this scheme
```

Root cause (confirmed via web research): Playwright 1.61 added an
`isMobile` field to the viewport payload sent over the CDP-like protocol;
Camoufox's bundled Juggler (Firefox automation protocol) build predates
that field and rejects the unrecognized property. This is a known,
**currently unresolved** upstream bug:
[`daijro/camoufox#653`](https://github.com/daijro/camoufox/issues/653)
("pip install camoufox is broken as of today — new pypi playwright 1.61
release incompatible with bundled Juggler"), filed against the Python
package but the same protocol/browser-build incompatibility applies to the
JS port since both share the same underlying browser build and Juggler
protocol version. The reported workaround: pin `playwright`/`playwright-core`
to `1.60.0`.

This repo pins `playwright@^1.61.1` (`package.json`), used by 10+ other
harvesters (napista, olx, santander, bidchain, mgl, storefronts, vip...).
Downgrading it project-wide to work around one source's experimental
dependency was judged out of scope for a spike — tested transiently
instead (not committed) purely to see if Camoufox was worth pursuing
further before deciding whether a downgrade was worth proposing.

**With `playwright@1.60.0` (transient, uncommitted):** launch succeeded.
But the result was worse than baseline, not better:

- Zero cookies were present on the browser context after visiting
  `WM_HOMEPAGE` (`waitUntil: "networkidle"`, 8s explicit wait). No
  PerimeterX session cookies were ever set.
- The very first API request (`page 1`, `q=repasse`) returned `HTTP 403`
  with a PerimeterX JSON block payload (`appId`, `jsClientSrc`,
  `blockScript`, etc.) — blocked immediately, vs. baseline's 6 clean pages.

### Round 2 — geoip/locale fix, deeper root cause

Hypothesis: round 1's instant block was a locale/timezone/IP-geo mismatch
— Camoufox's default fingerprint generator doesn't infer locale/timezone
from the actual IP unless told to, so a Brazilian site was likely seeing a
fingerprint with a non-BR locale/timezone, a classic PerimeterX behavioral
tell.

Retried with `geoip: true`, `locale: "pt-BR"`, `humanize: true`, plus
`page.on("console"/"response"/"requestfailed")` instrumentation.

**Confirmed the hypothesis — and found a bigger problem underneath it:**

- `page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)`
  now correctly returned `"America/Sao_Paulo"`, `navigator.language` /
  `navigator.languages` correctly `"pt-BR"` / `["pt-BR","pt"]`.
- PerimeterX cookies **were** now set after the homepage visit: `_pxvid`,
  `_px3`, `pxcts`, `_pxde`.
- PerimeterX's own scripts loaded and ran successfully (`captcha.js`,
  `client.px-cloud.net/PX7Vv0zOst/main.min.js`,
  `collector-px7vv0zost.px-cloud.net`, `js.px-cloud.net`,
  `fst-ec.perimeterx.net` — all HTTP 200).
- **But `document.title` after the homepage load was `"Access to this page
  has been denied"`** — the homepage itself is now the PerimeterX block
  page, not just the downstream API. Console logging caught the smoking
  gun:

  ```text
  Security Error: Content at https://www.webmotors.com.br/ may not load
  data from chrome://juggler/content/juggler.xul.
  ```

  This is Playwright's Firefox automation driver (**Juggler**) leaking an
  internal `chrome://juggler/...` URL reference directly into page-visible
  console errors. PerimeterX's JS sensor (which was confirmed running —
  see the script loads above) can observe this directly: it is a
  first-party, in-page signal that the browser is Juggler-automated, not a
  fingerprint/behavior heuristic that could be tuned away with
  `LaunchOptions` (`humanize`, `geoip`, `os`, `fonts`, etc. were all
  already in play at this point).

### Conclusion

`camoufox-js@0.11.2` is not currently viable against Webmotors' PerimeterX
deployment:

1. It doesn't even launch against this repo's pinned `playwright@^1.61.1`
   (upstream bug, unresolved).
2. The documented workaround (`playwright@1.60.0`) unblocks the launch but
   exposes a structural automation-protocol leak (`chrome://juggler/...`
   visible in-page) that PerimeterX's sensor can detect directly — this
   produced a *harder* block (full homepage denial) than the status quo
   (6 clean pages before an API-level 403).

Both rounds are reproducible; neither required guesswork once the log
output was inspected — the failures are not tuning problems, they are
protocol/version incompatibilities in the current `camoufox-js` release.

## Handoff — open questions for further research

This spec needs a decision on how to proceed. Candidates, not yet
evaluated in depth:

1. **Fall back to Approach B (hardening the existing stealth stack).**
   Keep `playwright-extra` + `puppeteer-extra-plugin-stealth`
   (`playwright@^1.61.1`, no downgrade needed), and instead invest in
   jittered pacing (§4 above, already designed and low-risk) plus
   re-warming the homepage session between keyword passes. Doesn't fix the
   "stealth plugin is fingerprinted" root cause identified in the original
   Context section, but is the only option that doesn't require solving an
   unresolved upstream bug. Lowest effort, most likely near-term win, but
   ceiling is capped by the stealth plugin's known obsolescence.

2. **Retry Camoufox once the upstream Juggler/`isMobile` bug is fixed.**
   Watch `daijro/camoufox#653` / `apify/camoufox-js` releases. Worth a
   `npm view camoufox-js versions` / GitHub check before any future
   attempt — if a release lands that fixes the Juggler leak *and* is
   compatible with `playwright@1.61.x` without downgrading, this spec's
   original design (§1–§6) becomes viable again largely as-written.

3. **Try a different anti-detect browser entirely.** The 2026 research
   pulled during brainstorming (`zenrows.com/blog/perimeterx-bypass`,
   `scrapingbee.com/blog/how-to-bypass-perimeterx-anti-bot-system`) also
   named **Zendriver** and **SeleniumBase UC** as DIY PerimeterX-bypass
   options alongside Camoufox. Neither was evaluated — Camoufox was chosen
   first because it was already anticipated in this repo's own
   `SKILL.md`. Worth spiking one of these with the same
   methodology used here (throwaway script, live homepage + API request,
   inspect cookies/console/network) before committing.

4. **Approach C — real page navigation instead of the internal JSON API**
   (originally deferred as out of scope). Navigating actual
   `webmotors.com.br` search-result pages produces a more
   organic-looking traffic pattern (real page loads, real resource
   fetches, real JS execution) than directly calling
   `/api/search/car` via `page.evaluate(fetch(...))`. Untested against
   PerimeterX specifically, and requires parsing HTML/embedded JSON
   instead of a clean API response — bigger rewrite, but may sidestep the
   API-specific blocking pattern entirely regardless of which browser
   automation layer is used.

5. **Investigate whether the `chrome://juggler` leak is fixable/patchable**
   directly (e.g. a Firefox preference or Camoufox config that suppresses
   the security-error console message, or a newer/older Camoufox *browser*
   build paired with the same `camoufox-js` client version). Not attempted
   here — the leak was treated as a hard stop per this task's own
   spike-then-report discipline, but it's possible this is a shallow fix
   (e.g. a CSP/permissions setting) rather than a deep protocol
   incompatibility. Worth 30–60 minutes of investigation before writing
   off Camoufox entirely.

Whichever direction is chosen, the parts of this spec that were **never in
question** and should carry forward unchanged: the fail-closed detection
layer (issue #8 / PR #11) stays as-is regardless of bypass strategy, and
the opt-in `throttleFetch` jitter design (§4, corrected during planning to
avoid a global behavior change — see `tasks/issue-webmotors-antibot-camoufox.md`
"Plan deviation from spec") is valid no matter which browser/strategy wins.
