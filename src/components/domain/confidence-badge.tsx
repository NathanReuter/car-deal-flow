import { Badge } from "@/components/ui/badge";
import { confidenceBadge } from "@/lib/repasse-display";
import type { LeadConfidence } from "@/lib/types";

/** Renders nothing when confidence is high or undefined (high is default; badge only for low/medium). */
export function ConfidenceBadge({ confidence }: { confidence?: LeadConfidence }) {
  const spec = confidenceBadge(confidence);
  if (!spec) return null;
  return <Badge variant={spec.variant}>{spec.label}</Badge>;
}
