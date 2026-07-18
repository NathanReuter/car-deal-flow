import { Badge } from "@/components/ui/badge";
import { VERDICT_LABEL, type Verdict } from "@/lib/types";

const VARIANT: Record<Verdict, "success" | "warning" | "danger" | "neutral"> = {
  safe_buy: "success",
  good_deal_verify: "success",
  only_if_negotiated: "warning",
  avoid: "danger",
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <Badge variant={VARIANT[verdict]}>{VERDICT_LABEL[verdict]}</Badge>;
}
