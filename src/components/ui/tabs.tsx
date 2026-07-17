"use client";
import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/utils";

export const Tabs = TabsPrimitive.Root;
export function TabsList({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.List>) {
  return <TabsPrimitive.List className={cn("flex gap-1 border-b border-border", className)} {...p} />;
}
export function TabsTrigger({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  return <TabsPrimitive.Trigger className={cn("px-3 py-2 text-sm text-text-muted data-[state=active]:border-b-2 data-[state=active]:border-accent data-[state=active]:text-text-primary", className)} {...p} />;
}
export function TabsContent({ className, ...p }: React.ComponentProps<typeof TabsPrimitive.Content>) {
  return <TabsPrimitive.Content className={cn("mt-4 focus:outline-none", className)} {...p} />;
}
