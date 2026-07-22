# Webmotors antibot: swap to Camoufox + jittered pacing

**Spec:** `docs/superpowers/specs/2026-07-22-webmotors-antibot-camoufox-design.md`
**Worktree:** `webmotors-antibot`

## Context

`npm run harvest:webmotors` is being blocked by PerimeterX mid-run (last
live run: blocked at page 7 of the `repasse` query, correctly fail-closed
per issue #8 / PR #11). `puppeteer-extra-plugin-stealth` is obsolete and a
known-fingerprinted signature in 2026 anti-bot systems. Fix: swap the
browser layer to Camoufox (`camoufox-js`) and randomize Webmotors' request
pacing. Detection/fail-closed logic (issue #8) is untouched.

## Plan deviation from spec (found during planning)

The spec suggested widening `throttleFetch()` in `lib/harvest-runner.ts`
from its fixed 300ms to a 1.5–4s jittered window. `throttleFetch` is shared
by **10 other harvesters** (napista, santander, bidchain, mgl, olx,
storefronts, vip...), so a global change would slow all of them 5–13x for a
Webmotors-only problem. Task 4 below instead adds an **optional** jitter
range parameter to `throttleFetch`, defaulting to today's exact behavior
(fixed 300ms) for every existing caller — only `webmotors-harvest.ts` opts
into the wider randomized window.

## Dependency graph

```
Task 1 (spike: confirm camoufox-js API shape)
    │
    ├── Task 2 (shared Camoufox launch helper in webmotors-list.ts)
    │       │
    │       └── Task 3 (wire webmotors-harvest.ts to helper; drop old deps)
    │
    └── Task 4 (throttleFetch jitter param — independent of 1–3)

Task 5 (SKILL.md docs) — depends on 2, 3, 4 (describes final behavior)
```

Tasks 1–3 are sequential (each wiring depends on the confirmed API shape).
Task 4 has no dependency on Camoufox and can be done in parallel/either
order.

## Tasks

### Task 1 — Spike: confirm camoufox-js launch API (foundation)

Install `camoufox-js` (pinned exact version). Write a throwaway script (not
committed as production code) that: runs `npx camoufox-js fetch` once,
launches via `Camoufox({ headless: true })`, navigates to `WM_HOMEPAGE`,
and runs a `page.evaluate(fetch(WM_API_BASE + "?..."))` the same way
`fetchApiPage` does today. Determine whether the launch call returns a
`Browser` (needs `.newPage()`) or a `BrowserContext` (pages come from it
directly), and confirm the in-page `fetch()` + `credentials: "include"`
pattern returns the same JSON shape Chromium did.

- **Files:** none in `scripts/ingestion/` (throwaway spike script, e.g. run
  via `npx tsx` from a scratch file, deleted after); `package.json` gains
  `camoufox-js`, loses nothing yet.
- **Acceptance:** documented finding (in the task notes / commit message) of
  (a) exact return shape of `Camoufox()`, (b) confirmation the internal API
  fetch pattern still works unchanged.
- **Verify:** manual run, live network — homepage loads, API fetch returns
  parseable `SearchResults` JSON.
- **Scope:** XS (spike only, no production files). **Deps:** none.

### Checkpoint A — after Task 1

- [ ] Camoufox launch shape confirmed and documented.
- [ ] Internal API fetch confirmed working through Camoufox before any
      production file is touched.
- [ ] If the spike fails (Camoufox can't reach the API, or fetch/cookie
      behavior differs materially) — **stop and report**, do not proceed to
      Task 2 with a workaround guess.

### Task 2 — Shared Camoufox launch helper

Add an exported helper in `webmotors-list.ts` (e.g.
`launchWebmotorsBrowser()`) using the confirmed API shape from Task 1,
replacing the module-level `chromium.use(stealth())` +
`chromium.launch({headless:true})`. Remove the `playwright-extra` /
`puppeteer-extra-plugin-stealth` imports from this file. `webmotors-list.ts`
becomes the single source of truth for how the browser is launched, mirroring
the existing classifier single-source pattern from issue #8.

- **Files:** `scripts/ingestion/webmotors-list.ts`
- **Acceptance:** `webmotors-list.ts` launches via Camoufox; no
  `playwright-extra`/stealth-plugin imports remain in this file; existing
  exports (`fetchApiPage`, `classifyWmApiResponse`, etc.) unchanged.
- **Verify:** `npx tsc --noEmit` clean; `npm test -- webmotors` still green
  (classifier/fetch tests use a fake `Page`, unaffected by the launcher
  swap).
- **Scope:** S. **Deps:** Task 1.

### Task 3 — Wire `webmotors-harvest.ts` to the shared helper

Replace `webmotors-harvest.ts`'s own `chromium.use(stealth())` +
`chromium.launch({headless:true})` with a call to
`launchWebmotorsBrowser()` from Task 2. Remove now-unused
`playwright-extra`/stealth-plugin imports from this file too. Once both
files are migrated, remove `playwright-extra` and
`puppeteer-extra-plugin-stealth` from `package.json`.

- **Files:** `scripts/ingestion/webmotors-harvest.ts`, `package.json`
- **Acceptance:** `harvestWebmotors()` launches via the shared helper;
  `playwright-extra`/`puppeteer-extra-plugin-stealth` no longer appear
  anywhere in `scripts/ingestion/` or `package.json`.
- **Verify:** `npx tsc --noEmit` clean; `npm test -- webmotors` green;
  `npx tsx scripts/ingestion/webmotors-harvest.ts --dry-run --limit 5`
  runs end-to-end against live Webmotors without a launch-time crash.
- **Scope:** S. **Deps:** Task 2.

### Checkpoint B — after Tasks 2–3

- [ ] `npm test` green, `npx tsc --noEmit` clean.
- [ ] No remaining references to `playwright-extra` / stealth-plugin in the
      repo; `package.json` updated.
- [ ] Live `--dry-run --limit 5` smoke run completes (does not by itself
      prove the block is avoided — see Checkpoint C).

### Task 4 — Jittered pacing for Webmotors only

Extend `throttleFetch()` in `lib/harvest-runner.ts` to accept an optional
`{ minMs, maxMs }` jitter range, defaulting to today's fixed `FETCH_DELAY_MS`
(300ms) when omitted — every existing caller (napista, olx, santander,
bidchain, mgl, storefronts, vip, etc.) keeps its exact current behavior with
zero code changes. In `webmotors-harvest.ts`, pass a wider window (e.g.
1500–4000ms) at its `throttleFetch()` call sites.

- **Files:** `scripts/ingestion/lib/harvest-runner.ts`,
  `scripts/ingestion/webmotors-harvest.ts` (+ tests)
- **Acceptance:** `throttleFetch()` called with no args behaves exactly as
  before (existing tests for other harvesters unaffected); called with a
  range, resolves after a delay uniformly randomized inside `[minMs, maxMs]`;
  Webmotors' harvest loop uses the wider window.
- **Verify:** new unit test for `throttleFetch` jitter bounds (mock timers);
  `npm test` full suite green (confirms no other harvester's behavior
  changed); `npx tsc --noEmit` clean.
- **Scope:** S. **Deps:** none (parallel to Tasks 1–3).

### Task 5 — Update SKILL.md

Replace the "Stealth may degrade over time... upgrade path: Camoufox"
bullet in `.claude/skills/harvest-webmotors/SKILL.md` with a description of
the Camoufox setup now in use, the one-time `npx camoufox-js fetch`
prerequisite, and the jittered pacing. Keep the existing fail-closed
anti-bot paragraph (issue #8) as-is.

- **Files:** `.claude/skills/harvest-webmotors/SKILL.md`
- **Acceptance:** doc matches implemented behavior; no stale references to
  the stealth plugin.
- **Verify:** manual read-through.
- **Scope:** XS. **Deps:** Tasks 2, 3, 4.

### Checkpoint C — complete

- [ ] `npm test` green; `npx tsc --noEmit` clean.
- [ ] SKILL.md accurate.
- [ ] Human review: observe the next 1–2 scheduled/manual Webmotors runs for
      reduced/absent `skipped.blocked` — this is an outcome to monitor, not
      a hard gate (a single clean run doesn't prove the fix; PerimeterX
      behavior is probabilistic). If blocks persist, issue #8's fail-closed
      abort still protects against silent truncation either way.

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| `camoufox-js` experimental; API doesn't match docs | Med | Task 1 spike gates all further work — stop and report if it fails |
| ~200MB Camoufox download on a fresh machine/CI | Low | Documented manual `npx camoufox-js fetch` prerequisite in SKILL.md |
| Global `throttleFetch` change slows unrelated harvesters | Med (caught during planning) | Task 4 uses an opt-in parameter with an unchanged default, not a global constant change |
| Camoufox alone doesn't fully resolve blocking (other signals) | Low | Issue #8's fail-closed detection still catches and aborts non-zero — no silent regression |

## Notes

Mirrors this into `tasks/plan.md` (new phase section) + `tasks/todo.md`
(checkbox list) per the planning skill, without disturbing the existing
aggressive-ingestion master plan tracked there.
