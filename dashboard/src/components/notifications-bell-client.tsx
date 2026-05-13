"use client";

/**
 * Dropdown notifications UI.
 *
 * Read-state lives in localStorage under `dismissed_notifications`
 * keyed by the notification id ("acctreq:<uuid>" or "payout:<uuid>").
 * The server component above always fetches what's *currently
 * pending* — when an item leaves pending state (request approved,
 * payout paid, etc.) it stops appearing here even if the user never
 * clicked it. That's the right behaviour: "still pending and you
 * already saw it" stays hidden, "no longer pending" disappears
 * automatically.
 *
 * Badge count + list both reflect the filtered set.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { Bell, UserPlus, DollarSign, Inbox, RotateCcw } from "lucide-react";

export interface NotificationItem {
  id: string;
  kind: "account_request" | "payout";
  title: string;
  hint: string;
  href: string;
  timestamp: string;
}

const STORAGE_KEY = "dismissed_notifications";

/**
 * Read the dismissed-ids set from localStorage. Defensive: gracefully
 * handles missing/corrupt data, server-side renders (where window is
 * undefined), and outdated payloads.
 */
function loadDismissed(): Set<string> {
  if (typeof window === "undefined") return new Set();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set();
    const parsed = JSON.parse(raw);
    return new Set(Array.isArray(parsed) ? parsed : []);
  } catch {
    return new Set();
  }
}

function persistDismissed(ids: Set<string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...ids]));
  } catch {
    /* private mode / quota exceeded — degrade silently */
  }
}

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60_000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

const KIND_ICON = {
  account_request: UserPlus,
  payout: DollarSign,
} as const;

export function NotificationsBellClient({ items }: { items: NotificationItem[] }) {
  const [open, setOpen] = useState(false);
  // SSR-safe: start with an empty set, hydrate on mount. The badge
  // briefly shows the unfiltered count before the localStorage read
  // completes — fine, the layout doesn't shift.
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  useEffect(() => {
    setDismissed(loadDismissed());
  }, []);

  // Drop any dismissed ids that no longer appear in the live items —
  // means the underlying work resolved server-side, and we should let
  // the same id reappear next time (defensive, rare but cheap).
  useEffect(() => {
    if (dismissed.size === 0) return;
    const liveIds = new Set(items.map((i) => i.id));
    let changed = false;
    const next = new Set<string>();
    for (const id of dismissed) {
      if (liveIds.has(id)) next.add(id);
      else changed = true;
    }
    if (changed) {
      setDismissed(next);
      persistDismissed(next);
    }
  }, [items, dismissed]);

  const visible = items.filter((i) => !dismissed.has(i.id));
  const count = visible.length;
  const badge = count === 0 ? null : count > 9 ? "9+" : String(count);

  function markRead(id: string) {
    const next = new Set(dismissed);
    next.add(id);
    setDismissed(next);
    persistDismissed(next);
  }

  function dismissAll() {
    const next = new Set(items.map((i) => i.id));
    setDismissed(next);
    persistDismissed(next);
  }

  function showAll() {
    setDismissed(new Set());
    persistDismissed(new Set());
  }

  // Number of items currently dismissed BUT still pending server-side.
  // Drives the "Show N dismissed" affordance — only visible when the
  // user has something they could un-hide.
  const hiddenCount = items.length - count;

  return (
    <div className="relative">
      {/*
        The `aria-label`, the Bell's count-driven className, and the
        badge span are all derived from `items.length`. `items` comes
        from a server-component fetch (pending account requests +
        pending payouts), so its value at SSR time can legitimately
        differ from its value when the RSC payload is rendered on the
        client (a request gets approved, a payout resolves, dev HMR
        re-runs the fetch). When that happens React flags a hydration
        mismatch on these three attributes/nodes. The drift is benign
        — the next render reconciles to the correct value — so we
        opt out of the warning on exactly the elements that depend on
        the live count. suppressHydrationWarning is non-recursive in
        React, so we mark each one individually rather than blanket-
        suppressing the whole subtree.
      */}
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="relative p-2 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        aria-label={count > 0 ? `${count} notifications` : "Notifications"}
        suppressHydrationWarning
      >
        <Bell
          className={`h-5 w-5 ${count > 0 ? "text-foreground" : ""}`}
          strokeWidth={1.5}
          suppressHydrationWarning
        />
        {badge && (
          // Positioned slightly OUTSIDE the icon for visibility, with a
          // ring matching the card background so the red pill stands
          // out cleanly over the header backdrop. Larger size + brighter
          // red so 1–2 digit counts are unmistakable at a glance.
          <span
            className="absolute -top-0.5 -right-0.5 inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 rounded-full bg-red-600 text-[11px] font-bold text-white tabular-nums leading-none ring-2 ring-card shadow-sm"
            suppressHydrationWarning
          >
            {badge}
          </span>
        )}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} aria-hidden />
          <div
            className="absolute right-0 top-full mt-2 w-96 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover shadow-lg z-50 overflow-hidden"
            role="menu"
          >
            <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-border/60">
              <p className="text-sm font-semibold whitespace-nowrap">Notifications</p>
              <div className="flex items-center gap-3">
                <span className="text-[10px] text-muted-foreground tabular-nums whitespace-nowrap">
                  {count} pending
                </span>
                {count > 0 && (
                  <button
                    type="button"
                    onClick={dismissAll}
                    className="text-[10px] font-medium text-muted-foreground hover:text-foreground whitespace-nowrap"
                  >
                    Mark all read
                  </button>
                )}
              </div>
            </div>

            {count === 0 ? (
              <div className="px-4 py-10 text-center space-y-2">
                <Inbox className="h-6 w-6 mx-auto text-muted-foreground/40" />
                <p className="text-xs text-muted-foreground">
                  {hiddenCount > 0
                    ? `All caught up — ${hiddenCount} dismissed.`
                    : "All caught up — nothing needs your attention."}
                </p>
                {hiddenCount > 0 && (
                  <button
                    type="button"
                    onClick={showAll}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                  >
                    <RotateCcw className="h-3 w-3" />
                    Show {hiddenCount} dismissed
                  </button>
                )}
              </div>
            ) : (
              <div className="max-h-96 overflow-y-auto divide-y divide-border/40">
                {visible.map((n) => {
                  const Icon = KIND_ICON[n.kind] ?? Bell;
                  return (
                    <Link
                      key={n.id}
                      href={n.href}
                      onClick={() => {
                        markRead(n.id);
                        setOpen(false);
                      }}
                      className="grid grid-cols-[32px_1fr_auto] items-start gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                      role="menuitem"
                    >
                      <span className={`h-8 w-8 rounded-full flex items-center justify-center shrink-0 ${
                        n.kind === "account_request"
                          ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                          : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      }`}>
                        <Icon className="h-4 w-4" />
                      </span>
                      <div className="min-w-0">
                        <p className="text-sm font-medium leading-snug line-clamp-2 break-words">{n.title}</p>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-snug line-clamp-1">{n.hint}</p>
                      </div>
                      <span className="text-[10px] text-muted-foreground tabular-nums shrink-0 pt-0.5">
                        {timeAgo(n.timestamp)}
                      </span>
                    </Link>
                  );
                })}
              </div>
            )}

            <div className="px-4 py-2 border-t border-border/60 bg-muted/20 flex items-center justify-between">
              <Link
                href="/settings/alerts"
                onClick={() => setOpen(false)}
                className="text-[11px] text-muted-foreground hover:text-foreground"
              >
                Notification settings →
              </Link>
              {/* Show "N dismissed" link even when count > 0, in case
                  the user wants to bring everything back without
                  emptying the visible list first. */}
              {hiddenCount > 0 && count > 0 && (
                <button
                  type="button"
                  onClick={showAll}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  <RotateCcw className="h-3 w-3" />
                  Show {hiddenCount} dismissed
                </button>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}
