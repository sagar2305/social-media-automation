"use client";

/**
 * Accounts-page campaign filter.
 *
 * Page-local on purpose — the previous global header filter (cookie-
 * driven, revalidatePath-based) hit too many cache + lock-contention
 * edge cases in Next 16 + Turbopack. This one is simpler:
 *
 *   - State lives in the URL (?campaign=<slug>).
 *   - Selection triggers a plain router.push() — a real navigation,
 *     no cache hacks, no cookie writes, no server actions.
 *   - The page is server-rendered, reads searchParams.campaign, and
 *     filters its queries by that slug. Cycle of trust ends at the URL.
 *
 * Trade-off: switching campaigns is one network round-trip (~200 ms in
 * dev) instead of an instant client-side filter. For a 4-account demo
 * that's invisible; for production-scale data it's still the right
 * shape because filtering happens at the DB.
 */

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Tag, Check, ChevronDown } from "lucide-react";

export interface AccountsFilterCampaign {
  slug: string;
  name: string;
}

interface Props {
  campaigns: AccountsFilterCampaign[];
  activeSlug: string | null;
}

export function AccountsCampaignFilter({ campaigns, activeSlug }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  const active = campaigns.find((c) => c.slug === activeSlug) ?? null;
  const label = active ? active.name : "All campaigns";

  function pick(slug: string | null) {
    setOpen(false);
    // Preserve any other query params (e.g. ?range=7d from the date
    // filter) so the two filters compose naturally.
    const next = new URLSearchParams(searchParams.toString());
    if (slug) next.set("campaign", slug);
    else next.delete("campaign");
    const qs = next.toString();
    router.push(qs ? `${pathname}?${qs}` : pathname);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
          active
            ? "bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/15"
            : "bg-background border-input hover:bg-muted text-foreground"
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
          {/* Click-outside guard — clicks anywhere else on the page
              close the dropdown without firing other handlers. */}
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
              hint="Show every account"
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
        checked ? "bg-emerald-500/10" : "hover:bg-muted/60"
      }`}
    >
      <span className="h-4 w-4 shrink-0 flex items-center justify-center">
        {checked && <Check className="h-3.5 w-3.5 text-emerald-600" />}
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
