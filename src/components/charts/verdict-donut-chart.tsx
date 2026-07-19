"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { useChartColors } from "@/components/charts/chart-colors";
import { VERDICT_LABEL, type Verdict } from "@/lib/types";

export function VerdictDonutChart({ counts }: { counts: Record<Verdict, number> }) {
  const colors = useChartColors();
  const verdictColors: Record<Verdict, string> = {
    safe_buy: colors.success,
    good_deal_verify: colors.info,
    only_if_negotiated: colors.warning,
    avoid: colors.danger,
  };

  const data = (Object.keys(VERDICT_LABEL) as Verdict[])
    .map((v) => ({ name: VERDICT_LABEL[v], value: counts[v] ?? 0, color: verdictColors[v] }))
    .filter((d) => d.value > 0);

  const total = data.reduce((sum, d) => sum + d.value, 0);

  if (total === 0) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-text-secondary">
        No verdicts yet
      </div>
    );
  }

  return (
    <div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-center">
      <div className="relative mx-auto w-full max-w-[200px] shrink-0">
        <ResponsiveContainer width="100%" height={200}>
          <PieChart>
            <Pie
              data={data}
              dataKey="value"
              nameKey="name"
              innerRadius={52}
              outerRadius={78}
              paddingAngle={2}
              strokeWidth={0}
            >
              {data.map((d) => (
                <Cell key={d.name} fill={d.color} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: colors.surface,
                border: `1px solid ${colors.border}`,
                borderRadius: 8,
                fontSize: 12,
                color: colors.textSecondary,
              }}
            />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xl font-semibold tabular-nums text-text-primary">{total}</span>
          <span className="text-[11px] text-text-muted">vehicles</span>
        </div>
      </div>
      <ul className="flex min-w-0 flex-1 flex-col gap-2 text-xs">
        {data.map((d) => {
          const pct = Math.round((d.value / total) * 100);
          return (
            <li key={d.name} className="flex items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ background: d.color }} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-text-secondary">{d.name}</span>
              <span className="shrink-0 font-semibold tabular-nums text-text-primary">{d.value}</span>
              <span className="w-8 shrink-0 text-right tabular-nums text-text-muted">{pct}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
