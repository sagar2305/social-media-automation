"use client";

/**
 * Tab strip for /campaigns/[slug]/* — highlights the active tab off
 * usePathname() and links to all sibling tabs.
 *
 * Phase 6 wires only the Overview tab; the rest land in subsequent
 * phases (Accounts → 8, Schedule → 9, Posts/Experiments/Formats/
 * Hashtags → 10, AI Brain & Reports → 11). Tabs that haven't been
 * built yet are still shown but marked muted so the eventual layout
 * is visible from day one — clicking them 404s until their phase
 * lands, which is acceptable for an in-progress build.
 */

import Link from "next/link";
import { usePathname } from "next/navigation";

interface Tab {
  href: string;
  label: string;
  ready: boolean; // false → marked as "coming soon"
}

export function CampaignTabs({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/campaigns/${slug}`;

  const tabs: Tab[] = [
    { href: base, label: "Overview", ready: true },
    { href: `${base}/posts`, label: "Posts", ready: false },
    { href: `${base}/accounts`, label: "Accounts", ready: false },
    { href: `${base}/schedule`, label: "Schedule", ready: false },
    { href: `${base}/experiments`, label: "Experiments", ready: false },
    { href: `${base}/formats`, label: "Formats", ready: false },
    { href: `${base}/hashtags`, label: "Hashtags", ready: false },
    { href: `${base}/brain`, label: "AI Brain", ready: false },
    { href: `${base}/reports`, label: "Reports", ready: false },
  ];

  return (
    <div className="border-b border-border">
      <div className="flex items-center gap-1 overflow-x-auto -mb-px">
        {tabs.map((t) => {
          const isActive =
            t.href === base
              ? pathname === t.href
              : pathname === t.href || pathname.startsWith(`${t.href}/`);
          const className = `relative inline-flex items-center gap-2 whitespace-nowrap px-3 py-2.5 text-sm font-medium transition-colors border-b-2 ${
            isActive
              ? "border-primary text-foreground"
              : "border-transparent text-muted-foreground hover:text-foreground"
          }`;

          if (!t.ready) {
            return (
              <span
                key={t.href}
                className={`${className} cursor-not-allowed opacity-50`}
                title="Coming in a later phase"
              >
                {t.label}
                <span className="text-[9px] uppercase tracking-wider rounded-sm px-1 py-0.5 bg-muted text-muted-foreground">
                  soon
                </span>
              </span>
            );
          }

          return (
            <Link key={t.href} href={t.href} className={className}>
              {t.label}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
