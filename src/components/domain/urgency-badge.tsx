import { Badge } from "@/components/ui/badge";
import { urgencyBadge } from "@/lib/repasse-display";
import type { RepasseUrgency } from "@/lib/types";

/** Renders nothing when urgency is unknown (null/undefined). */
export function UrgencyBadge({ urgency }: { urgency: RepasseUrgency | null | undefined }) {
  const spec = urgencyBadge(urgency);
  if (!spec) return null;
  return <Badge variant={spec.variant}>{spec.label}</Badge>;
}
