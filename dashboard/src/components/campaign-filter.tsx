"use client";

/**
 * Campaign filter — top-bar dropdown that scopes Home / Posts / Accounts
 * to a single campaign or 'All campaigns'. Selection persists via the
 * active_campaign cookie (read server-side in lib/campaign-filter.ts).
 *
 * Why a cookie and not a URL param:
 *   - Cookie persists across navigations between Home → Posts → Accounts
 *     without needing every link to carry ?campaign=… along.
 *   - Cookie is readable from server components, which is where we apply
 *     the filter (we don't want client-side filtering on a 500-row table).
 *
 * The Campaigns route group itself (/campaigns and /campaigns/[slug]/*)
 * is not affected — those views are explicitly per-campaign already.
 */

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tag, Check, ChevronDown } from "lucide-react";

const COOKIE_NAME = "active_campaign";

export interface CampaignOption {
  slug: string;
  name: string;
}

interface Props {
  campaigns: CampaignOption[];
  activeSlug: string | null;
}

function setCookie(value: string) {
  if (value) {
    // 30 days — long enough that the user doesn't have to re-pick after
    // a coffee break, short enough that a stale cookie doesn't haunt the
    // session forever after they archive a campaign.
    document.cookie = `${COOKIE_NAME}=${encodeURIComponent(value)}; path=/; max-age=${30 * 86400}; samesite=lax`;
  } else {
    document.cookie = `${COOKIE_NAME}=; path=/; max-age=0; samesite=lax`;
  }
}

export function CampaignFilter({ campaigns, activeSlug }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  const active = campaigns.find((c) => c.slug === activeSlug) ?? null;
  const label = active ? active.name : "All campaigns";

  function pick(slug: string | null) {
    setCookie(slug ?? "");
    setOpen(false);
    startTransition(() => router.refresh());
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-xs font-medium transition-colors ${
          active
            ? "bg-primary/10 border-primary/30 text-primary hover:bg-primary/15"
            : "bg-background hover:bg-muted text-foreground"
        }`}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <Tag className="h-3.5 w-3.5" />
        <span className="max-w-[140px] truncate">{label}</span>
        <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          <div
            className="absolute right-0 top-full mt-1.5 w-[260px] rounded-lg border border-border bg-popover shadow-lg z-50 p-1"
            role="listbox"
          >
            <Option
              label="All campaigns"
              hint="Show data from every campaign"
              checked={!active}
              onClick={() => pick(null)}
            />
            {campaigns.length > 0 && <div className="my-1 h-px bg-border" />}
            {campaigns.map((c) => (
              <Option
                key={c.slug}
                label={c.name}
                hint={c.slug}
                checked={active?.slug === c.slug}
                onClick={() => pick(c.slug)}
              />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function Option({
  label,
  hint,
  checked,
  onClick,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      role="option"
      aria-selected={checked}
      className={`w-full flex items-center gap-2 px-2.5 py-2 rounded-md text-left transition-colors ${
        checked ? "bg-primary/10" : "hover:bg-muted/60"
      }`}
    >
      <span className="h-4 w-4 shrink-0 flex items-center justify-center">
        {checked && <Check className="h-3.5 w-3.5 text-primary" />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium truncate">{label}</span>
        {hint && (
          <span className="block text-[10px] text-muted-foreground font-mono truncate">
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}
