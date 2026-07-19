"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { NAV_ITEMS, BRAND_ICON } from "@/components/layout/nav-items";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { cn } from "@/lib/utils";

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="hidden w-[var(--sidebar-width)] shrink-0 flex-col border-r border-border bg-surface/95 backdrop-blur-sm md:flex">
      <div className="flex h-[var(--header-height)] items-center gap-2.5 border-b border-border px-4">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-muted text-accent">
          <BRAND_ICON className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 leading-tight">
          <div className="truncate text-sm font-semibold tracking-tight text-text-primary">Car Deal Flow</div>
          <div className="truncate text-[11px] text-text-muted">Brazil · auctions</div>
        </div>
      </div>

      <nav className="flex-1 space-y-0.5 px-2 py-3" aria-label="Primary">
        {NAV_ITEMS.map((item) => {
          const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "group relative flex cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors duration-200",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-surface",
                active
                  ? "bg-accent-muted text-text-primary"
                  : "text-text-secondary hover:bg-surface-hover hover:text-text-primary",
              )}
            >
              {active && (
                <span
                  className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent"
                  aria-hidden
                />
              )}
              <item.icon
                className={cn("h-4 w-4 shrink-0", active ? "text-accent" : "text-text-muted group-hover:text-text-secondary")}
                aria-hidden
              />
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center justify-between gap-2 border-t border-border px-3 py-3">
        <div className="min-w-0 text-xs text-text-muted">
          <div className="font-medium text-text-secondary">Buyer workspace</div>
          <div className="truncate">Decision support</div>
        </div>
        <ThemeToggle />
      </div>
    </aside>
  );
}
