"use client";
import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { MultiSelect } from "@/components/goal/multi-select";
import {
  BRAND_OPTIONS,
  BODY_TYPE_OPTIONS,
  BODY_TYPE_LABELS,
  FEATURE_OPTIONS,
} from "@/lib/goal-options";
import type { GoalFieldErrors, GoalFormInput } from "@/lib/goal-form";
import { updateGoal } from "@/app/goal/actions";
import type { BuyingGoal } from "@/lib/types";

// Scalar fields are held as strings so inputs can be cleared/typed freely;
// validation coerces them on submit.
interface FormState {
  name: string;
  budgetMinBRL: string;
  budgetMaxBRL: string;
  minYear: string;
  maxMileageKm: string;
  fuelEconomyThresholdKmL: string;
  minResaleLiquidityScore: string;
  familySpaceRequired: boolean;
  requiredFeatures: string[];
  preferredBodyTypes: string[];
  preferredBrands: string[];
  excludedBrandsModels: string[];
}

function initialState(goal: BuyingGoal): FormState {
  return {
    name: goal.name,
    budgetMinBRL: String(goal.budgetMinBRL),
    budgetMaxBRL: String(goal.budgetMaxBRL),
    minYear: String(goal.minYear),
    maxMileageKm: String(goal.maxMileageKm),
    fuelEconomyThresholdKmL: String(goal.fuelEconomyThresholdKmL),
    minResaleLiquidityScore: String(goal.minResaleLiquidityScore),
    familySpaceRequired: goal.familySpaceRequired,
    requiredFeatures: goal.requiredFeatures,
    preferredBodyTypes: goal.preferredBodyTypes,
    preferredBrands: goal.preferredBrands,
    excludedBrandsModels: goal.excludedBrandsModels,
  };
}

function Field({
  label,
  htmlFor,
  hint,
  error,
  children,
}: {
  label: string;
  htmlFor?: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label htmlFor={htmlFor} className="block text-sm font-medium text-text-primary">
        {label}
      </label>
      {children}
      {hint && !error && <p className="text-xs text-text-muted">{hint}</p>}
      {error && <p className="text-xs text-[var(--danger)]">{error}</p>}
    </div>
  );
}

export function GoalEditor({ goal }: { goal: BuyingGoal }) {
  const [form, setForm] = React.useState<FormState>(() => initialState(goal));
  const [errors, setErrors] = React.useState<GoalFieldErrors>({});
  const [saved, setSaved] = React.useState(false);
  const [formError, setFormError] = React.useState<string | null>(null);
  const [pending, startTransition] = React.useTransition();

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
    setSaved(false);
  }

  function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErrors({});
    setFormError(null);
    setSaved(false);

    const input: GoalFormInput = { ...form };
    startTransition(async () => {
      const result = await updateGoal(input);
      if (result.ok) {
        setSaved(true);
      } else if (result.errors) {
        setErrors(result.errors);
      } else {
        setFormError(result.error ?? "Could not save the goal.");
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="space-y-6">
      <Field label="Goal name" htmlFor="goal-name" error={errors.name}>
        <Input
          id="goal-name"
          value={form.name}
          onChange={(e) => set("name", e.target.value)}
        />
      </Field>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Budget min (R$)" htmlFor="budget-min" error={errors.budgetMinBRL}>
          <Input
            id="budget-min"
            inputMode="numeric"
            value={form.budgetMinBRL}
            onChange={(e) => set("budgetMinBRL", e.target.value)}
          />
        </Field>
        <Field label="Budget max (R$)" htmlFor="budget-max" error={errors.budgetMaxBRL}>
          <Input
            id="budget-max"
            inputMode="numeric"
            value={form.budgetMaxBRL}
            onChange={(e) => set("budgetMaxBRL", e.target.value)}
          />
        </Field>
        <Field label="Minimum model year" htmlFor="min-year" error={errors.minYear}>
          <Input
            id="min-year"
            inputMode="numeric"
            value={form.minYear}
            onChange={(e) => set("minYear", e.target.value)}
          />
        </Field>
        <Field label="Max mileage (km)" htmlFor="max-km" error={errors.maxMileageKm}>
          <Input
            id="max-km"
            inputMode="numeric"
            value={form.maxMileageKm}
            onChange={(e) => set("maxMileageKm", e.target.value)}
          />
        </Field>
        <Field
          label="Fuel economy threshold (km/L)"
          htmlFor="fuel-econ"
          error={errors.fuelEconomyThresholdKmL}
        >
          <Input
            id="fuel-econ"
            inputMode="numeric"
            value={form.fuelEconomyThresholdKmL}
            onChange={(e) => set("fuelEconomyThresholdKmL", e.target.value)}
          />
        </Field>
        <Field
          label="Min resale liquidity (0–100)"
          htmlFor="resale"
          error={errors.minResaleLiquidityScore}
        >
          <Input
            id="resale"
            inputMode="numeric"
            value={form.minResaleLiquidityScore}
            onChange={(e) => set("minResaleLiquidityScore", e.target.value)}
          />
        </Field>
      </div>

      <Field
        label="Preferred brands"
        hint="Pick from the list or type to add a custom brand."
      >
        <MultiSelect
          values={form.preferredBrands}
          onChange={(v) => set("preferredBrands", v)}
          options={BRAND_OPTIONS}
          placeholder="Add a brand…"
        />
      </Field>

      <Field
        label="Preferred body types"
        hint="Choose from the supported body types."
        error={errors.preferredBodyTypes}
      >
        <MultiSelect
          values={form.preferredBodyTypes}
          onChange={(v) => set("preferredBodyTypes", v)}
          options={BODY_TYPE_OPTIONS}
          optionLabels={BODY_TYPE_LABELS}
          allowCustom={false}
          placeholder="Add a body type…"
        />
      </Field>

      <Field
        label="Required features"
        hint="Pick from the list or type to add a custom feature."
      >
        <MultiSelect
          values={form.requiredFeatures}
          onChange={(v) => set("requiredFeatures", v)}
          options={FEATURE_OPTIONS}
          placeholder="Add a feature…"
        />
      </Field>

      <Field
        label="Excluded brands / models"
        hint='Type any brand or "Brand Model" to exclude, e.g. "Fiat Mobi".'
      >
        <MultiSelect
          values={form.excludedBrandsModels}
          onChange={(v) => set("excludedBrandsModels", v)}
          options={[]}
          placeholder="Add an exclusion…"
        />
      </Field>

      <label className="flex items-center gap-2 text-sm text-text-primary">
        <input
          type="checkbox"
          checked={form.familySpaceRequired}
          onChange={(e) => set("familySpaceRequired", e.target.checked)}
          className="h-4 w-4 rounded border-border"
        />
        Family space required
      </label>

      <div className="flex items-center gap-3 pt-2">
        <Button type="submit" disabled={pending}>
          {pending ? "Saving…" : "Save goal"}
        </Button>
        {saved && <span className="text-sm text-[var(--success)]">Saved.</span>}
        {formError && <span className="text-sm text-[var(--danger)]">{formError}</span>}
      </div>
    </form>
  );
}
