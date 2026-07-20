// Core domain types for Car Deal Flow — a decision-support system for used-car
// purchases in the Brazilian market. Every score is 0-100 unless noted otherwise.

export type PipelineStage =
  | "new_lead"
  | "researching"
  | "waiting_docs"
  | "inspected"
  | "negotiating"
  | "approved"
  | "parked"
  | "rejected"
  | "expired"
  | "bought";

export const PIPELINE_STAGES: { id: PipelineStage; label: string }[] = [
  { id: "new_lead", label: "New Lead" },
  { id: "researching", label: "Researching" },
  { id: "waiting_docs", label: "Waiting Docs" },
  { id: "inspected", label: "Inspected" },
  { id: "negotiating", label: "Negotiating" },
  { id: "approved", label: "Approved" },
  { id: "parked", label: "Parked" },
  { id: "rejected", label: "Rejected" },
  { id: "expired", label: "Expired" },
  { id: "bought", label: "Bought" },
];

/** Stages shown as kanban columns — expired is soft-deleted, so it gets no column. */
export const KANBAN_STAGES = PIPELINE_STAGES.filter((s) => s.id !== "expired");

/**
 * Stages treated as the active working set (tracked counts / kanban).
 * Shortlist and priority-review expiry filtering use `isShortlistEligible`
 * in `@/lib/shortlist` (stage + auction-date rules), not this list alone.
 */
export const ACTIVE_PIPELINE_STAGES: PipelineStage[] = [
  "new_lead",
  "researching",
  "waiting_docs",
  "inspected",
  "negotiating",
  "approved",
];

export type SellerType =
  | "owner"
  | "dealer"
  | "auction"
  | "bank_recovery"
  | "caixa_recovery"
  | "repasse";

export const SELLER_TYPE_LABEL: Record<SellerType, string> = {
  owner: "Owner (particular)",
  dealer: "Dealer",
  auction: "Auction",
  bank_recovery: "Bank Recovery",
  caixa_recovery: "Caixa / Repossessed",
  repasse: "Repasse (assumir financiamento)",
};

/** Where in the repossession lifecycle the deal sits. */
export type DealPhase = "pre_repossession" | "auction";

export type SourceChannel =
  | "classifieds"
  | "aggregator"
  | "messaging_group"
  | "forum"
  | "storefront"
  | "auction_house";

export const SOURCE_CHANNEL_LABEL: Record<SourceChannel, string> = {
  classifieds: "Classificados",
  aggregator: "Agregador",
  messaging_group: "Grupo de mensagens",
  forum: "Fórum",
  storefront: "Loja de repasse",
  auction_house: "Leiloeira",
};

export type LeadConfidence = "low" | "medium" | "high";

export const CONFIDENCE_LABEL: Record<LeadConfidence, string> = {
  low: "Baixa",
  medium: "Média",
  high: "Alta",
};

export const DEAL_PHASE_LABEL: Record<DealPhase, string> = {
  pre_repossession: "Pré-apreensão",
  auction: "Leilão",
};

export type RepasseUrgency = "high" | "medium" | "low";

/** Repasse deal economics — null means the ad did not disclose it (never guessed). */
export interface RepasseInfo {
  entryAskBRL: number | null;
  outstandingDebtBRL: number | null;
  installmentBRL: number | null;
  installmentsRemaining: number | null;
  /** One contact handle max (LGPD minimization); lives only here. */
  sellerContact: string | null;
  urgency: RepasseUrgency | null;
}

export type FuelType = "flex" | "gasoline" | "diesel" | "hybrid" | "electric";
export type Transmission = "manual" | "automatic" | "cvt" | "automated_manual";
export type BodyType =
  | "hatch"
  | "sedan"
  | "suv"
  | "pickup"
  | "minivan"
  | "coupe"
  | "wagon";

export interface Attachment {
  id: string;
  label: string;
  kind: "photo" | "document" | "evidence_link";
  url: string;
  addedAt: string; // ISO date
}

export interface Car {
  id: string;
  brand: string;
  model: string;
  trim: string;
  year: number;
  modelYear: number;
  mileageKm: number | null;
  askingPriceBRL: number;
  city: string;
  state: string; // UF, e.g. "SP"
  sellerType: SellerType;
  fuel: FuelType;
  transmission: Transmission;
  bodyType: BodyType;
  color: string;
  sourceUrl: string;
  sourcePlatform: string;
  /** All harvest origins; primary is first (matches sourceUrl). Optional for scoring-only paths. */
  sources?: {
    url: string;
    platform: string;
    isPrimary: boolean;
    auctionDate: string | null;
  }[];
  notes: string;
  plate?: string;
  chassis?: string;
  attachments: Attachment[];
  photos: string[]; // image URLs, first is cover
  pipelineStage: PipelineStage;
  createdAt: string;
  updatedAt: string;
  manualVerdictOverride?: Verdict;
  overrideReason?: string;
  stageReason?: string;

  // Null until a confident FIPE sync — never treat 0 as a real valuation.
  fipeValueBRL: number | null;

  /** Undefined on legacy in-memory fixtures — treat as "auction". */
  dealPhase?: DealPhase;
  /** Present only for pre_repossession leads. */
  repasse?: RepasseInfo;
}

// ---------------------------------------------------------------------------
// Purchase goal

export interface BuyingGoal {
  id: string;
  name: string;
  active: boolean;
  budgetMinBRL: number;
  budgetMaxBRL: number;
  minYear: number;
  maxMileageKm: number;
  requiredFeatures: string[]; // e.g. "CarPlay", "Reverse Camera", "ADAS"
  preferredBodyTypes: BodyType[];
  preferredBrands: string[];
  excludedBrandsModels: string[]; // free-text "Brand" or "Brand Model"
  fuelEconomyThresholdKmL: number;
  minResaleLiquidityScore: number; // 0-100, minimum acceptable
  familySpaceRequired: boolean;
}

export interface GoalMatch {
  carId: string;
  goalId: string;
  score: number; // 0-100
  matchedCriteria: string[];
  failedCriteria: string[];
  explanation: string;
}

// ---------------------------------------------------------------------------
// Documentation & risk review

export type CheckStatus = "verified" | "pending" | "warning" | "failed";
export type CheckSeverity = "low" | "medium" | "high" | "severe";

export type RiskCheckKey =
  | "registration_consistency"
  | "chassis_consistency"
  | "financing_lien"
  | "judicial_restriction"
  | "theft_recovery_history"
  | "recall_status"
  | "auction_history"
  | "accident_flags"
  | "mileage_inconsistency"
  | "overdue_taxes_fines"
  | "ownership_count"
  | "service_records"
  | "manual_key_availability";

export const RISK_CHECK_LABEL: Record<RiskCheckKey, string> = {
  registration_consistency: "Registration consistency",
  chassis_consistency: "Chassis consistency",
  financing_lien: "Financing / lien indicators",
  judicial_restriction: "Judicial restriction",
  theft_recovery_history: "Theft / recovery history",
  recall_status: "Recall status",
  auction_history: "Auction history",
  accident_flags: "Accident / sinistro flags",
  mileage_inconsistency: "Mileage inconsistency",
  overdue_taxes_fines: "Overdue taxes / fines",
  ownership_count: "Ownership count",
  service_records: "Service records",
  manual_key_availability: "Manual / key availability",
};

export interface RiskCheckItem {
  key: RiskCheckKey;
  status: CheckStatus;
  severity: CheckSeverity;
  notes: string;
  evidenceUrl?: string;
  checkedBy?: "manual" | "agent";
  checkedAt?: string; // ISO date
}

export interface CaixaReview {
  applicable: boolean;
  editalReviewed: boolean;
  hiddenTransferCostsBRL: number;
  resaleStigmaNote: string;
  historyClarity: "clear" | "partial" | "unclear";
  legalTransferRiskNote: string;
}

export interface RiskCheck {
  carId: string;
  items: RiskCheckItem[];
  caixaReview: CaixaReview;
  score: number; // 0-100, derived
}

// ---------------------------------------------------------------------------
// Condition review

export type ConditionRating = "good" | "fair" | "poor" | "not_inspected";

export interface ConditionField {
  key: string;
  label: string;
  rating: ConditionRating;
  notes: string;
}

export interface ConditionReview {
  carId: string;
  fields: ConditionField[];
  mechanicNotes: string;
  score: number; // 0-100, derived
}

// ---------------------------------------------------------------------------
// Market & valuation

export type MarketVerdict = "under_market" | "fair" | "overpriced" | "unavailable";
export type ResaleTimeBucket = "fast" | "moderate" | "slow";

export interface MarketAssessment {
  carId: string;
  askingPriceBRL: number;
  fipeValueBRL: number | null;
  fairMarketMinBRL: number | null;
  fairMarketMaxBRL: number | null;
  premiumOverFairPct: number | null; // negative = discount; null when FIPE unknown
  resaleEase: "high" | "medium" | "low";
  resaleTimeBucket: ResaleTimeBucket;
  verdict: MarketVerdict;
}

// ---------------------------------------------------------------------------
// Decision engine

export type Verdict =
  | "safe_buy"
  | "good_deal_verify"
  | "only_if_negotiated"
  | "avoid";

export const VERDICT_LABEL: Record<Verdict, string> = {
  safe_buy: "Safe Buy",
  good_deal_verify: "Good Deal but Verify",
  only_if_negotiated: "Only if Negotiated Down",
  avoid: "Avoid",
};

export interface ScoreWeights {
  goalFit: number;
  documentationRisk: number;
  condition: number;
  value: number;
  resaleLiquidity: number;
}

export const DEFAULT_WEIGHTS: ScoreWeights = {
  goalFit: 0.2,
  documentationRisk: 0.3,
  condition: 0.2,
  value: 0.15,
  resaleLiquidity: 0.15,
};

export interface DecisionResult {
  carId: string;
  goalFitScore: number;
  documentationRiskScore: number;
  conditionScore: number;
  valueScore: number | null; // null when FIPE not synced (excluded from weighted blend)
  resaleLiquidityScore: number;
  finalScore: number;
  verdict: Verdict;
  severeRiskGate: boolean; // true if a severe failed risk check clamped the verdict
  manualOverrideApplied: boolean;
  weights: ScoreWeights;
  reasoning: string[];
}

// ---------------------------------------------------------------------------
// Email report

export interface EmailReport {
  subject: string;
  generatedAt: string;
  carIds: string[];
  bodyMarkdown: string;
}
