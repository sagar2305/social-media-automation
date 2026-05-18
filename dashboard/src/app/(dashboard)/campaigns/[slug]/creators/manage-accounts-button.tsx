"use client";

/**
 * "Accounts (N)" button + modal on each row of /campaigns/<slug>/creators.
 *
 * Lets the operator decide which of the campaign's accounts this
 * creator owns. Pre-checked are the ones they already own; every
 * other checkbox is either free (no current owner) or owned by
 * another creator on this campaign (shown inline so the operator
 * sees they're about to "steal" the account).
 *
 * Save → `setCreatorCampaignAccounts` (atomic-ish; see action notes).
 * Server enforces the one-owner-per-account invariant, so even if
 * the operator ticks an account currently owned by Thomas, hitting
 * Save reassigns it to this creator cleanly.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  AtSign, Loader2, AlertCircle, CheckCircle2, X, Users,
} from "lucide-react";
import { setCreatorCampaignAccounts } from "../../../payouts/actions";

export interface CampaignAccountOption {
  id: string;
  handle: string;
  name: string | null;
  active: boolean;
  /**
   * Which creator currently owns this account on this campaign (if
   * anyone). Used to show "owned by Thomas — toggling will move it"
   * inline so the operator isn't surprised.
   */
  current_owner_id: string | null;
  current_owner_name: string | null;
}

interface Props {
  creatorId: string;
  creatorName: string;
  campaignId: string;
  /** Every account on this campaign, with each one's current owner. */
  allCampaignAccounts: CampaignAccountOption[];
  /**
   * Subset of allCampaignAccounts.id that this specific creator
   * already owns — used to pre-check the boxes.
   */
  initiallyOwnedIds: string[];
}

export function ManageAccountsButton({
  creatorId,
  creatorName,
  campaignId,
  allCampaignAccounts,
  initiallyOwnedIds,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(initiallyOwnedIds));
  const [query, setQuery] = useState("");
  const [saving, startSaving] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [successFlash, setSuccessFlash] = useState(false);

  const ownedCount = initiallyOwnedIds.length;
  const totalCount = allCampaignAccounts.length;

  // Memoise the filtered list so typing in the search box doesn't
  // re-sort/re-filter on every render of unrelated state.
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const sorted = [...allCampaignAccounts].sort((a, b) => {
      // Owned by this creator first, then by other creators, then unassigned.
      const aMine = initiallyOwnedIds.includes(a.id) ? 0 : a.current_owner_id ? 1 : 2;
      const bMine = initiallyOwnedIds.includes(b.id) ? 0 : b.current_owner_id ? 1 : 2;
      if (aMine !== bMine) return aMine - bMine;
      return a.handle.localeCompare(b.handle);
    });
    if (!q) return sorted;
    return sorted.filter(
      (a) =>
        a.handle.toLowerCase().includes(q) ||
        (a.name?.toLowerCase().includes(q) ?? false),
    );
  }, [allCampaignAccounts, initiallyOwnedIds, query]);

  // The selection-vs-saved diff drives Save's enabled state and the
  // toast copy. Counted without allocations on the hot path.
  const dirty =
    selected.size !== initiallyOwnedIds.length ||
    [...selected].some((id) => !initiallyOwnedIds.includes(id));

  function close() {
    setOpen(false);
    setError(null);
    setQuery("");
    // Reset to saved state when re-opening — avoids carrying stale
    // selection from a previous cancelled session.
    setSelected(new Set(initiallyOwnedIds));
  }

  function toggle(id: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function onSave() {
    setError(null);
    startSaving(async () => {
      const r = await setCreatorCampaignAccounts({
        creatorId,
        campaignId,
        accountIds: [...selected],
      });
      if (!r.ok) { setError(r.error); return; }
      setSuccessFlash(true);
      router.refresh();
      // Auto-close after a beat so the operator sees the success
      // pulse, then can verify the row's new count.
      setTimeout(() => {
        setSuccessFlash(false);
        setOpen(false);
      }, 900);
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); setOpen(true); }}
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-xs font-medium hover:bg-muted/60 transition-colors"
        title={`Manage which campaign accounts ${creatorName} owns`}
      >
        <Users className="h-3 w-3" />
        Accounts ({ownedCount})
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={close}
        >
          <div
            className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg flex flex-col max-h-[85vh]"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div className="min-w-0">
                <h2 className="text-base font-semibold">
                  Accounts owned by {creatorName}
                </h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Tick the accounts on this campaign that {creatorName} owns.
                  Posts on those handles auto-attribute to them. Toggling an
                  account already owned by someone else moves it.
                </p>
              </div>
              <button
                onClick={close}
                className="text-muted-foreground hover:text-foreground shrink-0"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="px-5 pt-3 pb-2 border-b border-border/60">
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search handles…"
                className="h-9"
              />
              <p className="text-[11px] text-muted-foreground mt-2 flex items-center justify-between">
                <span>
                  {selected.size} of {totalCount} accounts selected
                </span>
                {dirty && (
                  <span className="text-amber-700 dark:text-amber-400 font-medium">
                    unsaved changes
                  </span>
                )}
              </p>
            </div>

            <div className="flex-1 overflow-y-auto px-5 py-3">
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 mb-3 text-xs text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {totalCount === 0 ? (
                <div className="rounded-md border border-dashed border-border/60 bg-muted/20 px-4 py-8 text-center text-xs text-muted-foreground">
                  This campaign has no TikTok accounts attached yet. Add
                  accounts on the campaign&apos;s{" "}
                  <span className="font-medium text-foreground">Accounts</span> tab first, then come back here to
                  assign them.
                </div>
              ) : visible.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-6">
                  No accounts match &ldquo;{query}&rdquo;.
                </div>
              ) : (
                <div className="space-y-1">
                  {visible.map((a) => {
                    const checked = selected.has(a.id);
                    const ownedByOther =
                      a.current_owner_id && a.current_owner_id !== creatorId;
                    return (
                      <label
                        key={a.id}
                        className={`flex items-start gap-3 rounded-md border px-3 py-2 cursor-pointer transition-colors ${
                          checked
                            ? "border-primary/50 bg-primary/5"
                            : "border-border/50 hover:bg-muted/40"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
                          checked={checked}
                          onChange={() => toggle(a.id)}
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium flex items-center gap-1.5">
                            <AtSign className="h-3 w-3 text-muted-foreground" />
                            <span className="font-mono">{a.handle}</span>
                            {!a.active && (
                              <span className="text-[10px] text-muted-foreground uppercase">paused</span>
                            )}
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            {a.name ?? "—"}
                            {ownedByOther && (
                              <>
                                {" · "}
                                <span className="text-amber-700 dark:text-amber-400">
                                  currently owned by {a.current_owner_name}
                                  {checked && " — saving will move it"}
                                </span>
                              </>
                            )}
                            {!ownedByOther && !a.current_owner_id && (
                              <> · <span className="text-muted-foreground/70">unassigned</span></>
                            )}
                          </p>
                        </div>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>

            <footer className="flex items-center justify-between px-5 py-4 border-t border-border bg-muted/20">
              <div className="text-xs text-muted-foreground">
                {successFlash ? (
                  <span className="inline-flex items-center gap-1.5 text-emerald-600 font-medium">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    Saved
                  </span>
                ) : (
                  "Changes apply immediately on save."
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button type="button" variant="outline" onClick={close} disabled={saving}>
                  Cancel
                </Button>
                <Button type="button" onClick={onSave} disabled={saving || !dirty}>
                  {saving ? (
                    <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Save
                </Button>
              </div>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
