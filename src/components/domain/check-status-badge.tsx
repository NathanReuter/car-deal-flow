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
