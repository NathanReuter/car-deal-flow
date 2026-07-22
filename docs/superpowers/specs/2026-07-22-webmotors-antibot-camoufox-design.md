# Webmotors antibot: swap to Camoufox + jittered pacing

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
