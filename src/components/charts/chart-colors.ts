"use client";

import { useSyncExternalStore } from "react";

/** Fallback light-theme tokens matching `globals.css` — used SSR and before paint. */
export const CHART_COLORS_LIGHT = {
  accent: "#0e7490",
  success: "#15803d",
  warning: "#b45309",
  danger: "#b91c1c",
  info: "#0369a1",
  border: "#d7e0ea",
  surface: "#ffffff",
  surfaceHover: "#e8eef5",
  textMuted: "#64748b",
  textSecondary: "#334155",
} as const;

export type ChartColors = { [K in keyof typeof CHART_COLORS_LIGHT]: string };

/** Stable SSR snapshot — must be referentially equal across calls. */
const SERVER_SNAPSHOT: ChartColors = { ...CHART_COLORS_LIGHT };

let cachedClientSnapshot: ChartColors = SERVER_SNAPSHOT;

function readChartColors(): ChartColors {
  if (typeof window === "undefined") return SERVER_SNAPSHOT;

  const styles = getComputedStyle(document.documentElement);
  const get = (name: string, fallback: string) => {
    const value = styles.getPropertyValue(name).trim();
    return value || fallback;
  };

  const next: ChartColors = {
    accent: get("--accent", CHART_COLORS_LIGHT.accent),
    success: get("--success", CHART_COLORS_LIGHT.success),
    warning: get("--warning", CHART_COLORS_LIGHT.warning),
    danger: get("--danger", CHART_COLORS_LIGHT.danger),
    info: get("--info", CHART_COLORS_LIGHT.info),
    border: get("--border", CHART_COLORS_LIGHT.border),
    surface: get("--surface", CHART_COLORS_LIGHT.surface),
    surfaceHover: get("--surface-hover", CHART_COLORS_LIGHT.surfaceHover),
    textMuted: get("--text-muted", CHART_COLORS_LIGHT.textMuted),
    textSecondary: get("--text-secondary", CHART_COLORS_LIGHT.textSecondary),
  };

  // Return previous reference when values are unchanged to avoid infinite re-renders.
  const prev = cachedClientSnapshot;
  const same = (Object.keys(next) as (keyof ChartColors)[]).every((k) => prev[k] === next[k]);
  if (same) return prev;

  cachedClientSnapshot = next;
  return next;
}

function getServerSnapshot(): ChartColors {
  return SERVER_SNAPSHOT;
}

function subscribe(onStoreChange: () => void) {
  const observer = new MutationObserver(onStoreChange);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

/**
 * Resolves CSS theme tokens to concrete colors for Recharts.
 * SVG `fill="var(--…)"` often falls back to black; pass resolved hex/rgb instead.
 */
export function useChartColors(): ChartColors {
  return useSyncExternalStore(subscribe, readChartColors, getServerSnapshot);
}
