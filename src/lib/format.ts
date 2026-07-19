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

/** Auction datetime in Brazil locale (date + time). */
export function formatAuctionDateTime(iso: string): string {
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(iso));
}

/** Relative countdown / age for an auction instant. */
export function formatAuctionRelative(iso: string, now: Date = new Date()): string {
  const target = new Date(iso).getTime();
  const diffMs = target - now.getTime();
  const absDays = Math.floor(Math.abs(diffMs) / (1000 * 60 * 60 * 24));
  const absHours = Math.floor(Math.abs(diffMs) / (1000 * 60 * 60));

  if (diffMs > 0) {
    if (absHours < 1) return "starts in under an hour";
    if (absHours < 24) return `in ${absHours} hour${absHours === 1 ? "" : "s"}`;
    if (absDays === 1) return "tomorrow";
    return `in ${absDays} days`;
  }
  if (absHours < 1) return "ended just now";
  if (absHours < 24) return `ended ${absHours} hour${absHours === 1 ? "" : "s"} ago`;
  if (absDays === 1) return "ended yesterday";
  return `ended ${absDays} days ago`;
}
