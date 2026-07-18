# UI Reconstruction Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruct the missing UI/data layer so Car Deal Flow surfaces harvested leads in the browser, and green the build/test/lint with CI.

**Architecture:** The DB→UI path is already designed in `src/lib/aggregate.ts` (`getAllBundles`/`getBundle` → `CarBundle`) and consumed by three existing client components. Every module they import is missing. We reconstruct each module **to the contracts already fixed in `src/lib/types.ts`** — pure scoring functions, a Prisma singleton, a live FIPE integration, two server actions, shadcn-style UI primitives over already-installed Radix, and two routes. Then we fix the undeclared test deps, add CI, and dedup the pipeline inference helpers.

**Tech Stack:** Next.js 16 (App Router, async route params), React 19, Prisma 7 + better-sqlite3, Tailwind v4, Radix UI, class-variance-authority, Vitest, tsx.

## Global Constraints

- **Next.js 16 App Router:** dynamic route params are async — type as `params: Promise<{ id: string }>` and `await params`. Server actions use `"use server"`. Verify any route/action API against `node_modules/next/dist/docs/01-app/` before writing (per `AGENTS.md`, this version differs from training data).
- **No new npm deps beyond declaring what's already imported** (`playwright`, `playwright-extra`, `puppeteer-extra-plugin-stealth`). FIPE uses global `fetch` — no dep.
- **Fail closed:** never store a guessed FIPE/price/year/bodyType. FIPE ambiguity → `FipeError` → value stays null.
- **Scores are 0–100 integers** unless the type says otherwise (`valueScore: number | null`).
- **Do not invent interfaces:** all shapes come from `src/lib/types.ts` and the three components' imports.
- **Commit after every task** with the message shown. If GPG signing hangs, append `--no-gpg-sign`.
- **Branch:** `ui-reconstruction` (already created).
- **Verify each task:** `npx vitest run <file>` for unit tasks; `npm run build` where noted.

---

## Contracts reference (do not re-derive)

Exact shapes the components require (verified against the component source):

```ts
// src/lib/actions/fipe-sync.ts
export type FipeSyncResult =
  | { ok: true; valueBRL: number; matchedModel: string; referenceMonth: string }
  | { ok: false; error: string };
export async function syncFipeValue(carId: string): Promise<FipeSyncResult>;

// src/lib/actions/pipeline.ts
export async function updateCarStage(carId: string, stage: PipelineStage): Promise<void>;

// src/lib/integrations/fipe.ts
export interface FipeMatch { valueBRL: number; matchedModel: string; referenceMonth: string }
export class FipeError extends Error {}
export async function findFipeValue(
  input: { brand: string; model: string; year: number; modelYear?: number },
): Promise<FipeMatch>;

// src/lib/scoring/*
export function computeRiskScore(items: RiskCheckItem[]): number;         // risk.ts
export function computeConditionScore(fields: ConditionField[]): number;  // condition.ts
export function computeMarketAssessment(car: Car, fipe: number | null): MarketAssessment; // market.ts
export function computeDecision(car: Car, goal: BuyingGoal, risk: RiskCheck, condition: ConditionReview): DecisionResult; // decision.ts

// src/lib/format.ts
export function formatBRL(v: number): string;
export function formatKm(v: number | null): string;
export function formatDate(iso: string): string;
export function formatFipe(v: number | null): string;
export function formatPct(v: number, opts?: { signed?: boolean }): string;

// src/lib/db.ts
export const prisma: PrismaClient;

// src/lib/utils.ts
export function cn(...inputs: ClassValue[]): string;
```

UI primitives (exact export names required by components):
- `ui/card.tsx`: `Card, CardContent, CardHeader, CardTitle`
- `ui/badge.tsx`: `Badge` — `variant`: `"success" | "warning" | "danger" | "neutral" | "outline"`
- `ui/button.tsx`: `Button` — `variant`: `"secondary"` (+ default), `size`: `"sm"` (+ default)
- `ui/input.tsx`: `Input`
- `ui/select.tsx`: `Select, SelectContent, SelectItem, SelectTrigger, SelectValue` (Radix, `value`/`onValueChange`)
- `ui/table.tsx`: `Table, THead, TBody, TR, TH, TD` (`TD` supports `colSpan`)
- `ui/tabs.tsx`: `Tabs, TabsList, TabsTrigger, TabsContent` (Radix, `defaultValue`)
- `domain/verdict-badge.tsx`: `VerdictBadge` — prop `{ verdict: Verdict }`
- `domain/check-status-badge.tsx`: `CheckStatusBadge` — prop `{ status: CheckStatus }`

CSS custom properties used directly by components (must exist in `globals.css`):
`--success`, `--danger`, `--warning`, `--success-bg`, `--danger-bg`, and theme tokens generating utilities `text-text-primary`, `text-text-secondary`, `text-text-muted`, `bg-surface`, `bg-surface-hover`, `border-border`, `text-accent`.

---

### Task 1: Infra utilities — db, cn, format

**Files:**
- Create: `src/lib/db.ts`, `src/lib/utils.ts`, `src/lib/format.ts`
- Test: `src/lib/__tests__/format.test.ts`

**Interfaces:**
- Produces: `prisma` (db.ts), `cn` (utils.ts), `formatBRL/formatKm/formatDate/formatFipe/formatPct` (format.ts).

- [ ] **Step 1: Write `src/lib/utils.ts`**

```ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
```

- [ ] **Step 2: Write `src/lib/db.ts`** (singleton; mirrors adapter wiring in `scripts/**`)

```ts
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";

const url = process.env.DATABASE_URL ?? "file:./prisma/dev.db";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient({ adapter: new PrismaBetterSqlite3({ url }) });

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
```

- [ ] **Step 3: Write the failing test** `src/lib/__tests__/format.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { formatBRL, formatKm, formatFipe, formatPct } from "@/lib/format";

describe("format", () => {
  it("formats BRL with no decimals", () => {
    expect(formatBRL(60000)).toMatch(/R\$\s?60\.000/);
  });
  it("formats km, em-dash on null", () => {
    expect(formatKm(90000)).toMatch(/90\.000\s?km/);
    expect(formatKm(null)).toBe("—");
  });
  it("formatFipe shows Not synced on null", () => {
    expect(formatFipe(null)).toBe("Not synced");
    expect(formatFipe(50000)).toMatch(/R\$\s?50\.000/);
  });
  it("formatPct signs positive when requested", () => {
    expect(formatPct(7.4, { signed: true })).toBe("+7.4%");
    expect(formatPct(-3, { signed: true })).toBe("-3.0%");
    expect(formatPct(7.4)).toBe("7.4%");
  });
});
```

Note: `@/` resolves in vitest via the tsconfig `paths`; if a test cannot resolve `@/`, add `resolve.alias` `{ "@": path.resolve(__dirname, "src") }` to `vitest.config.ts` (only if needed — existing `src/lib/__tests__/*` already import via relative paths, so prefer relative import `../format` to avoid config churn).

- [ ] **Step 4: Run test — expect FAIL** (module not found)

Run: `npx vitest run src/lib/__tests__/format.test.ts`

- [ ] **Step 5: Write `src/lib/format.ts`**

```ts
const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("pt-BR");

export function formatBRL(v: number): string {
  return BRL.format(v);
}

export function formatKm(v: number | null): string {
  if (v === null) return "—";
  return `${NUM.format(v)} km`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR");
}

export function formatFipe(v: number | null): string {
  return v === null ? "Not synced" : formatBRL(v);
}

export function formatPct(v: number, opts?: { signed?: boolean }): string {
  const sign = opts?.signed && v > 0 ? "+" : "";
  return `${sign}${v.toFixed(1)}%`;
}
```

If Step 3 used `@/lib/format`, keep it; else use relative import. Verify FAIL in Step 4 used the same import path.

- [ ] **Step 6: Run test — expect PASS**

Run: `npx vitest run src/lib/__tests__/format.test.ts`

- [ ] **Step 7: Commit**

```bash
git add src/lib/db.ts src/lib/utils.ts src/lib/format.ts src/lib/__tests__/format.test.ts
git commit -m "Add db singleton, cn, and pt-BR formatters"
```

---

### Task 2: Risk & condition scoring

**Files:**
- Create: `src/lib/scoring/risk.ts`, `src/lib/scoring/condition.ts`
- Test: `src/lib/scoring/__tests__/risk.test.ts`, `src/lib/scoring/__tests__/condition.test.ts`

**Interfaces:**
- Consumes: `RiskCheckItem`, `ConditionField` from `@/lib/types`.
- Produces: `computeRiskScore(items) => number`, `computeConditionScore(fields) => number`. Consumed by `aggregate.ts` and `decision.ts`.

- [ ] **Step 1: Write `src/lib/scoring/__tests__/risk.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { computeRiskScore } from "../risk";
import type { RiskCheckItem } from "@/lib/types";

const item = (o: Partial<RiskCheckItem>): RiskCheckItem => ({
  key: "recall_status", status: "verified", severity: "low", notes: "", ...o,
});

describe("computeRiskScore", () => {
  it("empty checklist scores 100", () => {
    expect(computeRiskScore([])).toBe(100);
  });
  it("all verified scores 100", () => {
    expect(computeRiskScore([item({}), item({ severity: "severe" })])).toBe(100);
  });
  it("a severe failed check floors the score", () => {
    expect(computeRiskScore([item({ status: "failed", severity: "severe" })])).toBeLessThanOrEqual(10);
  });
  it("pending costs less than failed at same severity", () => {
    const pending = computeRiskScore([item({ status: "pending", severity: "high" })]);
    const failed = computeRiskScore([item({ status: "failed", severity: "high" })]);
    expect(pending).toBeGreaterThan(failed);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/lib/scoring/__tests__/risk.test.ts`

- [ ] **Step 3: Write `src/lib/scoring/risk.ts`**

```ts
import type { RiskCheckItem, CheckSeverity, CheckStatus } from "@/lib/types";

const SEVERITY_WEIGHT: Record<CheckSeverity, number> = { low: 5, medium: 12, high: 25, severe: 45 };
const STATUS_MULTIPLIER: Record<CheckStatus, number> = { verified: 0, pending: 0.4, warning: 0.6, failed: 1 };

/** 0-100. Starts at 100; each unresolved item subtracts severity×status. A
 *  failed+severe item floors the score near zero. Empty checklist → 100. */
export function computeRiskScore(items: RiskCheckItem[]): number {
  let penalty = 0;
  let severeFailure = false;
  for (const it of items) {
    penalty += SEVERITY_WEIGHT[it.severity] * STATUS_MULTIPLIER[it.status];
    if (it.status === "failed" && it.severity === "severe") severeFailure = true;
  }
  let score = Math.max(0, Math.min(100, Math.round(100 - penalty)));
  if (severeFailure) score = Math.min(score, 10);
  return score;
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Write `src/lib/scoring/__tests__/condition.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { computeConditionScore } from "../condition";
import type { ConditionField } from "@/lib/types";

const f = (rating: ConditionField["rating"]): ConditionField => ({ key: "k", label: "L", rating, notes: "" });

describe("computeConditionScore", () => {
  it("no rated fields → 50", () => {
    expect(computeConditionScore([])).toBe(50);
    expect(computeConditionScore([f("not_inspected")])).toBe(50);
  });
  it("averages rated fields, ignoring not_inspected", () => {
    expect(computeConditionScore([f("good"), f("poor"), f("not_inspected")])).toBe(60);
  });
});
```

- [ ] **Step 6: Run — expect FAIL, then write `src/lib/scoring/condition.ts`**

```ts
import type { ConditionField, ConditionRating } from "@/lib/types";

const RATING_POINTS: Record<Exclude<ConditionRating, "not_inspected">, number> = { good: 100, fair: 60, poor: 20 };

/** 0-100 average over inspected fields. All-uninspected/empty → 50 (unknown). */
export function computeConditionScore(fields: ConditionField[]): number {
  const rated = fields.filter((f) => f.rating !== "not_inspected");
  if (rated.length === 0) return 50;
  const total = rated.reduce((s, f) => s + RATING_POINTS[f.rating as keyof typeof RATING_POINTS], 0);
  return Math.round(total / rated.length);
}
```

- [ ] **Step 7: Run both — expect PASS**

Run: `npx vitest run src/lib/scoring/__tests__/risk.test.ts src/lib/scoring/__tests__/condition.test.ts`

- [ ] **Step 8: Commit**

```bash
git add src/lib/scoring/risk.ts src/lib/scoring/condition.ts src/lib/scoring/__tests__/risk.test.ts src/lib/scoring/__tests__/condition.test.ts
git commit -m "Add risk and condition scoring functions"
```

---

### Task 3: Market assessment

**Files:**
- Create: `src/lib/scoring/market.ts`
- Test: `src/lib/scoring/__tests__/market.test.ts`

**Interfaces:**
- Consumes: `Car`, `MarketAssessment` from `@/lib/types`.
- Produces: `computeMarketAssessment(car, fipe: number | null) => MarketAssessment`. Consumed by `aggregate.ts` and `decision.ts`.

- [ ] **Step 1: Write `src/lib/scoring/__tests__/market.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { computeMarketAssessment } from "../market";
import type { Car } from "@/lib/types";

const car = (o: Partial<Car>): Car => ({
  id: "c1", brand: "Toyota", model: "Corolla", trim: "XEI", year: 2022, modelYear: 2022,
  mileageKm: 40000, askingPriceBRL: 100000, city: "SP", state: "SP", sellerType: "dealer",
  fuel: "flex", transmission: "automatic", bodyType: "sedan", color: "white",
  sourceUrl: "https://x", sourcePlatform: "OLX", notes: "", attachments: [], photos: [],
  pipelineStage: "new_lead", createdAt: "", updatedAt: "", fipeValueBRL: null, ...o,
});

describe("computeMarketAssessment", () => {
  it("null FIPE → unavailable with null ranges", () => {
    const m = computeMarketAssessment(car({}), null);
    expect(m.verdict).toBe("unavailable");
    expect(m.fairMarketMinBRL).toBeNull();
    expect(m.premiumOverFairPct).toBeNull();
  });
  it("asking well below FIPE → under_market, negative premium", () => {
    const m = computeMarketAssessment(car({ askingPriceBRL: 80000 }), 100000);
    expect(m.verdict).toBe("under_market");
    expect(m.premiumOverFairPct).toBeLessThan(0);
  });
  it("asking well above FIPE → overpriced", () => {
    const m = computeMarketAssessment(car({ askingPriceBRL: 120000 }), 100000);
    expect(m.verdict).toBe("overpriced");
  });
  it("asking near FIPE → fair", () => {
    const m = computeMarketAssessment(car({ askingPriceBRL: 102000 }), 100000);
    expect(m.verdict).toBe("fair");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Write `src/lib/scoring/market.ts`**

```ts
import type { Car, MarketAssessment, BodyType } from "@/lib/types";

const FAIR_BAND = 0.07; // ±7% of FIPE is "fair"

// Resale liquidity heuristic by body type (Brazilian used market).
const BODY_LIQUIDITY: Record<BodyType, "high" | "medium" | "low"> = {
  suv: "high", hatch: "high", sedan: "high", pickup: "medium", wagon: "low", minivan: "low", coupe: "low",
};

function resale(car: Car): { ease: "high" | "medium" | "low"; time: "fast" | "moderate" | "slow" } {
  const ease = BODY_LIQUIDITY[car.bodyType] ?? "medium";
  const time = ease === "high" ? "fast" : ease === "medium" ? "moderate" : "slow";
  return { ease, time };
}

export function computeMarketAssessment(car: Car, fipe: number | null): MarketAssessment {
  const { ease, time } = resale(car);
  const base = {
    carId: car.id,
    askingPriceBRL: car.askingPriceBRL,
    fipeValueBRL: fipe,
    resaleEase: ease,
    resaleTimeBucket: time,
  };

  if (fipe === null || fipe <= 0) {
    return { ...base, fairMarketMinBRL: null, fairMarketMaxBRL: null, premiumOverFairPct: null, verdict: "unavailable" };
  }

  const premium = ((car.askingPriceBRL - fipe) / fipe) * 100;
  const verdict = premium <= -FAIR_BAND * 100 ? "under_market" : premium > FAIR_BAND * 100 ? "overpriced" : "fair";

  return {
    ...base,
    fairMarketMinBRL: Math.round(fipe * (1 - FAIR_BAND)),
    fairMarketMaxBRL: Math.round(fipe * (1 + FAIR_BAND)),
    premiumOverFairPct: Math.round(premium * 10) / 10,
    verdict,
  };
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoring/market.ts src/lib/scoring/__tests__/market.test.ts
git commit -m "Add market assessment scoring"
```

---

### Task 4: FIPE integration (live public API) + fix ingest-real-cars build

**Files:**
- Create: `src/lib/integrations/fipe.ts`
- Test: `src/lib/integrations/__tests__/fipe.test.ts`
- Verify (no change expected): `scripts/ingest-real-cars.ts` compiles (it already imports `findFipeValue`, `FipeError` and uses `.valueBRL/.matchedModel/.referenceMonth`).

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `findFipeValue(input) => Promise<FipeMatch>`, `class FipeError`, `interface FipeMatch { valueBRL; matchedModel; referenceMonth }`. Consumed by `actions/fipe-sync.ts` and `scripts/ingest-real-cars.ts`.

- [ ] **Step 1: Write `src/lib/integrations/__tests__/fipe.test.ts`** (mock `fetch`)

```ts
import { describe, it, expect, vi, afterEach } from "vitest";
import { findFipeValue, FipeError } from "../fipe";

function mockFetchSequence(responses: unknown[]) {
  let i = 0;
  vi.stubGlobal("fetch", vi.fn(async () => {
    const body = responses[Math.min(i++, responses.length - 1)];
    return { ok: true, json: async () => body } as Response;
  }));
}

afterEach(() => vi.unstubAllGlobals());

describe("findFipeValue", () => {
  it("throws FipeError when the brand cannot be matched", async () => {
    mockFetchSequence([[{ codigo: "1", nome: "Fiat" }]]); // brand list without the target
    await expect(findFipeValue({ brand: "Lamborghini", model: "Aventador", year: 2022 }))
      .rejects.toBeInstanceOf(FipeError);
  });

  it("returns a match when brand→model→year resolve", async () => {
    mockFetchSequence([
      [{ codigo: "59", nome: "VW - VolksWagen" }],               // brands
      { modelos: [{ codigo: "5940", nome: "T-Cross Highline TSI" }], anos: [] }, // models
      [{ codigo: "2022-1", nome: "2022 Gasolina" }],             // years
      { Valor: "R$ 120.000,00", Modelo: "T-Cross Highline TSI", MesReferencia: "julho de 2026" },
    ]);
    const r = await findFipeValue({ brand: "Volkswagen", model: "T-Cross", year: 2022 });
    expect(r.valueBRL).toBe(120000);
    expect(r.matchedModel).toContain("T-Cross");
    expect(r.referenceMonth).toMatch(/julho/);
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

Run: `npx vitest run src/lib/integrations/__tests__/fipe.test.ts`

- [ ] **Step 3: Write `src/lib/integrations/fipe.ts`**

Uses the public parallelum FIPE API (`https://parallelum.com.br/fipe/api/v2/cars`). Walks brand → model → year; fuzzy brand/model match by normalized substring; **fail closed** to `FipeError` on any miss/ambiguity.

```ts
import type { BodyType } from "@/lib/types"; // (kept for future use; safe to omit if unused)

const BASE = "https://parallelum.com.br/fipe/api/v2/cars";

export interface FipeMatch { valueBRL: number; matchedModel: string; referenceMonth: string }
export class FipeError extends Error {
  constructor(message: string) { super(message); this.name = "FipeError"; }
}

interface Ref { codigo: string; nome: string }

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]/g, "");

async function getJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { headers: { Accept: "application/json" } });
  if (!res.ok) throw new FipeError(`FIPE request failed (${res.status}) for ${url}`);
  return (await res.json()) as T;
}

function pickBrand(brands: Ref[], brand: string): Ref {
  const target = norm(brand);
  const hit = brands.find((b) => norm(b.nome).includes(target) || target.includes(norm(b.nome).slice(0, 4)));
  if (!hit) throw new FipeError(`No FIPE brand matches "${brand}"`);
  return hit;
}

function pickModel(models: Ref[], model: string): Ref {
  const target = norm(model);
  const matches = models.filter((m) => norm(m.nome).includes(target));
  if (matches.length === 0) throw new FipeError(`No FIPE model matches "${model}"`);
  // Prefer the shortest name (least trim noise) to reduce ambiguity.
  return matches.sort((a, b) => a.nome.length - b.nome.length)[0];
}

function pickYear(years: Ref[], year: number): Ref {
  const hit = years.find((y) => y.codigo.startsWith(String(year)) || y.nome.startsWith(String(year)));
  if (!hit) throw new FipeError(`No FIPE year entry for ${year}`);
  return hit;
}

function parseBRL(v: string): number {
  const digits = v.replace(/[^0-9,]/g, "").replace(/\./g, "").split(",")[0];
  const n = Number(digits);
  if (!Number.isFinite(n) || n <= 0) throw new FipeError(`Unparseable FIPE value "${v}"`);
  return n;
}

export async function findFipeValue(
  input: { brand: string; model: string; year: number; modelYear?: number },
): Promise<FipeMatch> {
  const brands = await getJson<Ref[]>(`${BASE}/brands`);
  const brand = pickBrand(brands, input.brand);

  const modelsResp = await getJson<{ modelos?: Ref[] } | Ref[]>(`${BASE}/brands/${brand.codigo}/models`);
  const models = Array.isArray(modelsResp) ? modelsResp : (modelsResp.modelos ?? []);
  const model = pickModel(models, input.model);

  const years = await getJson<Ref[]>(`${BASE}/brands/${brand.codigo}/models/${model.codigo}/years`);
  const year = pickYear(years, input.modelYear ?? input.year);

  const detail = await getJson<{ Valor: string; Modelo: string; MesReferencia: string }>(
    `${BASE}/brands/${brand.codigo}/models/${model.codigo}/years/${year.codigo}`,
  );

  return { valueBRL: parseBRL(detail.Valor), matchedModel: detail.Modelo, referenceMonth: detail.MesReferencia };
}
```

If the unused `BodyType` import trips the lint no-unused rule, remove line 1.

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/integrations/fipe.ts src/lib/integrations/__tests__/fipe.test.ts
git commit -m "Add live FIPE integration (fail-closed on ambiguity)"
```

---

### Task 5: Decision engine

**Files:**
- Create: `src/lib/scoring/decision.ts`
- Test: `src/lib/scoring/__tests__/decision.test.ts`

**Interfaces:**
- Consumes: `computeGoalFit` (existing `@/lib/scoring/goalFit`), `computeMarketAssessment` (Task 3), `DEFAULT_WEIGHTS`, types.
- Produces: `computeDecision(car, goal, risk, condition) => DecisionResult`. Consumed by `aggregate.ts`.

Design: sub-scores = goalFit (`computeGoalFit`), documentationRisk (`risk.score`), condition (`condition.score`), value (from market; **null when FIPE null**), resaleLiquidity (from market resaleEase: high=85/medium=60/low=35). Weighted blend with `DEFAULT_WEIGHTS`; **drop `value` weight and renormalize** when valueScore null. `severeRiskGate` (any failed+severe item) → verdict `avoid`. `manualVerdictOverride` wins.

- [ ] **Step 1: Write `src/lib/scoring/__tests__/decision.test.ts`**

```ts
import { describe, it, expect } from "vitest";
import { computeDecision } from "../decision";
import type { BuyingGoal, Car, RiskCheck, ConditionReview } from "@/lib/types";

const car = (o: Partial<Car>): Car => ({
  id: "c1", brand: "Volkswagen", model: "T-Cross", trim: "", year: 2022, modelYear: 2022,
  mileageKm: 40000, askingPriceBRL: 100000, city: "SP", state: "SP", sellerType: "dealer",
  fuel: "flex", transmission: "automatic", bodyType: "suv", color: "white",
  sourceUrl: "https://x", sourcePlatform: "OLX", notes: "", attachments: [], photos: [],
  pipelineStage: "new_lead", createdAt: "", updatedAt: "", fipeValueBRL: null, ...o,
});
const goal: BuyingGoal = {
  id: "g1", name: "g", active: true, budgetMinBRL: 60000, budgetMaxBRL: 1000000, minYear: 2021,
  maxMileageKm: 90000, requiredFeatures: [], preferredBodyTypes: ["suv", "sedan", "hatch"],
  preferredBrands: [], excludedBrandsModels: [], fuelEconomyThresholdKmL: 10,
  minResaleLiquidityScore: 50, familySpaceRequired: false,
};
const risk = (o: Partial<RiskCheck> = {}): RiskCheck => ({
  carId: "c1", items: [], caixaReview: { applicable: false, editalReviewed: false, hiddenTransferCostsBRL: 0, resaleStigmaNote: "", historyClarity: "clear", legalTransferRiskNote: "" }, score: 100, ...o,
});
const cond: ConditionReview = { carId: "c1", fields: [], mechanicNotes: "", score: 80 };

describe("computeDecision", () => {
  it("excludes value from the blend and renormalizes when FIPE is null", () => {
    const d = computeDecision(car({ fipeValueBRL: null }), goal, risk(), cond);
    expect(d.valueScore).toBeNull();
    const sum = d.weights.goalFit + d.weights.documentationRisk + d.weights.condition + d.weights.resaleLiquidity;
    expect(sum).toBeCloseTo(1, 5);
    expect(d.weights.value).toBe(0);
    expect(d.finalScore).toBeGreaterThan(0);
  });
  it("a severe failed risk check gates the verdict to avoid", () => {
    const gated = risk({ items: [{ key: "judicial_restriction", status: "failed", severity: "severe", notes: "" }], score: 10 });
    const d = computeDecision(car({ fipeValueBRL: 100000 }), goal, gated, cond);
    expect(d.severeRiskGate).toBe(true);
    expect(d.verdict).toBe("avoid");
  });
  it("manual override wins", () => {
    const d = computeDecision(car({ manualVerdictOverride: "safe_buy" }), goal, risk(), cond);
    expect(d.manualOverrideApplied).toBe(true);
    expect(d.verdict).toBe("safe_buy");
  });
});
```

- [ ] **Step 2: Run — expect FAIL**

- [ ] **Step 3: Write `src/lib/scoring/decision.ts`**

```ts
import type { BuyingGoal, Car, ConditionReview, DecisionResult, RiskCheck, ScoreWeights, Verdict } from "@/lib/types";
import { DEFAULT_WEIGHTS } from "@/lib/types";
import { computeGoalFit } from "@/lib/scoring/goalFit";
import { computeMarketAssessment } from "@/lib/scoring/market";

const RESALE_SCORE = { high: 85, medium: 60, low: 35 } as const;

function verdictFromScore(score: number): Verdict {
  if (score >= 80) return "safe_buy";
  if (score >= 65) return "good_deal_verify";
  if (score >= 45) return "only_if_negotiated";
  return "avoid";
}

export function computeDecision(car: Car, goal: BuyingGoal, risk: RiskCheck, condition: ConditionReview): DecisionResult {
  const goalMatch = computeGoalFit(car, goal);
  const market = computeMarketAssessment(car, car.fipeValueBRL);

  const goalFitScore = goalMatch.score;
  const documentationRiskScore = risk.score;
  const conditionScore = condition.score;
  const resaleLiquidityScore = RESALE_SCORE[market.resaleEase];
  const valueScore =
    market.premiumOverFairPct === null
      ? null
      : Math.max(0, Math.min(100, Math.round(50 - market.premiumOverFairPct * 2)));

  // Weight set: drop value and renormalize the rest when FIPE is unknown.
  let weights: ScoreWeights = { ...DEFAULT_WEIGHTS };
  if (valueScore === null) {
    const kept = DEFAULT_WEIGHTS.goalFit + DEFAULT_WEIGHTS.documentationRisk + DEFAULT_WEIGHTS.condition + DEFAULT_WEIGHTS.resaleLiquidity;
    weights = {
      goalFit: DEFAULT_WEIGHTS.goalFit / kept,
      documentationRisk: DEFAULT_WEIGHTS.documentationRisk / kept,
      condition: DEFAULT_WEIGHTS.condition / kept,
      value: 0,
      resaleLiquidity: DEFAULT_WEIGHTS.resaleLiquidity / kept,
    };
  }

  const finalScore = Math.round(
    goalFitScore * weights.goalFit +
      documentationRiskScore * weights.documentationRisk +
      conditionScore * weights.condition +
      (valueScore ?? 0) * weights.value +
      resaleLiquidityScore * weights.resaleLiquidity,
  );

  const severeRiskGate = risk.items.some((i) => i.status === "failed" && i.severity === "severe");
  const manualOverrideApplied = Boolean(car.manualVerdictOverride);

  let verdict: Verdict;
  if (manualOverrideApplied) verdict = car.manualVerdictOverride!;
  else if (severeRiskGate) verdict = "avoid";
  else verdict = verdictFromScore(finalScore);

  const reasoning: string[] = [];
  if (manualOverrideApplied) reasoning.push(`Manual override: ${car.overrideReason ?? "set by owner"}.`);
  if (severeRiskGate) reasoning.push("Severe documentation risk gates this to Avoid regardless of score.");
  reasoning.push(`Goal fit ${goalFitScore}, risk ${documentationRiskScore}, condition ${conditionScore}, resale ${resaleLiquidityScore}.`);
  reasoning.push(valueScore === null ? "FIPE not synced — value excluded from the blend." : `Value score ${valueScore} (${market.verdict.replaceAll("_", " ")}).`);

  return {
    carId: car.id,
    goalFitScore,
    documentationRiskScore,
    conditionScore,
    valueScore,
    resaleLiquidityScore,
    finalScore,
    verdict,
    severeRiskGate,
    manualOverrideApplied,
    weights,
    reasoning,
  };
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add src/lib/scoring/decision.ts src/lib/scoring/__tests__/decision.test.ts
git commit -m "Add decision engine with FIPE-null weight renormalization and severe-risk gate"
```

---

### Task 6: Server actions (pipeline stage + FIPE sync)

**Files:**
- Create: `src/lib/actions/pipeline.ts`, `src/lib/actions/fipe-sync.ts`

**Interfaces:**
- Consumes: `prisma` (Task 1), `findFipeValue`/`FipeError` (Task 4), `PIPELINE_STAGES`/`PipelineStage` (types).
- Produces: `updateCarStage(carId, stage)`, `syncFipeValue(carId) => FipeSyncResult`, `type FipeSyncResult`. Consumed by `kanban-board.tsx` and `car-detail-tabs.tsx`.

No unit test (I/O + `"use server"`); verified by `npm run build` in Task 9. Read `node_modules/next/dist/docs/01-app/` server-actions + `revalidatePath` guidance before writing.

- [ ] **Step 1: Write `src/lib/actions/pipeline.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/types";

export async function updateCarStage(carId: string, stage: PipelineStage): Promise<void> {
  if (!PIPELINE_STAGES.some((s) => s.id === stage)) {
    throw new Error(`Unknown pipeline stage: ${stage}`);
  }
  await prisma.car.update({ where: { id: carId }, data: { pipelineStage: stage } });
  revalidatePath("/");
  revalidatePath(`/cars/${carId}`);
}
```

- [ ] **Step 2: Write `src/lib/actions/fipe-sync.ts`**

```ts
"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { findFipeValue, FipeError } from "@/lib/integrations/fipe";

export type FipeSyncResult =
  | { ok: true; valueBRL: number; matchedModel: string; referenceMonth: string }
  | { ok: false; error: string };

export async function syncFipeValue(carId: string): Promise<FipeSyncResult> {
  const car = await prisma.car.findUnique({ where: { id: carId } });
  if (!car) return { ok: false, error: "Car not found." };

  try {
    const match = await findFipeValue({ brand: car.brand, model: car.model, year: car.year, modelYear: car.modelYear });
    await prisma.car.update({ where: { id: carId }, data: { fipeValueBRL: match.valueBRL } });
    revalidatePath(`/cars/${carId}`);
    revalidatePath("/");
    return { ok: true, valueBRL: match.valueBRL, matchedModel: match.matchedModel, referenceMonth: match.referenceMonth };
  } catch (e) {
    if (e instanceof FipeError) return { ok: false, error: e.message };
    return { ok: false, error: e instanceof Error ? e.message : "Unknown FIPE sync error." };
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/actions/pipeline.ts src/lib/actions/fipe-sync.ts
git commit -m "Add updateCarStage and syncFipeValue server actions"
```

---

### Task 7: Design tokens + UI primitives

**Files:**
- Modify: `src/app/globals.css`
- Create: `src/components/ui/{card,badge,button,input,select,table,tabs}.tsx`

**Interfaces:**
- Consumes: `cn` (Task 1), installed Radix packages, `class-variance-authority`.
- Produces: the exact exports listed in the Contracts reference. Consumed by all three components + `car-detail-tabs`.

No unit tests (presentational); verified by `npm run build` in Task 9.

- [ ] **Step 1: Add semantic tokens to `src/app/globals.css`** (append after the existing `@theme inline` block; keep existing content)

```css
:root {
  --text-primary: #18181b;
  --text-secondary: #3f3f46;
  --text-muted: #71717a;
  --surface: #ffffff;
  --surface-hover: #f4f4f5;
  --border: #e4e4e7;
  --accent: #2563eb;
  --success: #16a34a;
  --success-bg: #f0fdf4;
  --danger: #dc2626;
  --danger-bg: #fef2f2;
  --warning: #d97706;
}
@media (prefers-color-scheme: dark) {
  :root {
    --text-primary: #fafafa;
    --text-secondary: #d4d4d8;
    --text-muted: #a1a1aa;
    --surface: #18181b;
    --surface-hover: #27272a;
    --border: #3f3f46;
    --accent: #60a5fa;
    --success: #4ade80;
    --success-bg: #052e16;
    --danger: #f87171;
    --danger-bg: #450a0a;
    --warning: #fbbf24;
  }
}
@theme inline {
  --color-text-primary: var(--text-primary);
  --color-text-secondary: var(--text-secondary);
  --color-text-muted: var(--text-muted);
  --color-surface: var(--surface);
  --color-surface-hover: var(--surface-hover);
  --color-border: var(--border);
  --color-accent: var(--accent);
}
```

- [ ] **Step 2: `src/components/ui/card.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("rounded-lg border border-border bg-surface", className)} {...p} />;
}
export function CardHeader({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("flex flex-col space-y-1.5 p-4", className)} {...p} />;
}
export function CardTitle({ className, ...p }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h3 className={cn("text-sm font-semibold text-text-primary", className)} {...p} />;
}
export function CardContent({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("p-4 pt-0", className)} {...p} />;
}
```

- [ ] **Step 3: `src/components/ui/badge.tsx`**

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badge = cva("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      neutral: "border-transparent bg-surface-hover text-text-secondary",
      success: "border-transparent bg-[var(--success-bg)] text-[var(--success)]",
      warning: "border-transparent bg-[var(--danger-bg)] text-[var(--warning)]",
      danger: "border-transparent bg-[var(--danger-bg)] text-[var(--danger)]",
      outline: "border-border text-text-secondary",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export function Badge({ className, variant, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ variant }), className)} {...p} />;
}
```

- [ ] **Step 4: `src/components/ui/button.tsx`**

```tsx
import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const button = cva(
  "inline-flex items-center justify-center gap-1.5 rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-accent text-white hover:opacity-90",
        secondary: "border border-border bg-surface text-text-primary hover:bg-surface-hover",
      },
      size: { default: "h-9 px-4", sm: "h-8 px-3 text-xs" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export function Button({ className, variant, size, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & VariantProps<typeof button>) {
  return <button className={cn(button({ variant, size }), className)} {...p} />;
}
```

- [ ] **Step 5: `src/components/ui/input.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export function Input({ className, ...p }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn("h-9 w-full rounded-md border border-border bg-surface px-3 text-sm text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-accent", className)}
      {...p}
    />
  );
}
```

- [ ] **Step 6: `src/components/ui/tabs.tsx`** (Radix)

```tsx
"use client";
import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("flex gap-1 border-b border-border", className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger className={cn("px-3 py-2 text-sm text-text-muted data-[state=active]:border-b-2 data-[state=active]:border-accent data-[state=active]:text-text-primary", className)} {...p} />;
}
export function TabsContent({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("mt-4 focus:outline-none", className)} {...p} />;
}
```

- [ ] **Step 7: `src/components/ui/select.tsx`** (Radix)

```tsx
"use client";
import * as React from "react";
import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;
export function SelectTrigger({ className, children, ...p }: React.ComponentProps<typeof SelectPrimitive.Trigger>) {
  return (
    <SelectPrimitive.Trigger className={cn("inline-flex h-9 w-full items-center justify-between gap-1 rounded-md border border-border bg-surface px-3 text-sm text-text-primary", className)} {...p}>
      {children}
      <SelectPrimitive.Icon><ChevronDown className="h-4 w-4 opacity-60" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}
export function SelectContent({ className, children, ...p }: React.ComponentProps<typeof SelectPrimitive.Content>) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content position="popper" className={cn("z-50 overflow-hidden rounded-md border border-border bg-surface shadow-md", className)} {...p}>
        <SelectPrimitive.Viewport className="p-1">{children}</SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}
export function SelectItem({ className, children, ...p }: React.ComponentProps<typeof SelectPrimitive.Item>) {
  return (
    <SelectPrimitive.Item className={cn("relative flex cursor-pointer select-none items-center rounded px-6 py-1.5 text-sm text-text-primary outline-none data-[highlighted]:bg-surface-hover", className)} {...p}>
      <SelectPrimitive.ItemIndicator className="absolute left-1"><Check className="h-3.5 w-3.5" /></SelectPrimitive.ItemIndicator>
      <SelectPrimitive.ItemText>{children}</SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
```

- [ ] **Step 8: `src/components/ui/table.tsx`**

```tsx
import * as React from "react";
import { cn } from "@/lib/utils";

export function Table({ className, ...p }: React.HTMLAttributes<HTMLTableElement>) {
  return <div className="w-full overflow-x-auto rounded-lg border border-border"><table className={cn("w-full text-sm", className)} {...p} /></div>;
}
export function THead({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={cn("border-b border-border bg-surface-hover", className)} {...p} />;
}
export function TBody({ className, ...p }: React.HTMLAttributes<HTMLTableSectionElement>) {
  return <tbody className={cn("divide-y divide-border", className)} {...p} />;
}
export function TR({ className, ...p }: React.HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={cn("hover:bg-surface-hover", className)} {...p} />;
}
export function TH({ className, ...p }: React.ThHTMLAttributes<HTMLTableCellElement>) {
  return <th className={cn("px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-text-muted", className)} {...p} />;
}
export function TD({ className, ...p }: React.TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn("px-3 py-2.5 text-text-secondary", className)} {...p} />;
}
```

- [ ] **Step 9: Commit**

```bash
git add src/app/globals.css src/components/ui
git commit -m "Add design tokens and shadcn-style UI primitives over Radix"
```

---

### Task 8: Domain badges

**Files:**
- Create: `src/components/domain/verdict-badge.tsx`, `src/components/domain/check-status-badge.tsx`

**Interfaces:**
- Consumes: `Badge` (Task 7), `VERDICT_LABEL`/`Verdict`, `CheckStatus` (types).
- Produces: `VerdictBadge`, `CheckStatusBadge`. Consumed by kanban, table, detail.

- [ ] **Step 1: `src/components/domain/verdict-badge.tsx`**

```tsx
import { Badge } from "@/components/ui/badge";
import { VERDICT_LABEL, type Verdict } from "@/lib/types";

const VARIANT: Record<Verdict, "success" | "warning" | "danger" | "neutral"> = {
  safe_buy: "success",
  good_deal_verify: "success",
  only_if_negotiated: "warning",
  avoid: "danger",
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <Badge variant={VARIANT[verdict]}>{VERDICT_LABEL[verdict]}</Badge>;
}
```

- [ ] **Step 2: `src/components/domain/check-status-badge.tsx`**

```tsx
import { Badge } from "@/components/ui/badge";
import type { CheckStatus } from "@/lib/types";

const MAP: Record<CheckStatus, { label: string; variant: "success" | "warning" | "danger" | "neutral" }> = {
  verified: { label: "Verified", variant: "success" },
  pending: { label: "Pending", variant: "neutral" },
  warning: { label: "Warning", variant: "warning" },
  failed: { label: "Failed", variant: "danger" },
};

export function CheckStatusBadge({ status }: { status: CheckStatus }) {
  return <Badge variant={MAP[status].variant}>{MAP[status].label}</Badge>;
}
```

- [ ] **Step 3: Commit**

```bash
git add src/components/domain
git commit -m "Add verdict and check-status domain badges"
```

---

### Task 9: Routes, layout, and pipeline dashboard shell

**Files:**
- Modify: `src/app/layout.tsx` (metadata), `src/app/page.tsx` (rewrite)
- Create: `src/app/cars/[id]/page.tsx`, `src/components/pipeline/pipeline-view.tsx` (client toggle wrapper)

**Interfaces:**
- Consumes: `getAllBundles`/`getBundle` (aggregate), `KanbanBoard`, `CarsTableView`, `CarDetailTabs`.
- Produces: working routes. This is the task that makes `npm run build` pass end-to-end.

Read `node_modules/next/dist/docs/01-app/` for `generateMetadata`, dynamic `params: Promise<>`, and `notFound()` before writing.

- [ ] **Step 1: Update `src/app/layout.tsx` metadata**

Replace the `metadata` export:

```tsx
export const metadata: Metadata = {
  title: "Car Deal Flow",
  description: "Decision-support pipeline for used-car purchases in Brazil.",
};
```

(Keep the existing font/`<html>`/`<body>` wiring untouched.)

- [ ] **Step 2: Create `src/components/pipeline/pipeline-view.tsx`** (client toggle between board and table)

```tsx
"use client";
import { useState } from "react";
import { KanbanBoard } from "@/components/pipeline/kanban-board";
import { CarsTableView } from "@/components/cars/cars-table-view";
import { Button } from "@/components/ui/button";
import type { CarBundle } from "@/lib/aggregate";

export function PipelineView({ bundles }: { bundles: CarBundle[] }) {
  const [view, setView] = useState<"board" | "table">("board");
  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-2">
        <Button variant={view === "board" ? "default" : "secondary"} size="sm" onClick={() => setView("board")}>Board</Button>
        <Button variant={view === "table" ? "default" : "secondary"} size="sm" onClick={() => setView("table")}>Table</Button>
      </div>
      {view === "board" ? <KanbanBoard bundles={bundles} /> : <CarsTableView bundles={bundles} />}
    </div>
  );
}
```

- [ ] **Step 3: Rewrite `src/app/page.tsx`** (server component; graceful empty/no-goal states)

```tsx
import { getAllBundles } from "@/lib/aggregate";
import { PipelineView } from "@/components/pipeline/pipeline-view";

export const dynamic = "force-dynamic";

export default async function Home() {
  let bundles;
  try {
    bundles = await getAllBundles();
  } catch {
    return (
      <main className="mx-auto max-w-2xl p-8">
        <h1 className="text-xl font-semibold text-text-primary">Car Deal Flow</h1>
        <p className="mt-2 text-sm text-text-muted">
          No active buying goal is configured. Run <code>npm run db:seed</code> to seed one, then reload.
        </p>
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-[1400px] p-6">
      <header className="mb-6">
        <h1 className="text-xl font-semibold text-text-primary">Car Deal Flow</h1>
        <p className="text-sm text-text-muted">{bundles.length} vehicles in the pipeline.</p>
      </header>
      {bundles.length === 0 ? (
        <p className="text-sm text-text-muted">No vehicles yet. Run a harvest (see the harvest skills) to populate leads.</p>
      ) : (
        <PipelineView bundles={bundles} />
      )}
    </main>
  );
}
```

- [ ] **Step 4: Create `src/app/cars/[id]/page.tsx`** (async params per Next 16)

```tsx
import { notFound } from "next/navigation";
import Link from "next/link";
import { getBundle } from "@/lib/aggregate";
import { CarDetailTabs } from "@/components/cars/car-detail-tabs";

export const dynamic = "force-dynamic";

export default async function CarPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const bundle = await getBundle(id);
  if (!bundle) notFound();
  return (
    <main className="mx-auto max-w-5xl p-6">
      <Link href="/" className="text-sm text-accent hover:underline">← Back to pipeline</Link>
      <h1 className="mt-2 text-xl font-semibold text-text-primary">
        {bundle.car.brand} {bundle.car.model} <span className="text-text-muted">· {bundle.car.year}</span>
      </h1>
      <div className="mt-4"><CarDetailTabs bundle={bundle} /></div>
    </main>
  );
}
```

- [ ] **Step 5: Build the app** (this is the integration gate for Tasks 1–9)

Run: `npm run build`
Expected: `✓ Compiled successfully` AND TypeScript check passes with no errors. Fix any type mismatch against the Contracts reference before proceeding. (Task 4 already fixed the `ingest-real-cars.ts` import that previously broke the build.)

- [ ] **Step 6: Commit**

```bash
git add src/app/layout.tsx src/app/page.tsx "src/app/cars/[id]/page.tsx" src/components/pipeline/pipeline-view.tsx
git commit -m "Wire pipeline dashboard and car-detail routes; real app metadata"
```

---

### Task 10: Seed the owner's buying goal

**Files:**
- Create: `prisma/seed.ts`

**Interfaces:**
- Consumes: Prisma client, JSON-string columns per `schema.prisma` (`requiredFeatures`, `preferredBodyTypes`, etc. are stringified arrays).

- [ ] **Step 1: Write `prisma/seed.ts`**

```ts
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../src/generated/prisma/client";

const adapter = new PrismaBetterSqlite3({ url: process.env.DATABASE_URL ?? "file:./prisma/dev.db" });
const prisma = new PrismaClient({ adapter });

async function main() {
  const existing = await prisma.buyingGoal.findFirst({ where: { active: true } });
  if (existing) {
    console.log(`Active goal already present: ${existing.name}`);
    return;
  }
  await prisma.buyingGoal.create({
    data: {
      name: "Primary buy — prefer T-Cross / Nivus / HR-V / BYD / RAV4",
      active: true,
      budgetMinBRL: 60_000,
      budgetMaxBRL: 1_000_000,
      minYear: 2021,
      maxMileageKm: 90_000,
      requiredFeatures: JSON.stringify([]),
      preferredBodyTypes: JSON.stringify(["hatch", "sedan", "suv"]),
      preferredBrands: JSON.stringify([]),
      excludedBrandsModels: JSON.stringify([]),
      fuelEconomyThresholdKmL: 10,
      minResaleLiquidityScore: 50,
      familySpaceRequired: false,
    },
  });
  console.log("Seeded active buying goal.");
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
```

- [ ] **Step 2: Run the seed against a scratch DB to verify it executes**

Run: `DATABASE_URL="file:./prisma/dev.db" npm run db:migrate && DATABASE_URL="file:./prisma/dev.db" npm run db:seed`
Expected: "Seeded active buying goal." (dev.db is gitignored — safe.)

- [ ] **Step 3: Commit**

```bash
git add prisma/seed.ts
git commit -m "Seed active buying goal (owner criteria)"
```

---

### Task 11: Declare pipeline deps + fix the broken risk-check test

**Files:**
- Modify: `package.json` (dependencies), `scripts/risk-checks/__tests__/list-targets.test.ts`

**Interfaces:** none.

- [ ] **Step 1: Detect the installed Playwright/stealth versions** (they resolve today only because something installed them transitively or globally; pin what the scripts import)

Run: `node -e "for (const p of ['playwright','playwright-extra','puppeteer-extra-plugin-stealth']) { try { console.log(p, require(p+'/package.json').version) } catch { console.log(p, 'MISSING') } }"`

- [ ] **Step 2: Add them to `package.json` dependencies** using the versions printed (example values — use actual output):

```jsonc
// in "dependencies", keep alphabetical order roughly:
"playwright": "^1.56.0",
"playwright-extra": "^4.3.6",
"puppeteer-extra-plugin-stealth": "^2.11.2",
```

If Step 1 printed `MISSING` for any, run `npm install --save <pkg>` for it (this is declaring an already-required import, permitted by Global Constraints), then verify `npm ci` still resolves.

- [ ] **Step 3: Fix `scripts/risk-checks/__tests__/list-targets.test.ts`** — give each fixture car a unique `sourceUrl`. Change the `makeCar` helper signature and body:

Change the create block's `sourceUrl` line from:

```ts
        sourceUrl: "https://x", sourcePlatform: "OLX", notes: "",
```

to derive from the id:

```ts
        sourceUrl: `https://example.com/${id}`, sourcePlatform: "OLX", notes: "",
```

- [ ] **Step 4: Run the previously-failing tests — expect PASS**

Run: `npx vitest run scripts/risk-checks/__tests__/list-targets.test.ts`
Expected: 6 passed (0 skipped).

- [ ] **Step 5: Run the full suite — expect all green**

Run: `npx vitest run`
Expected: 0 failed. (The 9 fetch-importing test files now collect because their Playwright deps are declared/installed.)

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json scripts/risk-checks/__tests__/list-targets.test.ts
git commit -m "Declare Playwright deps; fix duplicate sourceUrl in list-targets test"
```

---

### Task 12: Dedup pipeline inference helpers

**Files:**
- Modify: `scripts/ingestion/lib/parse-common.ts` (ensure single `inferBodyType`, `BRAND_ALIASES`/`normalizeBrand`, seller-type helper exported)
- Modify: `scripts/ingestion/bidchain-parse.ts`, `scripts/ingestion/mgl-parse.ts` (call the shared helpers; delete local copies)
- Delete (if unused): `scripts/ingestion/mgl-harvest-write.ts`
- Test: existing `scripts/ingestion/__tests__/parse-common.test.ts`, `bidchain-parse.test.ts`, `santander-parse.test.ts`

**Interfaces:**
- Produces: the shared helpers as the single source of truth; behavior unchanged.

- [ ] **Step 1: Confirm `mgl-harvest-write.ts` is dead** before deleting

Run: `grep -rn "mgl-harvest-write" scripts src package.json .claude 2>/dev/null`
Expected: only self-references. If any importer exists, keep the file and just dedup its helper usage instead.

- [ ] **Step 2: Read the three implementations and pick the most complete as canonical**

Run: `grep -n "guessBodyType\|inferBodyType\|BRAND_ALIASES\|sellerType" scripts/ingestion/lib/parse-common.ts scripts/ingestion/bidchain-parse.ts scripts/ingestion/mgl-parse.ts scripts/ingestion/mgl-harvest-write.ts`

Ensure `parse-common.ts` exports `inferBodyType`, `normalizeBrand` (using the fuller `BRAND_ALIASES`), and a seller-type helper. Merge any alias entries unique to the bidchain copy into `parse-common.ts`.

- [ ] **Step 3: Replace the local copies with imports**

In `bidchain-parse.ts` and `mgl-parse.ts`: delete the local `guessBodyType`/`BRAND_ALIASES`/seller-type definitions and import the shared ones from `./lib/parse-common`. Keep call sites identical.

- [ ] **Step 4: Delete `mgl-harvest-write.ts`** (only if Step 1 confirmed dead)

```bash
git rm scripts/ingestion/mgl-harvest-write.ts
```

- [ ] **Step 5: Run the parser tests — expect PASS (behavior unchanged)**

Run: `npx vitest run scripts/ingestion/__tests__/parse-common.test.ts scripts/ingestion/__tests__/bidchain-parse.test.ts scripts/ingestion/__tests__/santander-parse.test.ts`

- [ ] **Step 6: Run the full suite + lint** (lint should have fewer unused-var warnings now)

Run: `npx vitest run && npm run lint`

- [ ] **Step 7: Commit**

```bash
git add scripts/ingestion
git commit -m "Dedup body-type/brand/seller inference into parse-common; drop dead mgl-harvest-write"
```

---

### Task 13: CI workflow, README, audit, final verification

**Files:**
- Create: `.github/workflows/ci.yml`, replace `README.md`
- Modify: dependency lockfile (audit)

**Interfaces:** none.

- [ ] **Step 1: Create `.github/workflows/ci.yml`**

```yaml
name: CI
on:
  push:
    branches: [main]
  pull_request:
jobs:
  verify:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - run: npm ci
      - run: npm run build
      - run: npm test
      - run: npm run lint
```

- [ ] **Step 2: Replace `README.md`** with real project docs

```md
# Car Deal Flow

Decision-support pipeline for used-car purchases in Brazil. Harvests distress /
repossession / auction / repasse inventory into SQLite, scores each lead against
an active buying goal, and surfaces a triage pipeline in the browser.

## Stack
Next.js 16 (App Router) · React 19 · Prisma 7 + SQLite · Tailwind v4 · Vitest ·
tsx harvest scripts (Playwright + stealth for SPA/Cloudflare sources).

## Setup
```bash
npm ci
echo 'DATABASE_URL="file:./prisma/dev.db"' > .env
npm run db:migrate
npm run db:seed        # seeds the active buying goal
npm run dev            # http://localhost:3000
```

## Harvesting leads
See the harvest skills (`harvest-*`) and the orchestrator:
```bash
npm run harvest              # all sources
npm run harvest:olx          # single source
npm run harvest:pre          # pre-repossession (repasse) phase
```

## Quality gates
```bash
npm run build && npm test && npm run lint
```
See `SPEC.md` for scope/boundaries and `docs/superpowers/specs/` for design history.
```

- [ ] **Step 3: Apply non-breaking audit fixes only**

Run: `npm audit fix`
Do NOT run `--force` (it downgrades next/prisma — out of scope). Note any remaining advisories in the commit body.

- [ ] **Step 4: Full green verification**

Run: `npm run build && npx vitest run && npm run lint`
Expected: build ✓, tests 0 failed, lint 0 errors (warnings acceptable but should be reduced).

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/ci.yml README.md package.json package-lock.json
git commit -m "Add CI workflow, real README, non-breaking audit fixes"
```

- [ ] **Step 6: Push and open PR** (only when the owner confirms)

```bash
git push -u origin ui-reconstruction
gh pr create --fill
```

---

## Self-Review

**Spec coverage:**
- §1 infra → Task 1 ✓ | §2 scoring → Tasks 2,3,5 ✓ | §3 FIPE → Task 4 ✓ | §4 actions → Task 6 ✓ | §5 UI/tokens/badges → Tasks 7,8 ✓ | §6 routes/shell → Task 9 ✓ | §7 dedup → Task 12 ✓ | §8 seed → Task 10 ✓ | §9 build/test/CI → Tasks 11,13 ✓.
- Empty-DB/no-goal graceful state → Task 9 Step 3 ✓. `ingest-real-cars.ts` build fix → Task 4 ✓.

**Placeholder scan:** No TBD/TODO; every code step has full code. Version numbers in Task 11 Step 2 are explicitly "use actual output from Step 1", not guesses.

**Type consistency:** `FipeMatch`/`FipeSyncResult` shapes match `car-detail-tabs.tsx` usage (`valueBRL`, `matchedModel`, `referenceMonth`, `error`). `computeDecision` args `(car, goal, risk, condition)` match `aggregate.ts:175`. `computeMarketAssessment(car, fipe)` matches `aggregate.ts:177`. `updateCarStage(carId, stage)` matches `kanban-board.tsx:27`. Badge variants match component usage (`success/warning/danger/neutral/outline`). Table exports (`TBody/TD/TH/THead/TR/Table`) match `cars-table-view.tsx:8`.

**Open item (from spec §8):** preferred models live in the goal `name` only; `preferredBrands` empty so "any brand" carries no scoring penalty. Owner may adjust post-seed.
