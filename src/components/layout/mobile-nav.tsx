"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { NAV_ITEMS, BRAND_ICON } from "@/components/layout/nav-items";
import { ThemeToggle } from "@/components/layout/theme-toggle";
import { cn } from "@/lib/utils";

export function MobileNav() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <header className="flex h-[var(--header-height)] items-center justify-between border-b border-border bg-surface/95 px-4 backdrop-blur-sm md:hidden">
      <div className="flex items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-muted text-accent">
          <BRAND_ICON className="h-4 w-4" aria-hidden />
        </span>
        <span className="text-sm font-semibold text-text-primary">Car Deal Flow</span>
      </div>
      <div className="flex items-center gap-1">
        <ThemeToggle />
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger
            className="flex h-11 w-11 cursor-pointer items-center justify-center rounded-md text-text-secondary transition-colors duration-200 hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            aria-label="Open menu"
          >
            <Menu className="h-5 w-5" />
          </DialogTrigger>
          <DialogContent className="left-0 top-0 h-full max-h-full w-72 max-w-[85vw] translate-x-0 translate-y-0 rounded-none border-y-0 border-l-0 border-r border-border p-0">
            <DialogTitle className="sr-only">Navigation</DialogTitle>
            <div className="flex h-[var(--header-height)] items-center gap-2 border-b border-border px-4">
              <span className="flex h-8 w-8 items-center justify-center rounded-md bg-accent-muted text-accent">
                <BRAND_ICON className="h-4 w-4" aria-hidden />
              </span>
              <span className="text-sm font-semibold">Menu</span>
            </div>
            <nav className="flex flex-col gap-0.5 p-3" aria-label="Mobile">
              {NAV_ITEMS.map((item) => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm font-medium transition-colors duration-200",
                      "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active ? "bg-accent-muted text-text-primary" : "text-text-secondary hover:bg-surface-hover",
                    )}
                  >
                    <item.icon className={cn("h-4 w-4", active ? "text-accent" : "text-text-muted")} aria-hidden />
                    {item.label}
                  </Link>
                );
              })}
            </nav>
          </DialogContent>
        </Dialog>
      </div>
    </header>
  );
}
