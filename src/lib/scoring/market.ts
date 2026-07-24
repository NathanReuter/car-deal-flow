import type { Car, MarketAssessment, BodyType } from "@/lib/types";
import { computeLandedCost } from "@/lib/cost/landedCost";

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
    return { ...base, fairMarketMinBRL: null, fairMarketMaxBRL: null, premiumOverFairPct: null, verdict: "unavailable" };
  }

  const premium = ((landed - fipe) / fipe) * 100;
  // Symmetric bands: |premium| within ±7% is "fair"; strictly beyond is under/over.
  const verdict = premium < -FAIR_BAND * 100 ? "under_market" : premium > FAIR_BAND * 100 ? "overpriced" : "fair";

  return {
    ...base,
    fairMarketMinBRL: Math.round(fipe * (1 - FAIR_BAND)),
    fairMarketMaxBRL: Math.round(fipe * (1 + FAIR_BAND)),
    premiumOverFairPct: Math.round(premium * 10) / 10,
    verdict,
  };
}
