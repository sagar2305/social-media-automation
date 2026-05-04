"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Users,
  FileText,
  Hash,
  Swords,
  FlaskConical,
  BarChart3,
  Megaphone,
  ShieldAlert,
  Settings,
  Clock,
  Activity,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/runs", label: "Live Runs", icon: Activity },
  { href: "/accounts", label: "Accounts", icon: Users },
  { href: "/posts", label: "Posts", icon: FileText },
  { href: "/hashtags", label: "Hashtags", icon: Hash },
  { href: "/competitors", label: "Competitors", icon: Swords },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/autoresearch", label: "Autoresearch", icon: FlaskConical },
  { href: "/experiments", label: "Experiments", icon: FlaskConical },
  { href: "/formats", label: "Formats", icon: BarChart3 },
  { href: "/errors", label: "Errors & Auto-Fix", icon: ShieldAlert },
  { href: "/settings/schedule", label: "Schedule", icon: Clock },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SidebarNav() {
  const pathname = usePathname();
  // Pick the nav item whose href is the longest prefix of the current path, so
  // /settings/schedule highlights "Schedule" only — not also "Settings".
  const activeHref = navItems
    .filter((item) =>
      item.href === "/" ? pathname === "/" : pathname.startsWith(item.href),
    )
    .reduce<string | null>(
      (best, item) =>
        best === null || item.href.length > best.length ? item.href : best,
      null,
    );

  return (
    <div className="space-y-1">
      {navItems.map((item) => {
        const isActive = item.href === activeHref;
        const Icon = item.icon;

        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors ${
              isActive
                ? "bg-accent text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-muted"
            }`}
          >
            <Icon className="h-[18px] w-[18px]" strokeWidth={isActive ? 2 : 1.5} />
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}
