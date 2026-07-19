import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard,
  Table2,
  KanbanSquare,
  Car,
  Columns3,
  ListChecks,
  Target,
  Mail,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export const NAV_ITEMS: NavItem[] = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/cars", label: "All Vehicles", icon: Table2 },
  { href: "/pipeline", label: "Pipeline", icon: KanbanSquare },
  { href: "/shortlist", label: "Shortlist", icon: ListChecks },
  { href: "/compare", label: "Compare", icon: Columns3 },
  { href: "/goal", label: "Buying Goal", icon: Target },
  { href: "/reports", label: "Reports", icon: Mail },
];

export const BRAND_ICON = Car;
