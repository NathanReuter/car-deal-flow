# Fix #8 — Webmotors PerimeterX block silently treated as end-of-results

## Context

`npm run harvest:webmotors` under-harvests silently. In
`scripts/ingestion/webmotors-harvest.ts`, `fetchApiPage()` collapses three
distinct outcomes into a single empty array:

```ts
if (!resp.ok) return null;              // 403/429 PerimeterX block → null
...
if (!results || typeof results !== "object") return [];   // null → []
```

and the pagination loop stops on any empty page:

```ts
if (results.length === 0) break;        // can't tell "end of results" from "blocked"
```

So a mid-run PerimeterX block (the site returns HTTP 403/429, or an HTTP 200
anti-bot HTML page titled *"Access to this page has been denied"*) looks
identical to genuinely running out of listings. The 2026-07-21 live run scanned
only 10 ads (out of up to 720 possible) with `errors: []` — nothing looked
wrong. This violates the fail-closed guarantee PR #7 claimed for this harvester
(PR #7 review, finding #2).

**Intended outcome:** a PerimeterX block is detected, recorded distinctly, and
aborts the run (fail-closed) instead of silently truncating. Genuine
end-of-results still stops pagination normally.

### Key finding — fail-closed already works at the orchestrator

`npm run harvest:webmotors` routes through `scripts/ingestion/harvest.ts`, which
wraps each source in try/catch (`harvest.ts:354-372`) and exits non-zero when
any error is recorded (`harvest.ts:424`). So **if `harvestWebmotors` throws on a
block, it becomes a `failedSummary` and the process exits 1** — no orchestrator
changes needed. The standalone `webmotors-harvest.ts main()` also `process.exit(1)`s
on an uncaught throw. The fix is therefore: *detect the block and throw.*

### Existing patterns to reuse

- `fetch-guards.ts` — `assertNotCloudflareBlock()` (regex markers on HTML) and
  `assertHttpOk()` (throw on non-OK). Same throw-on-block philosophy; siblings
  (olx, santander, storefronts) all throw + record `fetch_error`.
- `lib/harvest-runner.ts` — `HarvestSummary`, `bumpSkip()`, `writeSummary()`.
  No new fields needed; use `skipped.blocked` + `errors[]`.
- Tests are **pure-function vitest** unit tests (`__tests__/*.test.ts`); the
  fetch classifier must be a pure exported function so it's testable without a
  browser. Compare `__tests__/olx-list.test.ts`, `bidchain-fetch.test.ts`.

## Design

1. **Pure classifier** (`webmotors-list.ts`, exported): move `page.evaluate` to
   return raw materials — `{ ok, status, contentType, body }` (always
   `resp.text()`, never `resp.json()` inside evaluate) — and classify in Node:

   ```ts
   export class WebmotorsBlockError extends Error {}
   export type WmApiOutcome =
     | { kind: "ok"; results: WebmotorsSearchResult[] }
     | { kind: "empty" }
     | { kind: "blocked"; reason: string };
   export function classifyWmApiResponse(raw: {
     ok: boolean; status: number; contentType: string; body: string;
   }): WmApiOutcome
   ```

   Block signals: `!ok` (e.g. 403/429); content-type not JSON or body matches
   PerimeterX markers (`/access to this page has been denied/i`, `px-captcha`,
   `_pxhd`, leading `<html`/`<!doctype`); `JSON.parse` throws. Otherwise parse:
   non-empty `SearchResults` → `ok`; empty/missing → `empty`.

2. **`fetchApiPage`** (in both `webmotors-list.ts` and `webmotors-harvest.ts`)
   uses the classifier: `blocked` → `throw new WebmotorsBlockError(reason)`;
   `ok`/`empty` → return the array (empty = genuine end).

3. **Harvester loop fail-closed** (`webmotors-harvest.ts`): in the existing
   try/catch, if the error is a `WebmotorsBlockError` → `bumpSkip(summary,
   "blocked")`, push to `summary.errors`, persist the partial summary via
   `writeSummary`, then **rethrow** (abort whole run → orchestrator exit 1).
   Any other fetch error keeps today's behavior (`fetch_error` + `break` the
   current keyword only). Genuine `results.length === 0` still `break`s.

4. **Plausibility guard** (`webmotors-harvest.ts`): track total raw results seen.
   After all queries, if the run used the default query set and saw **zero** raw
   results, throw `WebmotorsBlockError("no results across all queries — probable
   silent block")` (catches a warm-up-time block). Emit a stderr warning +
   `bumpSkip(summary, "low_yield")` when yield is suspiciously low (avg < 1
   raw result/query) without hard-aborting. Skip both checks when custom
   `--query` args are supplied (legitimately narrow).

5. **Docs** (`.claude/skills/harvest-webmotors/SKILL.md`): document the real
   fail-closed anti-bot behavior, resolving PR #7 finding #2.

## Tasks

### Task 1 — Pure classifier + block-error type (foundation)
Add `WebmotorsBlockError`, `WmApiOutcome`, PerimeterX marker constants, and
`classifyWmApiResponse()` to `webmotors-list.ts`. No caller wiring yet.
- **Files:** `scripts/ingestion/webmotors-list.ts`, new
  `scripts/ingestion/__tests__/webmotors-fetch.test.ts`
- **Acceptance:** classifier returns `ok` (with results), `empty` (empty/missing
  `SearchResults`), and `blocked` for each of: non-OK status, anti-bot HTML
  (200), non-JSON body, unparseable JSON.
- **Verify:** `npm test -- webmotors-fetch` passes; `npx tsc --noEmit` clean.
- **Scope:** S (1 file + 1 test). **Deps:** none.

### Task 2 — Rewire `fetchApiPage` to classify + throw
Change both `fetchApiPage` copies so `page.evaluate` returns
`{ok,status,contentType,body}`; classify in Node; throw `WebmotorsBlockError`
on `blocked`, return array otherwise. `webmotors-list.ts` keeps a thin wrapper;
`webmotors-harvest.ts` imports the classifier (single source of truth).
- **Files:** `scripts/ingestion/webmotors-list.ts`,
  `scripts/ingestion/webmotors-harvest.ts`
- **Acceptance:** `fetchApiPage` throws `WebmotorsBlockError` on a blocked raw
  response and returns `[]` on genuine empty; both files import one classifier.
- **Verify:** unit test with a fake `Page` (`evaluate` returns canned raw block)
  asserts `fetchApiPage` throws `WebmotorsBlockError`; `npx tsc --noEmit` clean.
- **Scope:** S. **Deps:** Task 1.

### Checkpoint A — after Tasks 1–2
- [ ] `npm test -- webmotors` green, `npx tsc --noEmit` clean.
- [ ] Classifier is the single detection point; no behavior change to genuine
      empty pagination.

### Task 3 — Harvester fail-closed + plausibility guard
In `harvestWebmotors`: catch `WebmotorsBlockError` → `skipped.blocked` + error +
persist summary + rethrow; keep `fetch_error`/`break` for other errors. Add the
zero-raw-results abort and low-yield warning (skipped when `--query` overrides).
- **Files:** `scripts/ingestion/webmotors-harvest.ts` (+ test)
- **Acceptance:** a block mid-run records `skipped.blocked`, adds an `errors[]`
  entry, and propagates (run aborts); genuine empty still stops cleanly; zero
  raw results on the default query set aborts.
- **Verify:** unit test drives `harvestWebmotors` with an injected fake page /
  fetch that returns a block on page 2 and asserts it throws + records
  `blocked`; `npm test -- webmotors`; `npx tsc --noEmit`.
- **Scope:** S/M. **Deps:** Task 2.

### Task 4 — Update SKILL.md (docs)
Add an anti-bot/fail-closed bullet under "Scraping notes" describing detection
(non-OK HTTP, anti-bot HTML, non-JSON) → recorded as `skipped.blocked` + error,
run aborts non-zero rather than truncating. Note it resolves PR #7 finding #2.
- **Files:** `.claude/skills/harvest-webmotors/SKILL.md`
- **Acceptance:** doc matches implemented behavior.
- **Verify:** manual read-through.
- **Scope:** XS. **Deps:** Task 3.

### Checkpoint B — complete
- [ ] `npm test` green; `npx tsc --noEmit` clean.
- [ ] Manual smoke (optional, needs network): `npx tsx
      scripts/ingestion/webmotors-harvest.ts --dry-run --limit 5` runs without
      regression; a forced-block probe (temporarily point `WM_API_BASE` at a
      404, or unit-test path) surfaces `skipped.blocked` + non-zero exit.
- [ ] SKILL.md accurate; issue #8 acceptance met.

## Risks
| Risk | Impact | Mitigation |
|------|--------|------------|
| Over-eager block detection flags valid empty pages | Med | Classify empty vs blocked strictly: empty only when JSON parses to an object with empty/missing `SearchResults`; everything non-JSON/non-OK is blocked. |
| Aborting mid-run drops partial writes | Low | DB writes already committed per-lead; persist partial summary before rethrow for inspectability. |
| Low-yield heuristic false positives | Low | Hard-abort only on **zero** raw results + default queries; otherwise warn only. |
| `webmotors-list.ts` standalone tool left with old bug | Med | Task 2 fixes both copies via the shared classifier. |

## Notes
Plan-mode restricts edits to this plan file. On execution I'll also mirror this
into `tasks/plan.md` + `tasks/todo.md` (checkbox task list) as the planning
skill requests.
