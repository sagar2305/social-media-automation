"use client";

/**
 * Per-campaign posts page account filter.
 *
 * Same URL-driven pattern as accounts-campaign-filter on /accounts:
 *
 *   - Selection writes ?account=<handle> to the URL.
 *   - Server page re-renders and filters posts by that handle.
 *   - Choosing "All accounts" strips the param.
 *
 * Composes cleanly with any other query params the page might pick
 * up later (e.g. date range) — we preserve the rest of the search
 * string on every change.
 */

import { useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { AtSign, Check, ChevronDown } from "lucide-react";

export interface PostsAccountOption {
  handle: string;
  /** Optional post count for the dropdown row — purely informational. */
  count?: number;
}

interface Props {
  accounts: PostsAccountOption[];
  activeHandle: string | null;
}

export function PostsAccountFilter({ accounts, activeHandle }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);

  const active = accounts.find((a) => a.handle === activeHandle) ?? null;
  const label = active ? `@${active.handle}` : "All accounts";

  function pick(handle: string | null) {
    setOpen(false);
    const next = new URLSearchParams(searchParams.toString());
    if (handle) next.set("account", handle);
    else next.delete("account");
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
        <AtSign className="h-3.5 w-3.5" />
        <span className="max-w-[160px] truncate">{label}</span>
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
            className="absolute right-0 top-full mt-1.5 w-[260px] rounded-lg border border-border bg-popover shadow-lg z-50 p-1 max-h-80 overflow-y-auto"
            role="listbox"
          >
            <Option
              label="All accounts"
              hint="Show posts from every account on this campaign"
              checked={!active}
              onClick={() => pick(null)}
            />
            {accounts.length > 0 && <div className="my-1 h-px bg-border" />}
            {accounts.map((a) => (
              <Option
                key={a.handle}
                label={`@${a.handle}`}
                hint={typeof a.count === "number" ? `${a.count} post${a.count === 1 ? "" : "s"}` : undefined}
                checked={active?.handle === a.handle}
                onClick={() => pick(a.handle)}
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
          <span className="block text-[10px] text-muted-foreground truncate">
            {hint}
          </span>
        )}
      </span>
    </button>
  );
}
