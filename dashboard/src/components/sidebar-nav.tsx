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
  Settings,
} from "lucide-react";

const navItems = [
  { href: "/", label: "Overview", icon: LayoutDashboard },
  { href: "/accounts", label: "Accounts", icon: Users },
  { href: "/posts", label: "Posts", icon: FileText },
  { href: "/hashtags", label: "Hashtags", icon: Hash },
  { href: "/competitors", label: "Competitors", icon: Swords },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/experiments", label: "Experiments", icon: FlaskConical },
  { href: "/formats", label: "Formats", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <div className="space-y-1">
      {navItems.map((item) => {
        const isActive =
          item.href === "/"
            ? pathname === "/"
            : pathname.startsWith(item.href);
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
