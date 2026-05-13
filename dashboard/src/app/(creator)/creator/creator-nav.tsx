"use client";

/**
 * Creator portal nav — client component because it reads usePathname()
 * to highlight the active section. Underline animation on hover and
 * a solid emerald underline on the active link, matching the cleaner
 * tab-style navigation found in Beehiiv / Substack creator dashboards.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/creator", label: "Earnings" },
  { href: "/creator/posts", label: "Posts" },
  { href: "/creator/payments", label: "Payments" },
];

export function CreatorNav() {
  const pathname = usePathname();
  return (
    <nav className="flex items-center gap-1">
      {ITEMS.map((item) => {
        // Exact match for /creator (so it doesn't light up on /creator/posts);
        // prefix match for the deeper sections.
        const active =
          item.href === "/creator"
            ? pathname === "/creator"
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`relative px-3 py-1.5 rounded-md text-sm transition-colors ${
              active
                ? "text-foreground bg-emerald-500/10 dark:bg-emerald-500/15"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/50"
            }`}
          >
            <span className="relative">
              {item.label}
              {active && (
                <span className="absolute -bottom-2 left-0 right-0 h-0.5 rounded-full bg-emerald-500" />
              )}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
