# Landed Cost Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Derive a realistic all-in `landedCostBRL` (frete to Florianópolis/SC + auction fees/buffers) and use it everywhere money is compared to FIPE or budget, while keeping `askingPriceBRL` as the source lance/list price.

**Architecture:** Pure functions under `src/lib/cost/` with table midpoints as constants. Scripts (`deal-economics`, alerts, top-picks) and app scoring (`goalFit`, `market`) import the same module. No DB persistence of landed cost in v1.

**Tech Stack:** TypeScript, Vitest, existing Next.js `@/` path alias, Prisma `Car` fields `city`/`state`/`dealPhase`/`askingPriceBRL`.

**Spec:** `docs/superpowers/specs/2026-07-24-landed-cost-model-design.md`

## Global Constraints

- Ranges → **midpoint** only for ranking math.
- `state === "SC"` → frete **R$ 0**.
- Frete resolve order: city table → UF capital → UF band → unknown assumed (never silent 0 for non-SC).
- Auction add-ons only when `dealPhase === "auction"`: 5% commission on lance, DETRAN **1200**, pós-arremate buffer **1700**.
- Market/repasse: frete only (when out of SC); no commission/DETRAN/buffer.
- `baseCashBRL = askingPriceBRL` for all phases (no re-adding repasse debt).
- Do **not** persist `landedCostBRL` on `Car`; no DSAL/pátio/dedicated frete/pneus/estética in v1.
- Buyer base: Florianópolis/SC (hardcoded).
- TDD: failing test first; commit after each task.

---

## File map

| File | Responsibility |
|---|---|
| `src/lib/cost/freight.ts` | Origin midpoints, UF→capital, UF bands, `resolveFreightBRL` |
| `src/lib/cost/auctionFees.ts` | Commission rate, DETRAN mid, pós-arremate buffer constants + helpers |
| `src/lib/cost/landedCost.ts` | `computeLandedCost` → `LandedCostResult` |
| `src/lib/cost/__tests__/freight.test.ts` | Frete resolve cases |
| `src/lib/cost/__tests__/landedCost.test.ts` | Stacks, midpoints, golden Goiânia auction, repasse no double-count |
| `scripts/ingestion/lib/deal-economics.ts` | Extend `DealCar` with `city`/`state`; `totalCostBRL` → landed |
| `scripts/ingestion/__tests__/deal-economics.test.ts` | Update totalCost expectations |
| `scripts/ingestion/deal-alert.ts` | Pass `city`/`state` into DealCar (already on Prisma rows) |
| `scripts/ingestion/lib/top-picks.ts` | Uses `totalCostBRL` — inherits landed once wrapper is fixed (**rebase if file missing**) |
| `src/lib/scoring/goalFit.ts` | Budget criterion uses landed |
| `src/lib/scoring/market.ts` | Premium vs FIPE uses landed; expose `landedCostBRL` on assessment |
| `src/lib/types.ts` | Add `landedCostBRL` to `MarketAssessment` |
| `src/lib/scoring/__tests__/goalFit.test.ts` | Budget uses landed (distant auction fails when ask alone would pass) |
| `src/lib/scoring/__tests__/market.test.ts` | Premium uses landed |
| `src/app/cars/[id]/page.tsx` | Secondary “custo all-in” under headline ask |
| `src/components/cars/cars-table-view.tsx` | FIPE delta % uses landed when computing discount |

---

### Task 0: Branch base check (top-picks)

**Files:** none (git only)

- [ ] **Step 1: Confirm `top-picks` is on this branch**

Run:

```bash
test -f scripts/ingestion/lib/top-picks.ts && echo HAS_TOP_PICKS || echo MISSING_TOP_PICKS
```

If `MISSING_TOP_PICKS`: rebase/merge the feature branch that added top-picks (or cherry-pick those commits) onto `docs/landed-cost-model` **before Task 5**. Do not invent a new top-picks module in this plan.

- [ ] **Step 2: Commit only if you merged/rebased** (otherwise skip commit)

```bash
git status -sb
# if merge/rebase produced commits, leave them as-is; no empty commit
```

---

### Task 1: Frete resolve module

**Files:**
- Create: `src/lib/cost/freight.ts`
- Create: `src/lib/cost/__tests__/freight.test.ts`

**Interfaces:**
- Produces:
  - `export type FreteSource = "local" | "city" | "uf_capital" | "uf_band" | "unknown_assumed"`
  - `export type FreightResolve = { freteBRL: number; freteSource: FreteSource; notes: string[] }`
  - `export function resolveFreightBRL(city: string, state: string): FreightResolve`
  - `export function normalizePlace(s: string): string` (accents stripped, lowercased)
- Consumes: nothing

- [ ] **Step 1: Write failing tests**

Create `src/lib/cost/__tests__/freight.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { resolveFreightBRL } from "../freight";

describe("resolveFreightBRL", () => {
  it("returns 0 for any SC city (local)", () => {
    expect(resolveFreightBRL("Joinville", "SC")).toEqual({
      freteBRL: 0,
      freteSource: "local",
      notes: [],
    });
    expect(resolveFreightBRL("Florianópolis", "SC").freteBRL).toBe(0);
  });

  it("matches Tabela 1 city midpoints", () => {
    expect(resolveFreightBRL("São Paulo", "SP")).toMatchObject({
      freteBRL: 1098,
      freteSource: "city",
    });
    expect(resolveFreightBRL("Goiania", "GO")).toMatchObject({
      freteBRL: 2600,
      freteSource: "city",
    });
    expect(resolveFreightBRL("Curitiba", "PR").freteBRL).toBe(775);
  });

  it("falls back to UF capital for unknown city in known UF", () => {
    expect(resolveFreightBRL("Anápolis", "GO")).toMatchObject({
      freteBRL: 2600,
      freteSource: "uf_capital",
    });
  });

  it("uses UF band for UFs without a Tabela 1 capital", () => {
    expect(resolveFreightBRL("Vitória", "ES")).toMatchObject({
      freteBRL: 2200,
      freteSource: "uf_band",
    });
    expect(resolveFreightBRL("Fortaleza", "CE")).toMatchObject({
      freteBRL: 4150,
      freteSource: "uf_band",
    });
  });

  it("assumes long-haul frete for unknown state (never 0)", () => {
    const r = resolveFreightBRL("Unknown", "??");
    expect(r.freteBRL).toBe(4150);
    expect(r.freteSource).toBe("unknown_assumed");
    expect(r.notes).toContain("frete_assumed_unknown_origin");
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- src/lib/cost/__tests__/freight.test.ts`

Expected: FAIL — cannot resolve `../freight` / module not found.

- [ ] **Step 3: Implement `src/lib/cost/freight.ts`**

```typescript
export type FreteSource =
  | "local"
  | "city"
  | "uf_capital"
  | "uf_band"
  | "unknown_assumed";

export type FreightResolve = {
  freteBRL: number;
  freteSource: FreteSource;
  notes: string[];
};

/** Midpoints of Tabela 1 ranges (cegonha compartilhada → Florianópolis/SC). */
export const CITY_FREIGHT_MID_BRL: Record<string, number> = {
  goiania: 2600,
  brasilia: 2750,
  "sao paulo": 1098,
  "rio de janeiro": 1750,
  "belo horizonte": 1900,
  curitiba: 775,
  "porto alegre": 1000,
  salvador: 3850,
  recife: 4450,
  manaus: 6500,
};

/** UF → normalized capital name present in CITY_FREIGHT_MID_BRL. */
export const UF_CAPITAL: Record<string, string> = {
  GO: "goiania",
  DF: "brasilia",
  SP: "sao paulo",
  RJ: "rio de janeiro",
  MG: "belo horizonte",
  PR: "curitiba",
  RS: "porto alegre",
  BA: "salvador",
  PE: "recife",
  AM: "manaus",
};

/** Regra prática band midpoints for UFs without a capital row. */
export const FREIGHT_BAND_SHORT_BRL = 1250; // mid(900, 1600)
export const FREIGHT_BAND_MID_BRL = 2200; // mid(1600, 2800)
export const FREIGHT_BAND_LONG_BRL = 4150; // mid(2800, 5500)

/** UFs not in UF_CAPITAL → band (South short / SE-CO mid / N-NE long). */
export const UF_FREIGHT_BAND_BRL: Record<string, number> = {
  // Mid haul (SE / Centro-Oeste leftovers)
  ES: FREIGHT_BAND_MID_BRL,
  MT: FREIGHT_BAND_MID_BRL,
  MS: FREIGHT_BAND_MID_BRL,
  // Long haul (N / NE leftovers)
  AC: FREIGHT_BAND_LONG_BRL,
  AL: FREIGHT_BAND_LONG_BRL,
  AP: FREIGHT_BAND_LONG_BRL,
  CE: FREIGHT_BAND_LONG_BRL,
  MA: FREIGHT_BAND_LONG_BRL,
  PA: FREIGHT_BAND_LONG_BRL,
  PB: FREIGHT_BAND_LONG_BRL,
  PI: FREIGHT_BAND_LONG_BRL,
  RN: FREIGHT_BAND_LONG_BRL,
  RO: FREIGHT_BAND_LONG_BRL,
  RR: FREIGHT_BAND_LONG_BRL,
  SE: FREIGHT_BAND_LONG_BRL,
  TO: FREIGHT_BAND_LONG_BRL,
};

export function normalizePlace(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ");
}

export function resolveFreightBRL(city: string, state: string): FreightResolve {
  const uf = (state ?? "").trim().toUpperCase();
  if (uf === "SC") {
    return { freteBRL: 0, freteSource: "local", notes: [] };
  }

  const cityKey = normalizePlace(city ?? "");
  if (cityKey && CITY_FREIGHT_MID_BRL[cityKey] != null) {
    return {
      freteBRL: CITY_FREIGHT_MID_BRL[cityKey],
      freteSource: "city",
      notes: [],
    };
  }

  const capital = UF_CAPITAL[uf];
  if (capital != null && CITY_FREIGHT_MID_BRL[capital] != null) {
    return {
      freteBRL: CITY_FREIGHT_MID_BRL[capital],
      freteSource: "uf_capital",
      notes: [],
    };
  }

  const band = UF_FREIGHT_BAND_BRL[uf];
  if (band != null) {
    return { freteBRL: band, freteSource: "uf_band", notes: [] };
  }

  return {
    freteBRL: FREIGHT_BAND_LONG_BRL,
    freteSource: "unknown_assumed",
    notes: ["frete_assumed_unknown_origin"],
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- src/lib/cost/__tests__/freight.test.ts`

Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/lib/cost/freight.ts src/lib/cost/__tests__/freight.test.ts
git commit -m "$(cat <<'EOF'
feat(cost): add Florianópolis-bound frete midpoints resolve

Encode city/UF/band freight tables so non-SC origins never silently cost zero.
EOF
)"
```

---

### Task 2: Auction fees + `computeLandedCost`

**Files:**
- Create: `src/lib/cost/auctionFees.ts`
- Create: `src/lib/cost/landedCost.ts`
- Create: `src/lib/cost/__tests__/landedCost.test.ts`

**Interfaces:**
- Consumes: `resolveFreightBRL` from `./freight`
- Produces:
  - `export const AUCTION_COMMISSION_RATE = 0.05`
  - `export const DETRAN_TRANSFER_SC_MID_BRL = 1200`
  - `export const POST_ARREMATE_BUFFER_BRL = 1700`
  - `export type LandedCostInput = { askingPriceBRL: number; dealPhase?: string | null; city: string; state: string }`
  - `export type LandedCostResult = { landedCostBRL: number | null; baseCashBRL: number | null; components: {...}; meta: {...} }`
  - `export function computeLandedCost(input: LandedCostInput): LandedCostResult`

- [ ] **Step 1: Write failing tests**

Create `src/lib/cost/__tests__/landedCost.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { computeLandedCost } from "../landedCost";
import {
  AUCTION_COMMISSION_RATE,
  DETRAN_TRANSFER_SC_MID_BRL,
  POST_ARREMATE_BUFFER_BRL,
} from "../auctionFees";

describe("computeLandedCost", () => {
  it("returns null when ask is missing or non-positive", () => {
    expect(computeLandedCost({ askingPriceBRL: 0, city: "SP", state: "SP", dealPhase: "market" }).landedCostBRL).toBeNull();
    expect(computeLandedCost({ askingPriceBRL: -1, city: "SP", state: "SP", dealPhase: "auction" }).landedCostBRL).toBeNull();
  });

  it("market out of SC: ask + frete only", () => {
    const r = computeLandedCost({
      askingPriceBRL: 100_000,
      dealPhase: "market",
      city: "São Paulo",
      state: "SP",
    });
    expect(r.baseCashBRL).toBe(100_000);
    expect(r.components.freteBRL).toBe(1098);
    expect(r.components.auctionCommissionBRL).toBe(0);
    expect(r.components.detranTransferBRL).toBe(0);
    expect(r.components.postArremateBufferBRL).toBe(0);
    expect(r.landedCostBRL).toBe(101_098);
  });

  it("auction in SC: fees + buffer, frete 0", () => {
    const lance = 50_000;
    const r = computeLandedCost({
      askingPriceBRL: lance,
      dealPhase: "auction",
      city: "Florianópolis",
      state: "SC",
    });
    expect(r.components.freteBRL).toBe(0);
    expect(r.components.auctionCommissionBRL).toBe(lance * AUCTION_COMMISSION_RATE);
    expect(r.components.detranTransferBRL).toBe(DETRAN_TRANSFER_SC_MID_BRL);
    expect(r.components.postArremateBufferBRL).toBe(POST_ARREMATE_BUFFER_BRL);
    expect(r.landedCostBRL).toBe(lance + 2500 + 1200 + 1700);
  });

  it("golden: Goiânia auction all-in", () => {
    const lance = 33_000;
    const r = computeLandedCost({
      askingPriceBRL: lance,
      dealPhase: "auction",
      city: "Goiânia",
      state: "GO",
    });
    // frete 2600 + 5%*33000=1650 + DETRAN 1200 + buffer 1700
    expect(r.landedCostBRL).toBe(33_000 + 2600 + 1650 + 1200 + 1700);
    expect(r.meta.freteSource).toBe("city");
  });

  it("repasse: base is asking only (no debt double-count) + frete if out of SC", () => {
    const r = computeLandedCost({
      askingPriceBRL: 90_000, // already entry+saldo per write-lead
      dealPhase: "pre_repossession",
      city: "Brasília",
      state: "DF",
    });
    expect(r.baseCashBRL).toBe(90_000);
    expect(r.components.freteBRL).toBe(2750);
    expect(r.components.auctionCommissionBRL).toBe(0);
    expect(r.landedCostBRL).toBe(92_750);
  });

  it("defaults undefined dealPhase to auction (legacy)", () => {
    const r = computeLandedCost({
      askingPriceBRL: 10_000,
      city: "Curitiba",
      state: "PR",
    });
    expect(r.components.auctionCommissionBRL).toBe(500);
    expect(r.landedCostBRL).toBe(10_000 + 775 + 500 + 1200 + 1700);
  });
});
```

- [ ] **Step 2: Run test — expect FAIL**

Run: `npm test -- src/lib/cost/__tests__/landedCost.test.ts`

Expected: FAIL — module not found.

- [ ] **Step 3: Implement fees + landed cost**

`src/lib/cost/auctionFees.ts`:

```typescript
/** Copart-style leiloeiro commission (fixed %). */
export const AUCTION_COMMISSION_RATE = 0.05;

/** Mid of DETRAN SC transfer range 600–1800. */
export const DETRAN_TRANSFER_SC_MID_BRL = 1200;

/**
 * Vistoria cautelar mid 400 + revisão mid 800 + bateria mid 500.
 * Pneus/estética excluded until condition signals exist.
 */
export const POST_ARREMATE_BUFFER_BRL = 1700;

export function auctionCommissionBRL(lanceBRL: number): number {
  return lanceBRL * AUCTION_COMMISSION_RATE;
}
```

`src/lib/cost/landedCost.ts`:

```typescript
import { auctionCommissionBRL, DETRAN_TRANSFER_SC_MID_BRL, POST_ARREMATE_BUFFER_BRL } from "./auctionFees";
import { resolveFreightBRL, type FreteSource } from "./freight";

export type LandedCostInput = {
  askingPriceBRL: number;
  dealPhase?: string | null;
  city: string;
  state: string;
};

export type LandedCostResult = {
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

export function computeLandedCost(input: LandedCostInput): LandedCostResult {
  const ask = input.askingPriceBRL;
  const freight = resolveFreightBRL(input.city, input.state);

  if (ask == null || !Number.isFinite(ask) || ask <= 0) {
    return {
      landedCostBRL: null,
      baseCashBRL: null,
      components: {
        freteBRL: freight.freteBRL,
        auctionCommissionBRL: 0,
        detranTransferBRL: 0,
        postArremateBufferBRL: 0,
      },
      meta: { freteSource: freight.freteSource, notes: [...freight.notes] },
    };
  }

  // Legacy rows omit dealPhase — treat as auction (matches Car type docs).
  const phase = input.dealPhase ?? "auction";
  const isAuction = phase === "auction";

  const commission = isAuction ? auctionCommissionBRL(ask) : 0;
  const detran = isAuction ? DETRAN_TRANSFER_SC_MID_BRL : 0;
  const buffer = isAuction ? POST_ARREMATE_BUFFER_BRL : 0;

  const landed = ask + freight.freteBRL + commission + detran + buffer;

  return {
    landedCostBRL: landed,
    baseCashBRL: ask,
    components: {
      freteBRL: freight.freteBRL,
      auctionCommissionBRL: commission,
      detranTransferBRL: detran,
      postArremateBufferBRL: buffer,
    },
    meta: { freteSource: freight.freteSource, notes: [...freight.notes] },
  };
}
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `npm test -- src/lib/cost/__tests__/landedCost.test.ts`

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/lib/cost/auctionFees.ts src/lib/cost/landedCost.ts src/lib/cost/__tests__/landedCost.test.ts
git commit -m "$(cat <<'EOF'
feat(cost): compute landed cost with auction fee stack

Add commission, DETRAN, and pós-arremate buffer midpoints on top of frete.
EOF
)"
```

---

### Task 3: Wire `deal-economics.totalCostBRL` → landed

**Files:**
- Modify: `scripts/ingestion/lib/deal-economics.ts`
- Modify: `scripts/ingestion/__tests__/deal-economics.test.ts`
- Modify: `scripts/ingestion/deal-alert.ts` (ensure city/state flow; Prisma already returns them)

**Interfaces:**
- Consumes: `computeLandedCost` from `@/lib/cost/landedCost`
- Produces: `DealCar` gains `city: string; state: string`; `totalCostBRL(car)` returns landed (or null)

- [ ] **Step 1: Rewrite failing `totalCostBRL` tests**

Replace the `totalCostBRL` describe block in `scripts/ingestion/__tests__/deal-economics.test.ts` with:

```typescript
const base: DealCar = {
  model: "TAOS CL TSI",
  trim: "",
  sourceUrl: "https://example.com/lot/1",
  year: 2023,
  dealPhase: "auction",
  askingPriceBRL: 33000,
  installmentBRL: null,
  installmentsRemaining: null,
  outstandingDebtBRL: null,
  fipeValueBRL: 129133,
  city: "Goiânia",
  state: "GO",
};

describe("totalCostBRL (landed)", () => {
  it("returns landed cost for auction cars (frete + fees)", () => {
    // 33000 + 2600 + 1650 + 1200 + 1700
    expect(totalCostBRL(base)).toBe(40150);
  });

  it("does not re-add installments for repasse (ask is already effective cost)", () => {
    const c = {
      ...base,
      dealPhase: "pre_repossession",
      askingPriceBRL: 65000,
      installmentBRL: 1000,
      installmentsRemaining: 66,
      city: "Florianópolis",
      state: "SC",
    };
    expect(totalCostBRL(c)).toBe(65000);
  });

  it("adds frete only for repasse outside SC", () => {
    const c = {
      ...base,
      dealPhase: "pre_repossession",
      askingPriceBRL: 65000,
      installmentBRL: 1000,
      installmentsRemaining: 66,
      city: "Brasília",
      state: "DF",
    };
    expect(totalCostBRL(c)).toBe(65000 + 2750);
  });

  it("still prices repasse when debt fields are null (ask-only)", () => {
    const unknown = {
      ...base,
      dealPhase: "pre_repossession",
      city: "Florianópolis",
      state: "SC",
    };
    expect(totalCostBRL(unknown)).toBe(33000);
  });
});
```

Keep `isSpecialDeal` tests, but update any that assumed bare ask: the Taos at 33000 GO auction is still ≤60% of 129133 after landed (40150/129133 ≈ 31%) — should still pass. Add city/state to `base` for all tests.

- [ ] **Step 2: Run tests — expect FAIL**

Run: `npm test -- scripts/ingestion/__tests__/deal-economics.test.ts`

Expected: FAIL — `city`/`state` missing on type and/or old totals.

- [ ] **Step 3: Implement wrapper**

In `scripts/ingestion/lib/deal-economics.ts`:

```typescript
import { computeLandedCost } from "@/lib/cost/landedCost";

export interface DealCar {
  model: string;
  trim: string;
  sourceUrl: string;
  year: number;
  dealPhase: string;
  askingPriceBRL: number;
  installmentBRL: number | null;
  installmentsRemaining: number | null;
  outstandingDebtBRL: number | null;
  fipeValueBRL: number | null;
  city: string;
  state: string;
}

// ... keep TARGET_MODEL_RE, SPECIAL_DEAL_*, MIN_YEAR, isSpecialDeal ...

export function totalCostBRL(car: DealCar): number | null {
  return computeLandedCost({
    askingPriceBRL: car.askingPriceBRL,
    dealPhase: car.dealPhase,
    city: car.city,
    state: car.state,
  }).landedCostBRL;
}
```

`deal-alert.ts`: Prisma `findMany` already returns `city`/`state`. No mapping change needed if cars are spread into `buildAlertReport` — confirm `DealCar & { brand }` still type-checks. If TypeScript complains about missing fields on fixtures in `deal-alert.test.ts`, add `city`/`state` there too.

- [ ] **Step 4: Run tests — expect PASS**

Run:

```bash
npm test -- scripts/ingestion/__tests__/deal-economics.test.ts scripts/ingestion/__tests__/deal-alert.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add scripts/ingestion/lib/deal-economics.ts scripts/ingestion/__tests__/deal-economics.test.ts scripts/ingestion/deal-alert.ts scripts/ingestion/__tests__/deal-alert.test.ts
git commit -m "$(cat <<'EOF'
fix(economics): use landed cost as totalCostBRL

Stop double-counting repasse debt and include frete/auction fees in alerts.
EOF
)"
```

---

### Task 4: Wire goalFit + market scoring

**Files:**
- Modify: `src/lib/scoring/goalFit.ts`
- Modify: `src/lib/scoring/market.ts`
- Modify: `src/lib/types.ts` (`MarketAssessment`)
- Modify: `src/lib/scoring/__tests__/goalFit.test.ts`
- Modify: `src/lib/scoring/__tests__/market.test.ts`

**Interfaces:**
- Consumes: `computeLandedCost` from `@/lib/cost/landedCost`
- Produces: budget/premium use `landedCostBRL`; `MarketAssessment.landedCostBRL: number | null`

- [ ] **Step 1: Write failing scoring tests**

Add to `goalFit.test.ts`:

```typescript
describe("computeGoalFit budget uses landed cost", () => {
  it("fails budget when landed (ask+frete+fees) exceeds soft max but ask alone would pass", () => {
    // soft max = 100000 * 1.05 = 105000
    // ask 100000 in GO auction → landed 100000+2600+5000+1200+1700 = 110500
    const match = computeGoalFit(
      baseCar({
        askingPriceBRL: 100_000,
        city: "Goiânia",
        state: "GO",
        dealPhase: "auction",
      }),
      baseGoal(),
    );
    expect(match.failedCriteria.some((c) => c.startsWith("Budget"))).toBe(true);
  });

  it("passes budget for same ask in SC market (frete 0, no auction fees)", () => {
    const match = computeGoalFit(
      baseCar({
        askingPriceBRL: 100_000,
        city: "Florianópolis",
        state: "SC",
        dealPhase: "market",
      }),
      baseGoal(),
    );
    expect(match.matchedCriteria.some((c) => c.startsWith("Budget"))).toBe(true);
  });
});
```

Add to `market.test.ts`:

```typescript
  it("premium uses landed cost (distant auction looks worse than ask alone)", () => {
    const m = computeMarketAssessment(
      car({ askingPriceBRL: 100000, city: "Goiânia", state: "GO", dealPhase: "auction" }),
      100000,
    );
    // landed > FIPE → positive premium / overpriced
    expect(m.landedCostBRL).toBeGreaterThan(100000);
    expect(m.premiumOverFairPct).toBeGreaterThan(0);
    expect(m.verdict).toBe("overpriced");
    expect(m.askingPriceBRL).toBe(100000); // source ask unchanged
  });

  it("SC market near FIPE stays fair on landed", () => {
    const m = computeMarketAssessment(
      car({ askingPriceBRL: 102000, city: "Florianópolis", state: "SC", dealPhase: "market" }),
      100000,
    );
    expect(m.landedCostBRL).toBe(102000);
    expect(m.verdict).toBe("fair");
  });
```

Update existing market tests that assume premium from ask: for default fixture `city: "SP", state: "SP"` without `dealPhase`, legacy defaults to **auction**, so 100000 ask becomes landed with frete+fees — adjust fixtures to `dealPhase: "market"` and `state: "SC"` where the old ask-only behavior is intended, **or** update expected premiums to landed math. Prefer setting `dealPhase: "market", state: "SC"` on the shared `car()` helper defaults so existing under/over/fair cases stay ask≈landed.

- [ ] **Step 2: Run tests — expect FAIL**

Run:

```bash
npm test -- src/lib/scoring/__tests__/goalFit.test.ts src/lib/scoring/__tests__/market.test.ts
```

Expected: FAIL — budget still on ask / no `landedCostBRL` on assessment.

- [ ] **Step 3: Implement wiring**

In `goalFit.ts`, import and use landed for the budget criterion:

```typescript
import { computeLandedCost } from "@/lib/cost/landedCost";

// inside computeGoalFit, replace budget `ok`:
const landed = computeLandedCost({
  askingPriceBRL: car.askingPriceBRL,
  dealPhase: car.dealPhase,
  city: car.city,
  state: car.state,
}).landedCostBRL;

const criteria: { label: string; ok: boolean }[] = [
  {
    label: `Budget ${formatRange(goal.budgetMinBRL, goal.budgetMaxBRL)}`,
    ok:
      landed != null &&
      landed >= goal.budgetMinBRL &&
      landed <= goal.budgetMaxBRL * 1.05,
  },
  // ...unchanged
];
```

In `types.ts` `MarketAssessment`, add:

```typescript
landedCostBRL: number | null;
```

In `market.ts`:

```typescript
import { computeLandedCost } from "@/lib/cost/landedCost";

export function computeMarketAssessment(car: Car, fipe: number | null): MarketAssessment {
  const { ease, time } = resale(car);
  const landed = computeLandedCost({
    askingPriceBRL: car.askingPriceBRL,
    dealPhase: car.dealPhase,
    city: car.city,
    state: car.state,
  }).landedCostBRL;

  const base = {
    carId: car.id,
    askingPriceBRL: car.askingPriceBRL,
    landedCostBRL: landed,
    fipeValueBRL: fipe,
    resaleEase: ease,
    resaleTimeBucket: time,
  };

  if (fipe === null || fipe <= 0 || landed == null) {
    return {
      ...base,
      fairMarketMinBRL: null,
      fairMarketMaxBRL: null,
      premiumOverFairPct: null,
      verdict: "unavailable",
    };
  }

  const premium = ((landed - fipe) / fipe) * 100;
  const verdict =
    premium < -FAIR_BAND * 100
      ? "under_market"
      : premium > FAIR_BAND * 100
        ? "overpriced"
        : "fair";

  return {
    ...base,
    fairMarketMinBRL: Math.round(fipe * (1 - FAIR_BAND)),
    fairMarketMaxBRL: Math.round(fipe * (1 + FAIR_BAND)),
    premiumOverFairPct: Math.round(premium * 10) / 10,
    verdict,
  };
}
```

Fix any compile breaks in tests that construct `MarketAssessment` literals (if any).

- [ ] **Step 4: Run related tests — expect PASS**

Run:

```bash
npm test -- src/lib/scoring/__tests__/goalFit.test.ts src/lib/scoring/__tests__/market.test.ts src/lib/scoring/__tests__/decision.test.ts src/lib/scoring/__tests__/null-fields.test.ts
```

Expected: PASS. Fix decision/null-fields fixtures the same way (`dealPhase: "market", state: "SC"`) if they assert ask-based premiums.

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoring/goalFit.ts src/lib/scoring/market.ts src/lib/types.ts \
  src/lib/scoring/__tests__/goalFit.test.ts src/lib/scoring/__tests__/market.test.ts \
  src/lib/scoring/__tests__/decision.test.ts src/lib/scoring/__tests__/null-fields.test.ts
git commit -m "$(cat <<'EOF'
feat(scoring): compare budget and FIPE premium to landed cost

Distant auctions no longer look in-budget or under-FIPE on lance alone.
EOF
)"
```

---

### Task 5: Top-picks inherits landed (verify)

**Files:**
- Modify only if needed: `scripts/ingestion/lib/top-picks.ts`, `scripts/ingestion/__tests__/top-picks.test.ts`
- Requires Task 0 file present

**Interfaces:**
- Consumes: `totalCostBRL` (already) — must pass `city`/`state` on `TopPicksCar` / `DealCar`

- [ ] **Step 1: Extend TopPicksCar / fixtures with city/state if missing**

If `TopPicksCar` extends or mirrors `DealCar`, ensure `city` and `state` are required and populated from Prisma in the top-picks runner. Add a regression test:

```typescript
it("ranks using landed cash (GO auction costs more than SC market at same ask)", () => {
  const goal = /* existing goal fixture */;
  const goAuction = {
    /* ...minimal TopPicksCar */,
    askingPriceBRL: 80_000,
    dealPhase: "auction",
    city: "Goiânia",
    state: "GO",
    fipeValueBRL: 150_000,
  };
  const scMarket = {
    ...goAuction,
    id: "sc",
    dealPhase: "market",
    city: "Florianópolis",
    state: "SC",
  };
  const a = toTopPick(goAuction, goal)!;
  const b = toTopPick(scMarket, goal)!;
  expect(a.cashCostBRL).toBeGreaterThan(b.cashCostBRL);
});
```

(Adapt field names to the real `TopPicksCar` shape in-repo.)

- [ ] **Step 2: Run — expect FAIL until city/state wired**

Run: `npm test -- scripts/ingestion/__tests__/top-picks.test.ts`

- [ ] **Step 3: Minimal fix** — add `city`/`state` on types + Prisma select/map; no formula changes (wrapper already landed).

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add scripts/ingestion/lib/top-picks.ts scripts/ingestion/__tests__/top-picks.test.ts
git commit -m "$(cat <<'EOF'
feat(top-picks): pass origin into landed totalCostBRL

Ensure shortlist cashCost includes frete and auction fees.
EOF
)"
```

---

### Task 6: Minimal UI — show all-in next to ask

**Files:**
- Modify: `src/app/cars/[id]/page.tsx`
- Modify: `src/components/cars/cars-table-view.tsx` (`fipeDeltaPct` helper)

**Interfaces:**
- Consumes: `computeLandedCost` from `@/lib/cost/landedCost`

- [ ] **Step 1: Detail header secondary line**

Under the existing `formatBRL(car.askingPriceBRL)` block in `src/app/cars/[id]/page.tsx`, compute landed and render when it differs from ask (or always for auction / out-of-SC):

```tsx
import { computeLandedCost } from "@/lib/cost/landedCost";

// near the price column:
const landed = computeLandedCost({
  askingPriceBRL: car.askingPriceBRL,
  dealPhase: car.dealPhase,
  city: car.city,
  state: car.state,
}).landedCostBRL;

// JSX under the ask label:
{landed != null && landed !== car.askingPriceBRL && (
  <div className="text-xs text-text-secondary tabular-nums">
    Custo all-in ≈ {formatBRL(landed)}
  </div>
)}
```

Keep the existing headline ask + phase label unchanged.

- [ ] **Step 2: Table FIPE delta uses landed**

In `cars-table-view.tsx`, change `fipeDeltaPct` to:

```typescript
import { computeLandedCost } from "@/lib/cost/landedCost";

function fipeDeltaPct(
  car: { askingPriceBRL: number; city: string; state: string; dealPhase?: string },
  fipeValueBRL: number | null | undefined,
): number | null {
  if (fipeValueBRL == null || fipeValueBRL <= 0) return null;
  const landed = computeLandedCost({
    askingPriceBRL: car.askingPriceBRL,
    dealPhase: car.dealPhase,
    city: car.city,
    state: car.state,
  }).landedCostBRL;
  if (landed == null) return null;
  return Math.round((1 - landed / fipeValueBRL) * 100);
}
```

Update call sites to pass `b.car` (or the needed fields) instead of bare `askingPriceBRL`.

- [ ] **Step 3: Smoke-check types**

Run: `npx tsc --noEmit` (or project’s usual typecheck if different)

Expected: no errors in touched files.

- [ ] **Step 4: Commit**

```bash
git add src/app/cars/\[id\]/page.tsx src/components/cars/cars-table-view.tsx
git commit -m "$(cat <<'EOF'
feat(ui): show all-in cost beside ask and in FIPE delta

Surface landed cost without replacing the source lance/list headline.
EOF
)"
```

---

### Task 7: Full regression pass

**Files:** none (verification)

- [ ] **Step 1: Run full unit suite**

Run: `npm test`

Expected: PASS (fix any fixture fallout from `DealCar.city/state` or `MarketAssessment.landedCostBRL` the same way as Task 4).

- [ ] **Step 2: Commit only if fixes were needed**

```bash
git add -u
git commit -m "$(cat <<'EOF'
test: align fixtures with landed-cost scoring

EOF
)"
```

---

## Spec coverage checklist

| Spec requirement | Task |
|---|---|
| Frete city → UF capital → band → unknown | Task 1 |
| SC frete = 0 | Task 1 |
| Midpoints Tabela 1 + bands | Task 1 |
| Auction 5% + DETRAN 1200 + buffer 1700 | Task 2 |
| Market/repasse frete-only | Task 2 |
| baseCash = asking (no debt double-count) | Task 2–3 |
| `totalCostBRL` / alerts / special deal | Task 3 |
| goalFit budget | Task 4 |
| market premium vs FIPE | Task 4 |
| top picks cashCost | Task 0 + 5 |
| UI secondary all-in | Task 6 |
| No DB persist / no DSAL / no dedicated frete | (out of scope — not implemented) |

## Self-review notes

- No TBD placeholders; UF band map is fully enumerated.
- `DealCar` / `TopPicksCar` must carry `city`/`state` or frete silently wrong — Tasks 3 and 5 enforce this.
- Legacy `dealPhase` undefined → auction (matches `Car` docs and Task 2 test).
)
