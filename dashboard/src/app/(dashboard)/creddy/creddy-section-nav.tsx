"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  CalendarDays,
  CheckCircle2,
  CircleX,
  ClipboardCheck,
  Clock3,
  LayoutGrid,
} from "lucide-react";

const sections = [
  { href: "/creddy/all-content", label: "All Content", icon: LayoutGrid },
  { href: "/creddy/content-bank/slideshows", label: "Review Queue", icon: ClipboardCheck },
  { href: "/creddy/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/creddy/posts/scheduled", label: "Scheduled", icon: Clock3 },
  { href: "/creddy/posts/published", label: "Published", icon: CheckCircle2 },
  { href: "/creddy/posts/rejected", label: "Rejected", icon: CircleX },
];

export function CreddySectionNav() {
  const pathname = usePathname();

  return (
    <div className="rounded-xl border bg-card p-2 shadow-sm">
      <div className="flex items-center gap-2 overflow-x-auto">
        {sections.map((section) => {
          const active = pathname === section.href || pathname.startsWith(`${section.href}/`);
          const Icon = section.icon;
          return (
            <Link
              key={section.href}
              href={section.href}
              className={`flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              <Icon className="size-4" />
              {section.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
