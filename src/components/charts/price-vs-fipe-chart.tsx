"use client";

import {
  CartesianGrid,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { useChartColors } from "@/components/charts/chart-colors";
import { formatBRL } from "@/lib/format";

interface Point {
  label: string;
  fipe: number;
  asking: number;
}

export function PriceVsFipeChart({ data }: { data: Point[] }) {
  const colors = useChartColors();

  if (data.length === 0) {
    return (
      <div className="flex h-[260px] items-center justify-center text-sm text-text-muted">
        No FIPE-synced prices yet
      </div>
    );
  }

  const domainMax = Math.max(...data.map((d) => Math.max(d.fipe, d.asking))) * 1.08;
  const domainMin = Math.min(...data.map((d) => Math.min(d.fipe, d.asking))) * 0.92;

  return (
    <ResponsiveContainer width="100%" height={260}>
      <ScatterChart margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={colors.border} />
        <XAxis
          type="number"
          dataKey="fipe"
          name="FIPE"
          domain={[domainMin, domainMax]}
          tickFormatter={(v) => `${Math.round(v / 1000)}k`}
          tick={{ fill: colors.textMuted, fontSize: 11 }}
          axisLine={{ stroke: colors.border }}
          tickLine={false}
          label={{ value: "FIPE (R$)", position: "insideBottom", offset: -4, fill: colors.textMuted, fontSize: 11 }}
        />
        <YAxis
          type="number"
          dataKey="asking"
          name="Asking price"
          domain={[domainMin, domainMax]}
          tickFormatter={(v) => `${Math.round(v / 1000)}k`}
          tick={{ fill: colors.textMuted, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          label={{ value: "Asking (R$)", angle: -90, position: "insideLeft", fill: colors.textMuted, fontSize: 11 }}
        />
        <ZAxis range={[70, 70]} />
        <Tooltip
          cursor={{ strokeDasharray: "3 3" }}
          contentStyle={{ background: colors.surface, border: `1px solid ${colors.border}`, borderRadius: 8, fontSize: 12 }}
          formatter={(value) => formatBRL(Number(value))}
          labelFormatter={(_, payload) => payload?.[0]?.payload?.label ?? ""}
        />
        <Scatter data={data} fill={colors.accent} />
      </ScatterChart>
    </ResponsiveContainer>
  );
}
