import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  label,
  value,
  sublabel,
  icon: Icon,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sublabel?: string;
  icon?: React.ElementType;
  tone?: "neutral" | "success" | "warning" | "danger" | "info";
}) {
  const toneValue = {
    neutral: "text-text-primary",
    success: "text-success",
    warning: "text-warning",
    danger: "text-danger",
    info: "text-info",
  }[tone];

  const toneIcon = {
    neutral: "bg-surface-hover text-text-secondary",
    success: "bg-success-bg text-success",
    warning: "bg-warning-bg text-warning",
    danger: "bg-danger-bg text-danger",
    info: "bg-info-bg text-info",
  }[tone];

  const toneBorder = {
    neutral: "border-l-border",
    success: "border-l-success",
    warning: "border-l-warning",
    danger: "border-l-danger",
    info: "border-l-info",
  }[tone];

  return (
    <Card className={cn("border-l-[3px]", toneBorder)}>
      <CardHeader className="flex-row items-start justify-between space-y-0 pb-0">
        <span className="text-xs font-medium uppercase tracking-wide text-text-secondary">{label}</span>
        {Icon && (
          <span className={cn("flex h-8 w-8 items-center justify-center rounded-md", toneIcon)}>
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        )}
      </CardHeader>
      <CardContent className="pt-2">
        <div className={cn("text-2xl font-semibold tabular-nums tracking-tight", toneValue)}>{value}</div>
        {sublabel && <p className="mt-1 text-xs leading-snug text-text-secondary">{sublabel}</p>}
      </CardContent>
    </Card>
  );
}
