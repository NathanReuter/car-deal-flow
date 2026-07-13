# Agent-driven risk-check sync — design

## Problem

Six of the thirteen documentation/risk checklist items (`RiskCheckKey` in
`src/lib/types.ts`) have no consumer-facing API: recall status, registration
consistency, chassis consistency, financing lien, judicial restriction, and
overdue taxes/fines all sit behind a gov.br/Detran login. Theft/recovery
history (Sinesp Cidadão) has no web surface at all — mobile app only.

Automating these through a business-KYC-gated aggregator (Infosimples et al.)
would require representing this personal tool as a business with clients and
data-subject consent it doesn't have. That's off the table (see prior
conversation). The alternative explored here: since this runs locally on the
owner's own machine, a Claude Code agent can drive a browser using the
owner's own already-authenticated session — no credentials stored anywhere,
no business declaration required — and write structured results back into
the existing manual-entry data model.

## Scope

| Check | Official page | Login | Automated? |
|---|---|---|---|
| `recall_status` | SENATRAN portal (`portalservicos.senatran.serpro.gov.br`), "Recall" lookup | gov.br SSO | Yes |
| `registration_consistency` | Same SENATRAN portal, "Veículo" lookup | gov.br SSO | Yes |
| `chassis_consistency` | Same SENATRAN portal, "Veículo" lookup | gov.br SSO | Yes |
| `financing_lien` | Detran-SP gravame lookup | gov.br SSO | Yes |
| `judicial_restriction` | Detran-SP RENAJUD lookup | gov.br SSO | Yes |
| `overdue_taxes_fines` | Detran-SP débitos/restrições lookup | gov.br SSO | Yes |
| `theft_recovery_history` | Sinesp Cidadão — mobile app only, no web page | — | **No — stays manual** |
| `accident_flags`, `mileage_inconsistency`, `ownership_count`, `service_records`, `manual_key_availability` | — | — | No — inherently manual/inspection-based, out of scope |

All five automatable checks share one gov.br SSO login, so a single
persistent browser profile covers all of them.

## Data model change

`RiskCheckItem` (src/lib/types.ts) gains two optional provenance fields:

```ts
interface RiskCheckItem {
  key: RiskCheckKey;
  status: CheckStatus;
  severity: CheckSeverity;
  notes: string;
  evidenceUrl?: string;
  checkedBy?: "manual" | "agent";  // new
  checkedAt?: string;               // new — ISO date
}
```

`RiskCheckItem[]` is stored as a JSON blob in the `RiskCheck.items` column
(see `prisma/schema.prisma`), so this requires **no Prisma migration** —
just the type change. Existing entries have no `checkedBy`; the UI treats
that as equivalent to `"manual"`. No changes needed to the existing
manual-entry UI (`car-detail-tabs.tsx`, Documentation & Risk tab) beyond
optionally rendering the provenance tag if present.

## Architecture

Two deterministic scripts (no LLM involved, unit-testable) plus one Claude
Code project skill that provides the judgment glue between them.

### `scripts/risk-checks/list-targets.ts`

- Queries Prisma for cars in active pipeline stages (`new_lead`,
  `researching`, `waiting_docs`, `inspected`, `negotiating` — same active
  set as `lib/priority.ts`).
- For each car, inspects `RiskCheck.items` for the 6 automatable keys where:
  - `status === "pending"`, OR
  - `checkedBy === "agent"` AND `checkedAt` older than a staleness window
    (default 30 days, configurable via `--stale-days`).
  - Manual (`checkedBy` unset or `"manual"`) entries are never touched
    unless the item is still `"pending"`.
- Outputs a flat array: `{ carId, plate, chassis, brand, model, year, key }`.
- CLI usage: `npx tsx scripts/risk-checks/list-targets.ts [--car <id>] [--stale-days N]`.

### `scripts/risk-checks/write-result.ts`

- Args: `carId`, `key`, `status`, `severity`, `notes`, optional `evidenceUrl`.
- Validates `status` against `CheckStatus` and `severity` against
  `CheckSeverity` before writing — rejects anything else rather than
  silently writing bad data. This is the sole trust boundary between
  agent judgment and the database.
- Stamps `checkedBy: "agent"`, `checkedAt: <now, ISO>`.
- Reads the car's current `RiskCheck.items` JSON, replaces the one matching
  `key`, writes the array back — every other item is left untouched.
- CLI usage: `npx tsx scripts/risk-checks/write-result.ts --car <id> --key <key> --status <status> --severity <severity> --notes "<text>" [--evidence-url <url>]`.

### Skill: `.claude/skills/sync-risk-checks/SKILL.md`

Procedure:

1. Run `list-targets.ts` (optionally scoped to `--car <id>`) to get the work
   list for this run.
2. Verify the persistent browser profile is logged in (see below); if not,
   stop the entire run and tell the user to re-authenticate — don't fail
   item-by-item into the same wall.
3. For each `(car, key)` pair:
   a. Navigate to the matching official page, enter plate/chassis.
   b. Read the rendered result.
   c. Cross-check brand/model/chassis shown against the car record.
   d. Decide the outcome (see confidence rules below).
   e. Call `write-result.ts` with the outcome.
4. Report a summary back in conversation: N checked, M left pending and why
   — same shape as the FIPE bulk-sync summary panel, just conversational.

### Confidence rules (never guess)

| Situation | Outcome |
|---|---|
| Confident match, page shows a clear result | Real status (`verified`/`warning`/`failed`) with notes summarizing what was found, `evidenceUrl` set to the result page if stable/linkable |
| Site unreachable / timeout | `pending`, note: `"Site unreachable at <time>, retry later."` |
| Session expired / logged out | **Abort the whole run immediately** with a clear message — every remaining item would fail identically |
| CAPTCHA or unrecognized page structure | `pending`, note describing what was seen instead. Never attempt to solve/bypass a CAPTCHA |
| Vehicle mismatch (page's brand/model differs from our record) | `pending`, note: `"Page returned {brand model}, expected {our brand model} — verify manually."` |

This mirrors the FIPE integration's confidence gating: silently writing a
wrong or uncertain result is worse than leaving it pending for a human.

## Browser profile setup

- Dedicated profile directory: `.claude/browser-profile/` (gitignored —
  contains live session cookies, must never be committed).
- One-time manual setup: launch Chromium with
  `--user-data-dir=.claude/browser-profile`, log into gov.br yourself,
  close it. Every subsequent skill run reuses those cookies via the same
  flag — no credentials ever pass through code, prompts, or the database.
- The skill checks for a logged-in indicator on the SENATRAN/Detran portal
  at the start of each run before touching any car.

## Error handling summary

- Deterministic scripts (`list-targets`, `write-result`) fail loudly with a
  non-zero exit code and a clear message on bad input — no silent
  fallbacks.
- The skill's browser/judgment layer follows the confidence rules table
  above; every non-confident outcome is `pending` with an explanatory note,
  never a guessed `verified`/`failed`.

## Testing

- `list-targets.ts` and `write-result.ts`: unit tests against a seeded test
  SQLite DB — target-selection logic (active stages, staleness window,
  manual-entry protection), and write validation rejecting malformed
  status/severity values.
- The skill itself isn't unit-testable in the traditional sense (it's an
  LLM driving a browser). Verified instead by a real dry run against one
  seeded car with a known plate — confirming the written-back result and
  provenance stamp by hand, the same way the FIPE sync was verified live.

## Out of scope (for this spec)

- Scheduled/unattended runs (Approach 3 from brainstorming — an Agent SDK
  orchestrator). Worth revisiting if the owner later wants this to run on a
  cron without being in a live session.
- `theft_recovery_history` — no web surface exists to crawl; stays manual.
- Any check not in the scope table above.
