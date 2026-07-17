import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badge = cva("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", {
  variants: {
    variant: {
      neutral: "border-transparent bg-surface-hover text-text-secondary",
      success: "border-transparent bg-[var(--success-bg)] text-[var(--success)]",
      warning: "border-transparent bg-[var(--danger-bg)] text-[var(--warning)]",
      danger: "border-transparent bg-[var(--danger-bg)] text-[var(--danger)]",
      outline: "border-border text-text-secondary",
    },
  },
  defaultVariants: { variant: "neutral" },
});

export function Badge({ className, variant, ...p }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badge>) {
  return <span className={cn(badge({ variant }), className)} {...p} />;
}
