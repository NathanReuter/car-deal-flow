const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 });
const NUM = new Intl.NumberFormat("pt-BR");

export function formatBRL(v: number): string {
  return BRL.format(v);
}

export function formatKm(v: number | null): string {
  if (v === null) return "—";
  return `${NUM.format(v)} km`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("pt-BR");
}

export function formatFipe(v: number | null): string {
  return v === null ? "Not synced" : formatBRL(v);
}

export function formatPct(v: number, opts?: { signed?: boolean }): string {
  const fixed = v.toFixed(1);
  const clean = fixed === "-0.0" ? "0.0" : fixed;
  const sign = opts?.signed && Number(clean) > 0 ? "+" : "";
  return `${sign}${clean}%`;
}
