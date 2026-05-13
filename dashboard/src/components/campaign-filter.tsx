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
import { useRouter, usePathname } from "next/navigation";
import { Tag, Check, ChevronDown } from "lucide-react";
import { setActiveCampaign } from "@/lib/campaign-filter-actions";

export interface CampaignOption {
  slug: string;
  name: string;
}

interface Props {
  campaigns: CampaignOption[];
  activeSlug: string | null;
}

export function CampaignFilter({ campaigns, activeSlug }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [, startTransition] = useTransition();

  // When the user is inside /campaigns/<slug>/*, the URL is the source of
  // truth for "what campaign am I looking at" — not the cookie. The cookie
  // applies to global pages (/, /posts, /accounts). Without this, picking
  // RoastAI from /campaigns/roastai shows MinuteWise as 'active' if the
  // cookie is stuck on minutewise.
  const urlSlugMatch = pathname.match(/^\/campaigns\/([^/]+)/);
  const urlSlug = urlSlugMatch && urlSlugMatch[1] !== "new" ? urlSlugMatch[1] : null;
  const effectiveActiveSlug = urlSlug ?? activeSlug;

  const active = campaigns.find((c) => c.slug === effectiveActiveSlug) ?? null;
  const label = active ? active.name : "All campaigns";

  /**
   * What "switch campaign" actually means depends on where you're standing:
   *
   *   - On a global page (/, /posts, /accounts): set the cookie + refresh.
   *     Server components re-read the cookie and re-filter their queries.
   *
   *   - On a per-campaign page (/campaigns/<oldslug>/<tab>): swap <oldslug>
   *     for the picked one in the URL so the user stays on whatever tab
   *     they were looking at — picking MinuteWise from /campaigns/roastai/
   *     posts should land them on /campaigns/minutewise/posts. Just
   *     refreshing the page would leave them stranded on the wrong
   *     campaign's data because the [slug] segment overrides the cookie
   *     filter inside that route group.
   *
   *   - "All campaigns" while inside /campaigns/<x>/<tab>: jump back to the
   *     campaign list. There's no meaningful "all campaigns" version of a
   *     per-campaign view.
   */
  function pick(slug: string | null) {
    setOpen(false);

    // /campaigns/[slug]/(...) — swap the slug segment. We also fire
    // the cookie set in the background so the user's "active" pill
    // stays in sync after they navigate back out to /accounts etc.
    const onCampaignDetail = pathname.match(/^\/campaigns\/([^/]+)(\/.*)?$/);
    if (onCampaignDetail) {
      // Fire and forget — we don't await because the URL change is
      // what the user is here for; the cookie sync is just a UX nicety.
      void setActiveCampaign(slug);
      const tail = onCampaignDetail[2] ?? "";
      if (slug) {
        if (onCampaignDetail[1] === "new") {
          router.push(`/campaigns/${slug}`);
        } else {
          router.push(`/campaigns/${slug}${tail}`);
        }
      } else {
        router.push("/campaigns");
      }
      return;
    }

    // Global page (/, /posts, /accounts, /payouts, …) → run the
    // server action which sets the cookie AND revalidatePath()s the
    // layout. By the time the action resolves the next render is
    // already fresh — no manual refresh needed.
    startTransition(async () => {
      await setActiveCampaign(slug);
    });
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
