# Landed cost model (frete + auction fees)

Date: 2026-07-24

## Problem

Deal economics today treat cash cost as the listing/lance price (plus a
separate, inconsistent repasse path). Cars outside Santa Catarina and cars from
leilão therefore look cheaper than they are in Florianópolis:

- `city` / `state` are stored on every car but never enter cost math.
- Auction commission, DETRAN transfer, and pós-arremate buffers are not
  quantified.
- `totalCostBRL` (scripts) and UI scoring (`goalFit`, `market`) disagree on what
  “money” means; repasse can double-count quitação vs `write-lead.resolvePricing`.

Reference tables (cegonha compartilhada → Florianópolis/SC, vistoria/dedução,
taxas de leilão Copart) define realistic midpoints we can encode as constants.

## Decisions (locked)

| Decision | Choice |
|---|---|
| Where landed cost drives decisions | Everywhere money is compared to FIPE/budget: goal fit, market score, top picks, alerts |
| Range handling | Midpoint of each range |
| Cost stack | Auctions: lance + 5% comissão + frete (if not SC) + DETRAN SC mid + pós-arremate buffer. Market/repasse: frete only when out of SC (+ honest quitação for repasse) |
| DSAL / pátio / multas | Out of auto math unless a real per-lot number exists later |
| Frete resolution | City table → UF capital → UF band; never silent `0` for unknown non-SC |
| Local frete | `state === "SC"` → R$ 0 |
| Architecture | Pure function + config constants (Approach 1); do not persist landed cost on the car in v1 |
| Buyer base | Florianópolis/SC, hardcoded config for v1 |
| Source price | Keep `askingPriceBRL` as lance/list; landed is derived |

## Design

### 1. Shared module

Add `src/lib/cost/` (app + scripts import the same code):

- `freight.ts` — origin tables, UF map, band fallbacks, `resolveFreightBRL(city, state)`
- `auctionFees.ts` — commission rate, DETRAN mid, pós-arremate buffer constants
- `landedCost.ts` — `computeLandedCost(input) → LandedCostResult`
- `__tests__/` — unit coverage for resolve + stacks + golden example

No Prisma migration. No admin UI for tables in v1.

### 2. Formula

```
landedCostBRL = baseCashBRL
  + freteBRL
  + auctionCommissionBRL
  + detranTransferBRL
  + postArremateBufferBRL
```

**Base cash**

| `dealPhase` | `baseCashBRL` |
|---|---|
| `auction` / `market` | `askingPriceBRL` (lance / list) |
| `pre_repossession` | Honest quitação once — see §4 (no double-count) |

If ask is missing/`null`/non-positive → `landedCostBRL = null` (unpriced).

**Add-ons**

| Component | When applied | Midpoint rule |
|---|---|---|
| Frete (cegonha compartilhada) | `state !== "SC"` | From frete resolve (§3) |
| Comissão leiloeiro | `dealPhase === "auction"` | `0.05 * lance` |
| DETRAN destino SC | auction only | mid(600, 1800) = **1200** |
| Pós-arremate buffer | auction only | vistoria mid 400 + revisão mid 800 + bateria mid 500 = **1700** |

Pneus/alinhamento and reparo estético are **not** in the v1 buffer (need condition
signals later). Dedicated/exclusive frete (+40–80%) is out of scope.

### 3. Frete resolve

Buyer destination: Florianópolis/SC.

1. If `state === "SC"` → `0`, `freteSource = local`
2. Normalize city (lowercase, strip accents) and match Tabela 1 → midpoint,
   `freteSource = city`
3. Else map UF → capital present in Tabela 1 → that midpoint,
   `freteSource = uf_capital`
4. Else coarse UF band midpoints derived from the same reference bands
   (short / mid / long haul), `freteSource = uf_band`
5. If state is `??` / empty / unknown → long-haul conservative midpoint +
   note `frete_assumed_unknown_origin`, `freteSource = unknown_assumed`
   (never treat as local)

**Tabela 1 midpoints (shared cegonha → Floripa)** — encode as constants:

| Origem | Range (R$) | Midpoint |
|---|---:|---:|
| Goiânia/GO | 2000–3200 | 2600 |
| Brasília/DF | 2100–3400 | 2750 |
| São Paulo/SP | 735–1460 | 1098 |
| Rio de Janeiro/RJ | 1200–2300 | 1750 |
| Belo Horizonte/MG | 1300–2500 | 1900 |
| Curitiba/PR | 650–900 | 775 |
| Porto Alegre/RS | 800–1200 | 1000 |
| Salvador/BA | 2700–5000 | 3850 |
| Recife/PE | 3200–5700 | 4450 |
| Manaus/AM | 4500–8500 | 6500 |

Regra prática bands (fallback when no city/UF capital hit): use midpoints of
≤500 km → mid(900,1600)=1250; 800–1200 km → mid(1600,2800)=2200; >2000 km →
mid(2800,5500)=4150. Map remaining UFs into these three bands by geography
(South short, SE/CO mid, N/NE long) in code comments + constants.

### 4. Repasse base-cash fix (prerequisite)

Today `write-lead.resolvePricing` often stores `askingPriceBRL = entry + debt`
(effective quitação), while `totalCostBRL` sometimes adds debt/parcelas again.

**Locked rule for v1:**

- `baseCashBRL` for **all** phases (including `pre_repossession`) =
  `askingPriceBRL`.
- Do **not** re-add `outstandingDebtBRL` or `installmentBRL *
  installmentsRemaining` on top of ask.
- `write-lead.resolvePricing` remains responsible for writing effective cost into
  `askingPriceBRL` when saldo is known (entrada + debt). When saldo is unknown,
  ask stays entrada-only and the car remains underpriced with existing “needs
  research” notes — frete still applies if out of SC.
- `totalCostBRL` becomes a thin wrapper around `computeLandedCost(...).landedCostBRL`
  (or call sites switch directly). Update any tests that assumed entry-only ask +
  external debt add.

### 5. Result shape

```ts
type FreteSource =
  | "local"
  | "city"
  | "uf_capital"
  | "uf_band"
  | "unknown_assumed";

type LandedCostResult = {
  landedCostBRL: number | null;
  baseCashBRL: number | null;
  components: {
    freteBRL: number;
    auctionCommissionBRL: number;
    detranTransferBRL: number;
    postArremateBufferBRL: number;
  };
  meta: {
    freteSource: FreteSource;
    notes: string[];
  };
};
```

Non-auction phases zero out commission / DETRAN / buffer. Local SC zeros frete.

### 6. Consumer wiring

| Consumer | Change |
|---|---|
| `goalFit` budget gate | Compare `landedCostBRL` to `budgetMin` / `budgetMax × 1.05` |
| `market` premium vs FIPE | `(landed − FIPE) / FIPE` |
| Top picks / deal alerts | Use `landedCostBRL` as cash cost |
| Special deal ≤60% FIPE | Use `landedCostBRL` |
| Display | Keep lance/list as headline source price; secondary “custo all-in ≈ R$ X” (breakdown UI optional / not blocking) |

`CaixaReview.hiddenTransferCostsBRL` remains manual and **out** of the auto stack
in v1.

### 7. Edge cases

- Missing ask → unpriced (`null`)
- Auction in SC → fees + buffer, frete 0
- Market/repasse out of SC → frete only
- Unknown origin → assumed frete, never 0
- Dedicated frete, DSAL, pátio/dia, cancelamento/atraso → out of scope

### 8. Tests

- Frete: SC → 0; São Paulo city match; arbitrary GO city → Goiânia capital;
  unknown UF band; `??` → unknown_assumed
- Stacks: auction vs market same ask/city differ by commission+DETRAN+buffer
- Midpoint math for table rows and auction fixed mids
- Repasse: no double-count of quitação
- Golden: Goiânia auction with known lance → expected all-in

### 9. Out of scope (v1)

- Persisting `landedCostBRL` on `Car`
- Distance/Maps API
- DSAL, estadia, multas
- Frete dedicado multiplier
- Auto pneus / estética from photos
- Per-goal buyer base or editable fee admin UI

## Success criteria

1. A Goiânia auction and a Florianópolis market car with the same ask no longer
   rank as equal cash cost.
2. Goal fit / market / top picks / alerts all use the same `landedCostBRL`.
3. Changing table midpoints in one config file updates all consumers.
4. Repasse quitação is counted once.
)
