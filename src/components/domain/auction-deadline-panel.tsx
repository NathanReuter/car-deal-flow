import type { LucideIcon } from "lucide-react";
import { CalendarClock, AlertTriangle, CheckCircle2, HelpCircle, Timer } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatAuctionDateTime, formatAuctionRelative } from "@/lib/format";
import {
  getAuctionDisplayStatus,
  type AuctionDisplayStatus,
  type AuctionUrgency,
} from "@/lib/auction-display";
import { cn } from "@/lib/utils";

const URGENCY_UI: Record<
  AuctionUrgency,
  {
    label: string;
    badge: "success" | "warning" | "danger" | "info" | "neutral";
    icon: LucideIcon;
    shell: string;
  }
> = {
  live: {
    label: "Auction scheduled",
    badge: "info",
    icon: CalendarClock,
    shell: "border-info/40 bg-info-bg",
  },
  soon: {
    label: "Auction soon",
    badge: "warning",
    icon: Timer,
    shell: "border-warning/50 bg-warning-bg",
  },
  ended: {
    label: "Auction ended",
    badge: "danger",
    icon: AlertTriangle,
    shell: "border-danger/40 bg-danger-bg",
  },
  expired_stage: {
    label: "Listing expired",
    badge: "danger",
    icon: AlertTriangle,
    shell: "border-danger/40 bg-danger-bg",
  },
  unknown: {
    label: "Auction date unknown",
    badge: "neutral",
    icon: HelpCircle,
    shell: "border-border bg-surface-hover/60",
  },
};

function headline(status: AuctionDisplayStatus): string {
  if (status.highlightDate) {
    return formatAuctionDateTime(status.highlightDate.toISOString());
  }
  if (status.urgency === "expired_stage") {
    return "Expired — no auction date on file";
  }
  return "Not captured at harvest";
}

function subline(status: AuctionDisplayStatus, stageReason?: string | null): string {
  if (status.highlightDate) {
    const relative = formatAuctionRelative(status.highlightDate.toISOString());
    if (status.fromNotesFallback) {
      return `${relative} · from harvest notes stamp`;
    }
    return relative;
  }
  if (status.urgency === "expired_stage" && stageReason) {
    return stageReason;
  }
  if (status.unknownSourceCount > 0) {
    return "Fail closed: date was not confidently extracted for one or more sources.";
  }
  return "No auction date available for this listing.";
}

export function AuctionDeadlinePanel({
  sources,
  notes,
  pipelineStage,
  stageReason,
}: {
  sources: { auctionDate: string | null }[];
  notes?: string | null;
  pipelineStage: string;
  stageReason?: string | null;
}) {
  const status = getAuctionDisplayStatus(
    sources.map((s) => ({
      auctionDate: s.auctionDate ? new Date(s.auctionDate) : null,
    })),
    { notes, pipelineStage },
  );
  const ui = URGENCY_UI[status.urgency];
  const Icon = ui.icon;

  return (
    <Card className={cn("border", ui.shell)} role="status" aria-live="polite">
      <CardContent className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-6">
        <div className="flex min-w-0 items-start gap-3">
          <span
            className={cn(
              "mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-md",
              status.urgency === "unknown" ? "bg-surface text-text-secondary" : "bg-surface/80",
            )}
          >
            <Icon className="h-5 w-5" aria-hidden />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={ui.badge}>{ui.label}</Badge>
              {status.fromNotesFallback && (
                <Badge variant="outline">Notes stamp</Badge>
              )}
              {status.fullyExpiredByDates && pipelineStage !== "expired" && (
                <Badge variant="warning">All known dates past</Badge>
              )}
            </div>
            <p className="mt-1.5 text-lg font-semibold tracking-tight text-text-primary tabular-nums">
              {headline(status)}
            </p>
            <p className="mt-0.5 text-sm text-text-secondary">{subline(status, stageReason)}</p>
          </div>
        </div>

        <dl className="grid shrink-0 grid-cols-2 gap-x-6 gap-y-1 text-xs sm:text-right">
          <div>
            <dt className="text-text-muted">Known sources</dt>
            <dd className="font-medium tabular-nums text-text-primary">
              {status.knownSourceCount}
              {status.unknownSourceCount > 0 ? (
                <span className="text-text-muted"> · {status.unknownSourceCount} unknown</span>
              ) : null}
            </dd>
          </div>
          <div>
            <dt className="text-text-muted">Expiry rule</dt>
            <dd className="inline-flex items-center gap-1 font-medium text-text-primary">
              {status.fullyExpiredByDates ? (
                <>
                  <CheckCircle2 className="h-3.5 w-3.5 text-danger" aria-hidden />
                  Eligible / past
                </>
              ) : (
                <>
                  <HelpCircle className="h-3.5 w-3.5 text-text-muted" aria-hidden />
                  Blocked if any date missing
                </>
              )}
            </dd>
          </div>
        </dl>
      </CardContent>
    </Card>
  );
}
