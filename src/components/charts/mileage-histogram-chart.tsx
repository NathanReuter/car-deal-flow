"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useChartColors } from "@/components/charts/chart-colors";

export function MileageHistogramChart({ mileages }: { mileages: number[] }) {
  const colors = useChartColors();

  if (mileages.length === 0) {
    return (
      <div className="flex h-[240px] items-center justify-center text-sm text-text-muted">
        No mileage data yet
      </div>
    );
  }

  const bucketSize = 20000;
  const maxKm = Math.max(...mileages);
  const bucketCount = Math.max(1, Math.ceil((maxKm + 1) / bucketSize));
  const buckets = Array.from({ length: bucketCount }, (_, i) => ({
    label: `${(i * bucketSize) / 1000}k–${((i + 1) * bucketSize) / 1000}k`,
    count: 0,
  }));

  for (const km of mileages) {
    const idx = Math.min(Math.floor(km / bucketSize), bucketCount - 1);
    buckets[idx].count += 1;
  }

  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={buckets} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.border} vertical={false} />
        <XAxis dataKey="label" tick={{ fill: colors.textMuted, fontSize: 11 }} axisLine={{ stroke: colors.border }} tickLine={false} />
        <YAxis tick={{ fill: colors.textMuted, fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
        <Tooltip
          contentStyle={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 12 }}
          cursor={{ fill: colors.surfaceHover }}
        />
        <Bar dataKey="count" fill={colors.success} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}
