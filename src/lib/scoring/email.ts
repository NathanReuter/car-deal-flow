import type { Car, DecisionResult, EmailReport, MarketAssessment, RiskCheck } from "@/lib/types";
import { VERDICT_LABEL } from "@/lib/types";
import { formatBRL, formatFipe, formatKm, formatDate } from "@/lib/format";

interface CarBundle {
  car: Car;
  decision: DecisionResult;
  market: MarketAssessment;
  risk: RiskCheck;
}

function carSection(bundle: CarBundle): string {
  const { car, decision, market, risk } = bundle;
  const positives: string[] = [];
  const risks: string[] = [];

  if (market.verdict === "under_market" && market.fipeValueBRL !== null) {
    positives.push(`Priced below FIPE-based fair range (${formatFipe(market.fipeValueBRL)} FIPE).`);
  }
  if (decision.conditionScore >= 80) positives.push("Condition review shows no material issues.");
  if (decision.goalFitScore >= 80) positives.push("Strong match against the active buying goal.");
  if (decision.resaleLiquidityScore >= 80) positives.push("High resale liquidity — fast expected resale.");
  if (positives.length === 0) positives.push("No standout positives beyond baseline eligibility.");

  const severeItems = risk.items.filter((i) => i.severity === "severe" || i.status === "failed");
  for (const item of severeItems) risks.push(`${item.key.replaceAll("_", " ")}: ${item.notes}`);
  if (market.verdict === "overpriced" && market.premiumOverFairPct !== null) {
    risks.push(`Priced ${market.premiumOverFairPct.toFixed(1)}% above fair market range.`);
  }
  if (market.verdict === "unavailable") {
    risks.push("FIPE not synced — market value comparison unavailable.");
  }
  if (risks.length === 0) risks.push("No material risks flagged.");

  const nextActions: string[] = [];
  if (decision.verdict === "safe_buy") nextActions.push("Proceed to final document signing and schedule handover inspection.");
  if (decision.verdict === "good_deal_verify") nextActions.push("Verify pending checklist items before making an offer.");
  if (decision.verdict === "only_if_negotiated") {
    const target =
      market.fairMarketMinBRL !== null
        ? `toward ${formatBRL(market.fairMarketMinBRL)}`
        : "toward a FIPE-based fair range (sync FIPE first)";
    nextActions.push(`Negotiate price down ${target} or address the flagged risk before proceeding.`);
  }
  if (decision.verdict === "avoid") nextActions.push("Do not proceed — risk or condition profile is unacceptable for this goal.");

  const fairRange =
    market.fairMarketMinBRL !== null && market.fairMarketMaxBRL !== null
      ? `${formatBRL(market.fairMarketMinBRL)} – ${formatBRL(market.fairMarketMaxBRL)}`
      : "FIPE not synced";

  return [
    `### ${car.brand} ${car.model} ${car.trim} (${car.year}) — ${formatBRL(car.askingPriceBRL)}`,
    `**Verdict: ${VERDICT_LABEL[decision.verdict]}** (score ${decision.finalScore}/100)`,
    ``,
    `- Location: ${car.city}/${car.state} · ${formatKm(car.mileageKm)} · Seller: ${car.sellerType.replaceAll("_", " ")}`,
    `- Fair market range: ${fairRange}`,
    ``,
    `**Positives**`,
    ...positives.map((p) => `- ${p}`),
    ``,
    `**Risks**`,
    ...risks.map((r) => `- ${r}`),
    ``,
    `**Next actions**`,
    ...nextActions.map((a) => `- ${a}`),
  ].join("\n");
}

export function generateEmailReport(bundles: CarBundle[], kind: "single" | "shortlist" | "digest"): EmailReport {
  const subjectMap = {
    single: `Car Deal Flow — Vehicle Report: ${bundles[0]?.car.brand} ${bundles[0]?.car.model}`,
    shortlist: `Car Deal Flow — Shortlist Summary (${bundles.length} vehicles)`,
    digest: `Car Deal Flow — Daily Digest (${formatDate(new Date().toISOString())})`,
  };

  const intro =
    kind === "digest"
      ? `Here is your daily digest of tracked vehicles and their current decision status.`
      : kind === "shortlist"
        ? `Summary of your current shortlist, ranked by final weighted score.`
        : `Full decision breakdown for the selected vehicle.`;

  const body = [
    `# ${subjectMap[kind]}`,
    ``,
    intro,
    ``,
    ...bundles.map(carSection),
  ].join("\n\n");

  return {
    subject: subjectMap[kind],
    generatedAt: new Date().toISOString(),
    carIds: bundles.map((b) => b.car.id),
    bodyMarkdown: body,
  };
}
