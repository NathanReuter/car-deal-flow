import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "../../src/generated/prisma/client";
import { requireDatabaseUrl } from "../lib/database-url";
import type {
  BodyType,
  ConditionField,
  DealPhase,
  FuelType,
  LeadConfidence,
  PipelineStage,
  RepasseUrgency,
  RiskCheckItem,
  RiskCheckKey,
  SellerType,
  SourceChannel,
  Transmission,
} from "../../src/lib/types";
import { normalizeChassis, normalizePlate, isMergeablePlate } from "./identity";
import {
  detectDamageSignals,
  type DamageSignalResult,
} from "../../src/lib/filters/damageSignals";
import { getNextAuctionDate } from "../../src/lib/auction";

const RISK_KEYS: RiskCheckKey[] = [
  "registration_consistency",
  "chassis_consistency",
  "financing_lien",
  "judicial_restriction",
  "theft_recovery_history",
  "recall_status",
  "auction_history",
  "accident_flags",
  "mileage_inconsistency",
  "overdue_taxes_fines",
  "ownership_count",
  "service_records",
  "manual_key_availability",
];

const CONDITION_FIELDS: { key: string; label: string }[] = [
  { key: "paint_body", label: "Paint / body mismatch" },
  { key: "tires", label: "Tires" },
  { key: "suspension_brakes", label: "Suspension / brakes" },
  { key: "engine", label: "Engine noise / leaks" },
  { key: "transmission_behavior", label: "Transmission behavior" },
  { key: "ac_electronics", label: "AC and electronics" },
  { key: "multimedia", label: "Multimedia quality" },
  { key: "interior_wear", label: "Seat / interior wear" },
  { key: "trunk_family", label: "Trunk / family usability" },
];

const VALID_SELLER_TYPES: SellerType[] = [
  "owner",
  "dealer",
  "auction",
  "bank_recovery",
  "caixa_recovery",
  "repasse",
];

const VALID_BODY_TYPES: BodyType[] = [
  "hatch",
  "sedan",
  "suv",
  "pickup",
  "minivan",
  "coupe",
  "wagon",
];

const VALID_SOURCE_CHANNELS: SourceChannel[] = [
  "classifieds",
  "aggregator",
  "messaging_group",
  "forum",
  "storefront",
  "auction_house",
];

const VALID_CONFIDENCES: LeadConfidence[] = ["low", "medium", "high"];

const AUCTION_HOUSE_PLATFORMS = new Set([
  "Bradesco Vitrine",
  "VIP Leilões",
  "BIDchain",
  "MGL",
  "Santander Retomados",
]);

/** Returns the default SourceChannel for a given sourcePlatform name. */
export function defaultChannelForPlatform(platform: string): SourceChannel {
  return AUCTION_HOUSE_PLATFORMS.has(platform) ? "auction_house" : "classifieds";
}

const PRICE_SEMANTICS_NOTE = "askingPriceBRL = minimum bid (lance mínimo).";

/** Stages that may be unconditionally reset to new_lead on re-harvest so the goal filter can re-run. */
const RESETTABLE_STAGES = new Set<PipelineStage>(["new_lead", "parked"]);
/** expired resets too, but only when a re-harvest shows a future auctionDate — see writeLead(). */

export interface WriteLeadInput {
  brand: string;
  model: string;
  year: number;
  /** Required for auction leads. For pre_repossession leads it is DERIVED
   * (entrada + saldo devedor) and must not be supplied. */
  askingPriceBRL?: number;
  /** Defaults to "auction". */
  dealPhase?: DealPhase;
  // Repasse economics — pre_repossession only. null = ad did not disclose.
  entryAskBRL?: number | null;
  outstandingDebtBRL?: number | null;
  installmentBRL?: number | null;
  installmentsRemaining?: number | null;
  /** One contact handle max (LGPD); stored only in its column, never in notes. */
  sellerContact?: string | null;
  repasseUrgency?: RepasseUrgency | null;
  sourceUrl: string;
  sourcePlatform: string;
  sellerType: SellerType;
  bodyType: BodyType;
  trim?: string;
  modelYear?: number;
  mileageKm?: number | null;
  plate?: string;
  chassis?: string;
  photos?: string[];
  city?: string;
  state?: string;
  fuel?: FuelType;
  transmission?: Transmission;
  color?: string;
  notes?: string;
  editalUrl?: string;
  /** When this source's auction happens. Undefined/unparseable → null, never guessed. */
  auctionDate?: Date | null;
  /** Bypass damage/sinistro gate (owner override only). */
  forceDamaged?: boolean;
  /** Channel through which the lead was sourced. Defaults to defaultChannelForPlatform(sourcePlatform). */
  sourceChannel?: SourceChannel;
  /** Confidence in the lead data quality. Defaults to "high". */
  confidence?: LeadConfidence;
}

export class WriteLeadError extends Error {}

export interface WriteLeadResult {
  carId: string;
  created: boolean;
  updated: boolean;
  merged: boolean;
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new WriteLeadError(`Missing required field: ${field}`);
  }
  return value.trim();
}

function requireNumber(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new WriteLeadError(`Missing required field: ${field}`);
  }
  return value;
}

/** undefined/null → null; otherwise must be a finite number >= 0. */
function optionalMoney(value: number | null | undefined, field: string): number | null {
  if (value === undefined || value === null) return null;
  if (!Number.isFinite(value) || value < 0) {
    throw new WriteLeadError(`Invalid ${field}: must be a finite number >= 0 or null`);
  }
  return value;
}

interface RepasseColumns {
  dealPhase: DealPhase;
  entryAskBRL: number | null;
  outstandingDebtBRL: number | null;
  installmentBRL: number | null;
  installmentsRemaining: number | null;
  sellerContact: string | null;
  repasseUrgency: RepasseUrgency | null;
}

/** Enforces the repasse pricing rule: askingPriceBRL is derived, never guessed.
 * Entrada unknown → no price anchor → reject. Saldo unknown → entrada only,
 * flagged as needs-research in the price note. */
function resolvePricing(input: WriteLeadInput): {
  dealPhase: DealPhase;
  askingPriceBRL: number;
  priceNote: string;
  repasseColumns: Partial<RepasseColumns>;
} {
  const dealPhase = input.dealPhase ?? "auction";
  if (dealPhase !== "auction" && dealPhase !== "pre_repossession" && dealPhase !== "market") {
    throw new WriteLeadError(`Invalid dealPhase: ${String(dealPhase)}`);
  }
  if (
    input.repasseUrgency != null &&
    !["high", "medium", "low"].includes(input.repasseUrgency)
  ) {
    throw new WriteLeadError(`Invalid repasseUrgency: ${String(input.repasseUrgency)}`);
  }

  if (dealPhase === "auction" || dealPhase === "market") {
    // Repasse economics fields are forbidden for auction and market leads.
    if (input.entryAskBRL !== undefined && input.entryAskBRL !== null) {
      throw new WriteLeadError(
        `${dealPhase} leads must not supply entryAskBRL — repasse fields are forbidden.`,
      );
    }
    if (dealPhase === "market") {
      if (input.outstandingDebtBRL !== undefined && input.outstandingDebtBRL !== null) {
        throw new WriteLeadError(
          "market leads must not supply outstandingDebtBRL — repasse fields are forbidden.",
        );
      }
      if (input.installmentBRL !== undefined && input.installmentBRL !== null) {
        throw new WriteLeadError(
          "market leads must not supply installmentBRL — repasse fields are forbidden.",
        );
      }
      if (input.installmentsRemaining !== undefined && input.installmentsRemaining !== null) {
        throw new WriteLeadError(
          "market leads must not supply installmentsRemaining — repasse fields are forbidden.",
        );
      }
    }
    return {
      dealPhase,
      askingPriceBRL: requireNumber(input.askingPriceBRL, "askingPriceBRL"),
      priceNote: PRICE_SEMANTICS_NOTE,
      repasseColumns: { dealPhase },
    };
  }

  if (input.askingPriceBRL !== undefined) {
    throw new WriteLeadError(
      "Repasse leads derive askingPriceBRL from entrada + saldo — do not supply it.",
    );
  }

  const entry = optionalMoney(input.entryAskBRL, "entryAskBRL");
  if (entry === null) {
    throw new WriteLeadError(
      "Repasse lead without entrada (entryAskBRL) has no price anchor — refusing to guess.",
    );
  }
  const debt = optionalMoney(input.outstandingDebtBRL, "outstandingDebtBRL");
  const askingPriceBRL = entry + (debt ?? 0);
  if (askingPriceBRL <= 0) {
    throw new WriteLeadError("Repasse lead resolves to askingPriceBRL <= 0 — refusing to write.");
  }

  return {
    dealPhase,
    askingPriceBRL,
    priceNote:
      debt !== null
        ? `askingPriceBRL = entrada R$ ${entry} + saldo devedor R$ ${debt}.`
        : `askingPriceBRL = entrada R$ ${entry}; saldo devedor não informado — needs research.`,
    repasseColumns: {
      dealPhase,
      entryAskBRL: entry,
      outstandingDebtBRL: debt,
      installmentBRL: optionalMoney(input.installmentBRL, "installmentBRL"),
      installmentsRemaining: optionalMoney(input.installmentsRemaining, "installmentsRemaining"),
      sellerContact: input.sellerContact?.trim() || null,
      repasseUrgency: input.repasseUrgency ?? null,
    },
  };
}

function buildRiskItems(
  mileageKm: number | null,
  damage?: DamageSignalResult,
): RiskCheckItem[] {
  return RISK_KEYS.map((key) => {
    if (key === "accident_flags" && damage?.blocked) {
      return {
        key,
        status: "failed" as const,
        severity: "high" as const,
        notes: `Listing damage flags: ${damage.reasons.join("; ")}`,
      };
    }
    if (key === "mileage_inconsistency" && mileageKm === null) {
      return {
        key,
        status: "warning" as const,
        severity: "medium" as const,
        notes: "Mileage not disclosed on the auction/repossession listing — absence is itself a risk signal.",
      };
    }
    return {
      key,
      status: "pending" as const,
      severity: "low" as const,
      notes: "Not yet reviewed.",
    };
  });
}

function assertAllowedNotes(notes: string, forceDamaged?: boolean): void {
  const damage = detectDamageSignals(notes);
  if (damage.blocked && !forceDamaged) {
    throw new WriteLeadError(
      `Listing shows damage/sinistro (${damage.reasons.join(", ")}). Only integral/conservado inventory is wanted. Pass --force-damaged to override.`,
    );
  }
}

function buildConditionFields(): ConditionField[] {
  return CONDITION_FIELDS.map((f) => ({
    key: f.key,
    label: f.label,
    rating: "not_inspected" as const,
    notes: "Not yet inspected.",
  }));
}

function mergeNotes(existing: string | undefined, extra: string[]): string {
  const parts = [existing?.trim(), ...extra].filter((p): p is string => Boolean(p && p.length > 0));
  const unique: string[] = [];
  for (const p of parts) {
    if (!unique.includes(p)) unique.push(p);
  }
  return unique.join(" ");
}

function appendMissingNotes(existingNotes: string, fragments: string[]): string {
  let notes = existingNotes.trim();
  for (const fragment of fragments) {
    if (!notes.includes(fragment)) {
      notes = notes.length > 0 ? `${notes} ${fragment}` : fragment;
    }
  }
  return notes;
}

function requireHttpUrl(value: string, field: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new WriteLeadError(`Invalid ${field}: must be an absolute http(s) URL`);
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new WriteLeadError(`Invalid ${field}: only http(s) URLs are allowed`);
  }
  return value;
}

async function syncRiskCheckOnUpdate(
  prisma: PrismaClient,
  carId: string,
  mileageKm: number | null,
  sellerType: SellerType,
): Promise<void> {
  const riskCheck = await prisma.riskCheck.findUnique({ where: { carId } });
  if (!riskCheck) return;

  const items = JSON.parse(riskCheck.items) as RiskCheckItem[];
  const index = items.findIndex((i) => i.key === "mileage_inconsistency");
  if (index !== -1) {
    if (mileageKm === null) {
      items[index] = {
        ...items[index],
        status: "warning",
        severity: "medium",
        notes: "Mileage not disclosed on the auction/repossession listing — absence is itself a risk signal.",
      };
    } else if (items[index].status === "warning" && items[index].notes.includes("not disclosed")) {
      // Clear the auto-warning once mileage appears; leave manually reviewed items alone.
      items[index] = {
        ...items[index],
        status: "pending",
        severity: "low",
        notes: "Not yet reviewed.",
        checkedBy: undefined,
        checkedAt: undefined,
      };
    }
  }

  const caixaApplicable = sellerType === "caixa_recovery";
  await prisma.riskCheck.update({
    where: { carId },
    data: {
      items: JSON.stringify(items),
      caixaApplicable,
      ...(caixaApplicable && !riskCheck.caixaApplicable
        ? { caixaHistoryClarity: "unclear" }
        : {}),
    },
  });
}

export async function writeLead(prisma: PrismaClient, input: WriteLeadInput): Promise<WriteLeadResult> {
  const brand = requireString(input.brand, "brand");
  const model = requireString(input.model, "model");
  const year = requireNumber(input.year, "year");
  const { dealPhase, askingPriceBRL, priceNote, repasseColumns } = resolvePricing(input);
  const sourceUrl = requireHttpUrl(requireString(input.sourceUrl, "sourceUrl"), "sourceUrl");
  const sourcePlatform = requireString(input.sourcePlatform, "sourcePlatform");
  const sellerType = input.sellerType;
  const bodyType = input.bodyType;

  if (!VALID_SELLER_TYPES.includes(sellerType)) {
    throw new WriteLeadError(`Invalid sellerType: ${String(sellerType)}`);
  }
  if (!VALID_BODY_TYPES.includes(bodyType)) {
    throw new WriteLeadError(`Invalid or missing bodyType: ${String(bodyType)}`);
  }

  if (input.sourceChannel !== undefined && !VALID_SOURCE_CHANNELS.includes(input.sourceChannel)) {
    throw new WriteLeadError(`Invalid sourceChannel: ${String(input.sourceChannel)}`);
  }
  if (input.confidence !== undefined && !VALID_CONFIDENCES.includes(input.confidence)) {
    throw new WriteLeadError(`Invalid confidence: ${String(input.confidence)}`);
  }

  const resolvedSourceChannel: SourceChannel =
    input.sourceChannel ?? defaultChannelForPlatform(sourcePlatform);
  const resolvedConfidence: LeadConfidence = input.confidence ?? "high";

  if (input.editalUrl !== undefined && input.editalUrl.trim() !== "") {
    requireHttpUrl(input.editalUrl.trim(), "editalUrl");
  }

  let mileageKm = input.mileageKm === undefined ? null : input.mileageKm;
  if (mileageKm !== null && !Number.isFinite(mileageKm)) {
    throw new WriteLeadError("Invalid mileageKm: must be a finite number or null");
  }
  if (mileageKm !== null && mileageKm < 0) {
    throw new WriteLeadError("Invalid mileageKm: must be >= 0");
  }
  // P1: null-out mileage values that exceed the physical plausibility ceiling.
  // Values > 2_000_000 km were produced by a prior parseKm bug that concatenated
  // year/engine digits into the reading. Any surviving rows are cleaned by
  // migration 20260721000000_sanitize_mileage_bounds; new rows are rejected here.
  if (mileageKm !== null && mileageKm > 2_000_000) {
    mileageKm = null;
  }

  const trim = input.trim?.trim() ?? "";
  const modelYear = input.modelYear ?? year;
  const city = input.city?.trim() || "Unknown";
  const state = input.state?.trim() || "??";
  const fuel = input.fuel ?? "flex";
  const transmission = input.transmission ?? "automatic";
  const color = input.color?.trim() || "Unknown";
  const photos = input.photos ?? [];

  const inferenceNotes: string[] = [priceNote];
  if (!input.fuel) inferenceNotes.push("fuel defaulted to flex (not stated on listing).");
  if (!input.transmission) inferenceNotes.push("transmission defaulted to automatic (not stated on listing).");
  if (!input.city) inferenceNotes.push("city Unknown (not stated on listing).");
  if (!input.state) inferenceNotes.push("state ?? (not stated on listing).");

  const plateProvided = input.plate !== undefined;
  const chassisProvided = input.chassis !== undefined;
  const plate = plateProvided ? normalizePlate(input.plate) : undefined;
  const chassis = chassisProvided ? normalizeChassis(input.chassis) : undefined;

  const listingFieldsBase = {
    brand,
    model,
    trim,
    year,
    modelYear,
    mileageKm,
    askingPriceBRL,
    city,
    state,
    sellerType,
    fuel,
    transmission,
    bodyType,
    color,
    photos: JSON.stringify(photos),
    ...repasseColumns,
  };

  const editalUrl = input.editalUrl?.trim() || null;
  const auctionDate = input.auctionDate === undefined ? null : input.auctionDate;

  const existingByUrl = await prisma.car.findUnique({ where: { sourceUrl } });

  if (existingByUrl) {
    const stage = existingByUrl.pipelineStage as PipelineStage;
    let canResetStage = RESETTABLE_STAGES.has(stage);
    if (!canResetStage && stage === "expired") {
      const otherSources = await prisma.carSource.findMany({
        where: { carId: existingByUrl.id, NOT: { sourceUrl } },
        select: { auctionDate: true },
      });
      canResetStage =
        getNextAuctionDate([...otherSources, { auctionDate }]) !== null;
    }

    const nextPlate = plateProvided ? plate! : existingByUrl.plate;
    const nextChassis = chassisProvided ? chassis! : existingByUrl.chassis;

    await assertNoIdentityCollision(prisma, existingByUrl.id, nextChassis, nextPlate);

    const notes = appendMissingNotes(
      mergeNotes(existingByUrl.notes, input.notes ? [input.notes.trim()] : []),
      inferenceNotes,
    );

    assertAllowedNotes(notes, input.forceDamaged);

    await prisma.car.update({
      where: { id: existingByUrl.id },
      data: {
        ...listingFieldsBase,
        plate: nextPlate,
        chassis: nextChassis,
        // Keep primary platform as first-wins; still refresh listing scalars.
        sourcePlatform: existingByUrl.sourcePlatform,
        notes,
        ...(canResetStage ? { pipelineStage: "new_lead", stageReason: null } : {}),
      },
    });

    await syncRiskCheckOnUpdate(prisma, existingByUrl.id, mileageKm, sellerType);
    await upsertCarSource(prisma, {
      carId: existingByUrl.id,
      sourceUrl,
      sourcePlatform,
      editalUrl,
      auctionDate,
    });

    if (editalUrl) {
      await upsertEditalAttachment(prisma, existingByUrl.id, editalUrl);
    }

    return { carId: existingByUrl.id, created: false, updated: true, merged: false };
  }

  const mergeTarget = await findMergeTarget(
    prisma,
    chassisProvided ? chassis! : null,
    plateProvided ? plate! : null,
  );

  if (mergeTarget) {
    const disagreementNotes: string[] = [];
    const scalarPatch: Record<string, unknown> = {};

    const mergeScalar = (
      key: "mileageKm" | "plate" | "chassis" | "color",
      label: string,
      incoming: string | number | null | undefined,
    ) => {
      if (incoming == null || incoming === "") return;
      const current = mergeTarget[key];
      if (current == null || current === "") {
        scalarPatch[key] = incoming;
        return;
      }
      if (String(current) !== String(incoming)) {
        disagreementNotes.push(
          `Source ${sourcePlatform} disagrees on ${label}: kept ${String(current)}, saw ${String(incoming)}.`,
        );
      }
    };

    // A repasse lead reappearing at auction means the pre-repossession window
    // closed — the bank took the car. Flip the phase and stamp the signal.
    if (mergeTarget.dealPhase === "pre_repossession" && dealPhase === "auction") {
      scalarPatch.dealPhase = "auction";
      disagreementNotes.push(
        `Janela de repasse fechada — carro reapareceu em leilão (${sourcePlatform}).`,
      );
    }

    mergeScalar("mileageKm", "mileage", mileageKm);
    if (plateProvided) mergeScalar("plate", "plate", plate!);
    if (chassisProvided) mergeScalar("chassis", "chassis", chassis!);
    mergeScalar("color", "color", color);
    // Price / year / body often differ across houses — note only, keep first.
    if (mergeTarget.askingPriceBRL !== askingPriceBRL) {
      disagreementNotes.push(
        `Source ${sourcePlatform} disagrees on price: kept ${mergeTarget.askingPriceBRL}, saw ${askingPriceBRL}.`,
      );
    }

    const notes = appendMissingNotes(
      mergeNotes(mergeTarget.notes, [
        ...(input.notes ? [input.notes.trim()] : []),
        ...disagreementNotes,
      ]),
      inferenceNotes,
    );

    assertAllowedNotes(notes, input.forceDamaged);

    await prisma.car.update({
      where: { id: mergeTarget.id },
      data: {
        ...scalarPatch,
        notes,
        // Never change primary sourceUrl/sourcePlatform; never reset stage on merge.
      },
    });

    await upsertCarSource(prisma, {
      carId: mergeTarget.id,
      sourceUrl,
      sourcePlatform,
      editalUrl,
      auctionDate,
    });

    if (editalUrl) {
      await upsertEditalAttachment(prisma, mergeTarget.id, editalUrl);
    }

    return { carId: mergeTarget.id, created: false, updated: false, merged: true };
  }

  const notes = mergeNotes(input.notes, inferenceNotes);
  assertAllowedNotes(notes, input.forceDamaged);
  const damage = detectDamageSignals(notes);

  const car = await prisma.car.create({
    data: {
      ...listingFieldsBase,
      sourceUrl,
      sourcePlatform,
      sourceChannel: resolvedSourceChannel,
      confidence: resolvedConfidence,
      plate: plateProvided ? plate! : null,
      chassis: chassisProvided ? chassis! : null,
      notes,
      pipelineStage: "new_lead",
      stageReason: null,
      fipeValueBRL: null,
    },
  });

  const caixaApplicable = sellerType === "caixa_recovery";
  await prisma.riskCheck.create({
    data: {
      carId: car.id,
      items: JSON.stringify(buildRiskItems(mileageKm, damage)),
      caixaApplicable,
      caixaEditalReviewed: false,
      caixaHiddenTransferCosts: 0,
      caixaResaleStigmaNote: "",
      caixaHistoryClarity: caixaApplicable ? "unclear" : "clear",
      caixaLegalTransferRisk: "",
    },
  });

  await prisma.conditionReview.create({
    data: {
      carId: car.id,
      fields: JSON.stringify(buildConditionFields()),
      mechanicNotes: "No inspection performed yet.",
    },
  });

  await upsertCarSource(prisma, {
    carId: car.id,
    sourceUrl,
    sourcePlatform,
    editalUrl,
    auctionDate,
  });

  if (editalUrl) {
    await upsertEditalAttachment(prisma, car.id, editalUrl);
  }

  return { carId: car.id, created: true, updated: false, merged: false };
}

async function assertNoIdentityCollision(
  prisma: PrismaClient,
  carId: string,
  chassis: string | null,
  plate: string | null,
): Promise<void> {
  if (chassis) {
    const other = await prisma.car.findFirst({
      where: { chassis, NOT: { id: carId } },
    });
    if (other) {
      throw new WriteLeadError(
        `chassis ${chassis} already belongs to car ${other.id}`,
      );
    }
  }
  if (isMergeablePlate(plate)) {
    const other = await prisma.car.findFirst({
      where: { plate, NOT: { id: carId } },
    });
    if (other) {
      throw new WriteLeadError(
        `plate ${plate} already belongs to car ${other.id}`,
      );
    }
  }
}

async function findMergeTarget(
  prisma: PrismaClient,
  chassis: string | null,
  plate: string | null,
) {
  if (chassis) {
    const byChassis = await prisma.car.findFirst({ where: { chassis } });
    if (byChassis) return byChassis;
  }
  if (isMergeablePlate(plate)) {
    const byPlate = await prisma.car.findFirst({ where: { plate } });
    if (byPlate) return byPlate;
  }
  return null;
}

async function upsertCarSource(
  prisma: PrismaClient,
  args: {
    carId: string;
    sourceUrl: string;
    sourcePlatform: string;
    editalUrl: string | null;
    auctionDate: Date | null;
  },
): Promise<void> {
  const now = new Date();
  await prisma.carSource.upsert({
    where: { sourceUrl: args.sourceUrl },
    create: {
      carId: args.carId,
      sourceUrl: args.sourceUrl,
      sourcePlatform: args.sourcePlatform,
      editalUrl: args.editalUrl,
      auctionDate: args.auctionDate,
      lastSeenAt: now,
    },
    update: {
      lastSeenAt: now,
      sourcePlatform: args.sourcePlatform,
      auctionDate: args.auctionDate,
      ...(args.editalUrl ? { editalUrl: args.editalUrl } : {}),
    },
  });
}

async function upsertEditalAttachment(prisma: PrismaClient, carId: string, url: string): Promise<void> {
  const existing = await prisma.attachment.findFirst({
    where: { carId, url, kind: "document" },
  });
  if (existing) {
    await prisma.attachment.update({
      where: { id: existing.id },
      data: { label: "Edital PDF" },
    });
    return;
  }
  await prisma.attachment.create({
    data: {
      carId,
      label: "Edital PDF",
      kind: "document",
      url,
    },
  });
}

function parseArgs(argv: string[]): WriteLeadInput {
  const get = (flag: string): string | undefined => {
    const i = argv.indexOf(flag);
    return i === -1 ? undefined : argv[i + 1];
  };

  const brand = get("--brand");
  const model = get("--model");
  const year = get("--year");
  const price = get("--price");
  const sourceUrl = get("--source-url");
  const sourcePlatform = get("--source-platform");
  const sellerType = get("--seller-type") as SellerType | undefined;
  const bodyType = get("--body-type") as BodyType | undefined;
  const dealPhase = get("--deal-phase") as DealPhase | undefined;

  // Repasse leads derive price from entrada + saldo; auction leads require --price.
  const priceRequired = dealPhase !== "pre_repossession";
  if (!brand || !model || !year || (priceRequired && !price) || !sourceUrl || !sourcePlatform || !sellerType || !bodyType) {
    throw new WriteLeadError(
      "Usage: write-lead.ts --brand <b> --model <m> --year <y> --price <n> --source-url <url> --source-platform <p> --seller-type <t> --body-type <bt> [--deal-phase pre_repossession --entry-ask <n> [--outstanding-debt <n|null>] [--installment <n|null>] [--installments-remaining <n|null>] [--seller-contact <c>] [--repasse-urgency <high|medium|low>]] [--trim ...] [--mileage <n|null>] [--edital-url <url>]",
    );
  }

  const optNum = (flag: string): number | null | undefined => {
    const raw = get(flag);
    if (raw === undefined) return undefined;
    if (raw === "null" || raw === "") return null;
    return Number(raw);
  };

  const mileageRaw = get("--mileage");
  let mileageKm: number | null | undefined;
  if (mileageRaw === undefined) mileageKm = undefined;
  else if (mileageRaw === "null" || mileageRaw === "") mileageKm = null;
  else mileageKm = Number(mileageRaw);

  const auctionDateRaw = get("--auction-date");
  let auctionDate: Date | null | undefined;
  if (auctionDateRaw === undefined) auctionDate = undefined;
  else {
    const parsed = new Date(auctionDateRaw);
    auctionDate = Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  return {
    brand,
    model,
    year: Number(year),
    askingPriceBRL: price === undefined ? undefined : Number(price),
    dealPhase,
    entryAskBRL: optNum("--entry-ask"),
    outstandingDebtBRL: optNum("--outstanding-debt"),
    installmentBRL: optNum("--installment"),
    installmentsRemaining: optNum("--installments-remaining"),
    sellerContact: get("--seller-contact"),
    repasseUrgency: get("--repasse-urgency") as RepasseUrgency | undefined,
    sourceUrl,
    sourcePlatform,
    sellerType,
    bodyType,
    trim: get("--trim"),
    mileageKm,
    plate: get("--plate"),
    chassis: get("--chassis"),
    city: get("--city"),
    state: get("--state"),
    notes: get("--notes"),
    editalUrl: get("--edital-url"),
    auctionDate,
    forceDamaged: argv.includes("--force-damaged"),
    sourceChannel: get("--source-channel") as SourceChannel | undefined,
    confidence: get("--confidence") as LeadConfidence | undefined,
  };
}

async function main() {
  const input = parseArgs(process.argv.slice(2));
  const adapter = new PrismaBetterSqlite3({ url: requireDatabaseUrl() });
  const prisma = new PrismaClient({ adapter });
  try {
    const result = await writeLead(prisma, input);
    console.log(JSON.stringify(result));
  } finally {
    await prisma.$disconnect();
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  });
}
