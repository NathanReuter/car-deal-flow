"use client";

import { Bar, BarChart, CartesianGrid, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useChartColors } from "@/components/charts/chart-colors";
import { PIPELINE_STAGES, type PipelineStage } from "@/lib/types";

export function PipelineFunnelChart({ counts }: { counts: Record<PipelineStage, number> }) {
  const colors = useChartColors();
  const data = PIPELINE_STAGES.map((s) => ({ label: s.label, count: counts[s.id] ?? 0 }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 16, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: colors.textMuted, fontSize: 11 }}
          angle={-25}
          textAnchor="end"
          height={56}
          axisLine={{ stroke: colors.border }}
          tickLine={false}
        />
        <YAxis tick={{ fill: colors.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{
            background: colors.surface,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            fontSize: 12,
            color: colors.textSecondary,
          }}
          cursor={{ fill: colors.surfaceHover }}
        />
        <Bar dataKey="count" fill={colors.accent} radius={[4, 4, 0, 0]} maxBarSize={48}>
          <LabelList dataKey="count" position="top" fill={colors.textSecondary} fontSize={11} />
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
