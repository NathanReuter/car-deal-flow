---
name: harvest-auction-leads
description: Harvests vehicle lots from Bradesco Vitrine and VIP Leilões (Financeiras) into Car Deal Flow as new_lead records, then soft-triages them with apply-goal-filter. Use when asked to "harvest auction leads", "ingest repossession cars", "pull Bradesco/VIP lots", or "run the auction harvest".
---

# Harvest Auction Leads

Pulls debt-driven / auction inventory from the two v1 public sources into
SQLite as bare `new_lead` cars, then runs the deterministic goal-fit filter.
Never guesses missing fields — skip the lot and log why.

## Sources (v1)

| Source | Browse | Prefer |
|---|---|---|
| Bradesco Vitrine — `https://vitrinebradesco.com.br` | Public, no login | Discover + call the underlying JSON API (inspect network). Prefer API over HTML. |
| VIP Leilões — `https://vipleiloes.com.br`, filter **Financeiras** | Requires the authenticated fetch flow below — lot detail is SPA-rendered and the domain sits behind Cloudflare bot detection that blocks a plain headless browser (verified: 403 without stealth, 200 with it) | `vip-leiloes-fetch.ts` per URL, see below |

Deferred for **this** skill (use dedicated skills instead):

| Source | Skill |
|---|---|
| BIDchain / Caixa white-label | `harvest-bidchain` |
| Leilões PB | `harvest-leiloes-pb` |
| MGL | `harvest-mgl` |

Cross-source dedup is handled by `write-lead` + `CarSource`. Bidding remains
out of scope (never automate login-to-bid or place lances).

### Goal-aware harvest

Before writing lots, print the active goal hint (optional but preferred):

```bash
./node_modules/.bin/tsx scripts/ingestion/goal-hint.ts
```

When listing year/price/brand clearly miss that goal, **skip and log** — do not
invent fields to force a fit. Soft triage still runs via `apply-goal-filter`
after writes. Safety ceiling: **1000 writes/source/run**.

### VIP Leilões authenticated fetch

Event listing pages (e.g. an event ID like `140726bspa`) are reachable, but
individual lot detail is client-rendered and Cloudflare-gated — a plain
headless browser gets blocked. Use the saved-session fetch flow instead of
browsing VIP Leilões directly:

1. **One-time setup (human-only, cannot be automated by the agent):** the
   owner runs `npx tsx scripts/ingestion/vip-leiloes-login.ts` in their own
   terminal. It opens a real visible browser window; they log in with their
   own free VIP Leilões account. The script never sees the password, only
   the resulting session, saved to
   `.claude/browser-profile/vip-leiloes-state.json` (gitignored).
2. **Per-URL fetch (agent-driven, this is the step you run):**
   ```bash
   npx tsx scripts/ingestion/vip-leiloes-fetch.ts "<url>" --out /tmp/vip-lot.html
   ```
   Then read `/tmp/vip-lot.html` to extract the lot's fields. This script
   does no interpretation — it's the deterministic I/O boundary; all
   judgment about what the HTML means happens after you read the file.
3. **If it fails with "session has expired" or "no saved session":** stop
   and tell the owner to re-run `vip-leiloes-login.ts` — do not attempt to
   log in yourself, and do not ask the owner for their password.

## Confidence rules

| Situation | Behavior |
|---|---|
| Missing brand/model/year/price/URL/bodyType | Skip — do not write |
| Body type ambiguous | Skip — do not default to SUV |
| Mileage not disclosed | Write `mileageKm: null` (script seeds mileage warning) |
| Ambiguous bank/Caixa attribution | `sellerType: auction` |
| Edital PDF vs page disagree | Prefer PDF; note discrepancy in `--notes` |
| FIPE unknown | Leave null (write-lead never stores 0) |
| Same `sourceUrl` again | Update via write-lead (does not clobber researching+) |

## Procedure

1. For **Bradesco Vitrine**: open the vehicle catalog, inspect network for the
   JSON API, fetch lots from the API. Map minimum bid → price.
2. For **VIP Leilões**: use `vip-leiloes-fetch.ts` (see the authenticated
   fetch section above) to pull the Financeiras event listing page, then
   each lot's detail page. If an edital PDF is linked, fetch and read it for
   chassis/plate/min bid when page text is thin. If PDF text is unreadable,
   continue with page fields only.
3. For each confident lot, write:

```bash
npx tsx scripts/ingestion/write-lead.ts \
  --brand "<brand>" \
  --model "<model>" \
  --year <year> \
  --price <minimumBidBRL> \
  --source-url "<canonicalLotUrl>" \
  --source-platform "Bradesco Vitrine" \
  --seller-type <auction|bank_recovery|caixa_recovery> \
  --body-type <hatch|sedan|suv|pickup|minivan|coupe|wagon> \
  [--trim "<trim>"] \
  [--mileage <km|null>] \
  [--city "<city>"] \
  [--state "<UF>"] \
  [--plate "<plate>"] \
  [--chassis "<chassis>"] \
  [--edital-url "<pdfUrl>"] \
  [--notes "<extra notes>"]
```

Use `--source-platform "VIP Leilões"` for VIP lots. Use
`--seller-type caixa_recovery` only when Caixa is explicitly attributed;
`--seller-type bank_recovery` for a named bank; otherwise `auction`.

4. After both sources:

```bash
npx tsx scripts/ingestion/apply-goal-filter.ts [--min-goal-fit 50]
```

5. Report a summary: lots found per source, written, skipped (with reasons),
   kept `new_lead`, moved to `parked`, hard-`rejected` (exclusions only).

## Notes

- `askingPriceBRL` is the **lance mínimo**; write-lead stamps that semantics
  into notes automatically.
- Soft triage: below threshold → `parked` (still visible); exclusion →
  `rejected`. Owner promotes `new_lead` → `researching` manually.
- Do not bid or register interest on behalf of the owner.
