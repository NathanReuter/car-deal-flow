---
name: sync-risk-checks
description: Automates 6 of Car Deal Flow's documentation/risk checklist items (recall, registration, chassis, financing lien, judicial restriction, overdue fines) by driving a local logged-in browser session against official gov.br/Detran pages, then writing validated results back to SQLite. Use when asked to "sync risk checks", "check recall/gravame/RENAJUD/fines", or "run the risk-check agent" for one car or the whole active pipeline.
---

# Sync Risk Checks

Fills in the 6 automatable risk-check items for cars in the pipeline by
reading the official government vehicle-lookup pages with your own
already-authenticated browser session. Never guesses — anything short of a
confident, cross-checked match is left `pending` with an explanation for
manual follow-up.

## Scope

| Key | Official page |
|---|---|
| `recall_status` | SENATRAN portal — `https://portalservicos.senatran.serpro.gov.br/#/veiculos/recall` |
| `registration_consistency` | Same SENATRAN portal, vehicle/"Veículo" section |
| `chassis_consistency` | Same SENATRAN portal, vehicle/"Veículo" section |
| `financing_lien` | Detran-SP — gravame lookup (via detran.sp.gov.br's vehicle services) |
| `judicial_restriction` | Detran-SP — RENAJUD/restrictions lookup |
| `overdue_taxes_fines` | Detran-SP — `https://www.detran.sp.gov.br/detransp/en/servicos/veiculos/consultar_debitos_restricoes` |

**Not in scope:** `theft_recovery_history` (Sinesp Cidadão is mobile-app-only,
no web page exists to crawl — this stays a manual entry, always). Any key
not listed above is inherently manual/inspection-based and out of scope.

These government portals restructure their navigation periodically. If a
URL above has moved, use the Detran-SP or SENATRAN homepage's own search to
locate the current equivalent service rather than guessing at a URL.

## Prerequisite: one-time browser profile setup

This only needs to be done once (redo it if the session expires and
re-login is needed):

1. Launch a dedicated Chromium profile from the project root, pointed at
   `.claude/browser-profile/` as the user data directory (e.g. via
   `chromium-cli` with a persistent context, or `playwright open
   --browser=chromium` with `--user-data-dir=.claude/browser-profile`).
2. Log into gov.br yourself in that window (your real credentials — never
   entered by the agent).
3. Confirm you can reach `https://portalservicos.senatran.serpro.gov.br/#/usuario/painel`
   and see your logged-in name, then close the browser.
4. `.claude/browser-profile/` now holds your session cookies. It's
   gitignored — never commit it, never copy it anywhere off this machine.

## Procedure

1. Get the work list:
   ```bash
   npx tsx scripts/risk-checks/list-targets.ts
   ```
   or, for a single car:
   ```bash
   npx tsx scripts/risk-checks/list-targets.ts --car <carId>
   ```
   This prints a JSON array of `{ carId, plate, chassis, brand, model, year, key }`.

2. Before touching any car, open the browser using the persistent profile
   from `.claude/browser-profile/` and confirm you're still logged in
   (check the SENATRAN portal's user panel or equivalent). If the session
   has expired, **stop the entire run** and tell the user to redo the
   one-time login above — don't process items one-by-one into the same
   failure.

3. For each `(car, key)` pair in the work list:
   a. Navigate to the page listed in the Scope table for that `key`.
   b. Enter the car's plate (or chassis, whichever the page asks for).
   c. Read the rendered result.
   d. Cross-check: does the brand/model/chassis shown on the result page
      actually match this car's record? If the page doesn't show enough to
      confirm, treat it as not confirmed.
   e. Decide the outcome using the confidence rules below.
   f. Write it back:
      ```bash
      npx tsx scripts/risk-checks/write-result.ts \
        --car <carId> --key <key> --status <status> --severity <severity> \
        --notes "<what was found>" [--evidence-url <url if the result page is stable/linkable>]
      ```

4. After the batch, summarize in the conversation: how many checks were
   written, how many were left `pending` and why, one line per pending
   item.

## Confidence rules — never guess

| Situation | status | severity | notes |
|---|---|---|---|
| Confident match, page shows a clear clean result | `verified` | `low` | Summarize what the page showed |
| Confident match, page shows an active issue (pending recall, active lien, restriction, unpaid fine) | `warning` or `failed` (failed for lien/restriction/unpaid-fine; warning for a pending-but-fixable recall) | `medium`/`high`/`severe` matching the real-world severity | Summarize the specific issue found, plus amount/date if shown |
| Site unreachable / timeout | `pending` | leave unchanged from before (don't downgrade severity on a network blip) | `"Site unreachable at <timestamp>, retry later."` |
| CAPTCHA or unrecognized page structure | `pending` | unchanged | Describe exactly what was seen instead of the expected result |
| Vehicle mismatch (page's brand/model differs from the car record) | `pending` | unchanged | `"Page returned {brand model}, expected {our brand model} — verify manually."` |

Never attempt to solve or bypass a CAPTCHA. Never write `verified` or
`failed` without a confident, cross-checked match.

## Phase 1: pre-repossession (repasse) qualification

Repasse leads (`dealPhase = pre_repossession`, harvested by `harvest-repasse`)
use an inverted expectation for the lien check: **an active gravame is the
expected, good outcome** — it proves the ad's financing is real.

List only these targets (plated repasse cars; `financing_lien` +
`judicial_restriction` keys only):

```bash
npx tsx scripts/risk-checks/list-targets.ts --phase pre
```

| Finding on the Detran/gov.br page | status | severity | effect (automatic, via write-result) |
|---|---|---|---|
| Gravame / alienação fiduciária ativa | `verified` | `low` | Lead promoted `new_lead` → `researching` ("financiamento real") |
| No gravame for the plate | `warning` | `high` | Stays `new_lead`; note "possível golpe do repasse" |
| Restrição judicial / RENAJUD ativa | `failed` (or `warning`) | `high` | `repasseUrgency` → `high` (repossession clock running) |

Plateless repasse leads never appear in `--phase pre` targets — obtaining the
plate from the seller is a human step, recorded manually on the car first.

First check what's actually due — the seeded demo data ships with all 6
automatable keys already marked `verified` (manual baseline), so a fresh
checkout will show nothing pending until either 30 days pass on an
agent-checked item or a real car gets added with `pending` items:

```bash
npx tsx scripts/risk-checks/list-targets.ts
```

If that's empty and you just want to confirm the mechanics work end to end
(not a real crawl, just the plumbing), pick one seeded car and flip one of
its automatable keys to `pending` directly via Prisma Studio (`npm run
db:studio`, open the `RiskCheck` row for that car, edit its `items` JSON),
then:

```bash
npx tsx scripts/risk-checks/list-targets.ts --car <carId>
# The flipped key should now appear.
# ... run the skill's procedure for that one car ...
npx tsx scripts/risk-checks/list-targets.ts --car <carId>
# It should no longer appear (if confidently resolved) — or should still
# appear if the agent correctly left it pending (session expired, no match).
```

Re-run `npm run db:seed` afterward to wipe any test-only edits back to the
clean demo state. For a closer look at exactly what got written, read
`prisma/dev.db` with a SQLite browser (`npm run db:studio`).
