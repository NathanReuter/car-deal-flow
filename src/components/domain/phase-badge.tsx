import { Badge } from "@/components/ui/badge";
import { phaseBadge } from "@/lib/repasse-display";
import type { DealPhase } from "@/lib/types";

export function PhaseBadge({ dealPhase }: { dealPhase?: DealPhase }) {
  const spec = phaseBadge(dealPhase);
  return <Badge variant={spec.variant}>{spec.label}</Badge>;
}
