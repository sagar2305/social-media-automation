"use client";

/**
 * Assign-a-creator-to-this-campaign modal.
 *
 * Lists existing onboarded creators (loaded lazily on open) so the
 * operator can pick one without leaving the campaign page. Lets them
 * set rate-override + expected-posts + which campaign multipliers
 * apply to this specific assignment.
 *
 * "Don't see them? Invite a new creator →" links out to /creators/new.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  UserPlus, Loader2, X, AlertCircle, Search, AtSign, ChevronDown, ChevronUp,
} from "lucide-react";
import type { Creator, Multiplier } from "@/lib/types";
import { createAssignment, setCreatorCampaignAccounts } from "../../../payouts/actions";
import type { CampaignAccountOption } from "./manage-accounts-button";

interface Props {
  campaignId: string;
  multipliers: Multiplier[];
  /**
   * All accounts on this campaign (with each one's current owner if
   * any). Threaded in from the parent page so the modal doesn't have
   * to refetch; same shape the ManageAccountsButton consumes.
   */
  campaignAccounts?: CampaignAccountOption[];
  /** Optional override of the button label/style (used in the empty state). */
  variant?: "default" | "outline";
  label?: string;
}

export function CampaignAssignCreatorButton({ campaignId, multipliers, campaignAccounts = [], variant = "default", label = "Assign creator" }: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [creators, setCreators] = useState<Creator[]>([]);
  // creator_id → assignment status, populated alongside the creators
  // list when the modal opens. Used to dim+badge already-assigned rows.
  const [existingAssignments, setExistingAssignments] = useState<Map<string, string>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();

  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [expectedPosts, setExpectedPosts] = useState("3");
  const [rateOverride, setRateOverride] = useState("");
  const [appliedMultipliers, setAppliedMultipliers] = useState<string[]>([]);
  // Default to invite (creator must Accept). Operators agreeing offline
  // can flip the toggle and skip straight to status='active'.
  const [sendAsInvite, setSendAsInvite] = useState(true);
  // Optional: give the creator some of this campaign's accounts at
  // assign time. Collapsed by default so the modal stays compact for
  // the "just assign them, I'll do accounts later" path.
  const [selectedAccountIds, setSelectedAccountIds] = useState<Set<string>>(new Set());
  const [accountsExpanded, setAccountsExpanded] = useState(false);

  useEffect(() => {
    if (!open || creators.length > 0) return;
    setLoading(true);
    const sb = createBrowserSupabase();
    // Load creators AND existing assignments for this campaign in
    // parallel. The assignments list drives the "already assigned"
    // badge so the admin doesn't waste a click on a creator that's
    // already on the campaign (the unique constraint on
    // (creator_id, campaign_id) would reject the duplicate insert
    // anyway, but failing visually is a better experience than
    // submitting and getting a server error).
    Promise.all([
      sb.from("creators")
        .select("*")
        .in("status", ["invited", "onboarded"])
        .order("legal_name")
        .returns<Creator[]>(),
      sb.from("assignments")
        .select("creator_id, status")
        .eq("campaign_id", campaignId)
        .returns<Array<{ creator_id: string; status: string }>>(),
    ]).then(([creatorsRes, assignRes]) => {
      if (creatorsRes.error) { setError(creatorsRes.error.message); setLoading(false); return; }
      setCreators(creatorsRes.data ?? []);
      const ids = new Map<string, string>();
      for (const a of assignRes.data ?? []) ids.set(a.creator_id, a.status);
      setExistingAssignments(ids);
      setLoading(false);
    });
  }, [open, creators.length, campaignId]);

  function reset() {
    setSelectedId(null);
    setExpectedPosts("3");
    setRateOverride("");
    setAppliedMultipliers([]);
    setSendAsInvite(true);
    setSelectedAccountIds(new Set());
    setAccountsExpanded(false);
    setError(null);
  }

  function toggleAccount(id: string) {
    setSelectedAccountIds((cur) => {
      const next = new Set(cur);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function close() {
    setOpen(false);
    reset();
  }

  function toggleMultiplier(id: string) {
    setAppliedMultipliers((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  }

  function onSubmit() {
    if (!selectedId) { setError("Pick a creator first."); return; }
    setError(null);
    const rateOverrideCents = rateOverride.trim() === ""
      ? null
      : Math.round(parseFloat(rateOverride) * 100);
    if (rateOverrideCents !== null && (!Number.isFinite(rateOverrideCents) || rateOverrideCents < 0)) {
      setError("Rate override must be a positive number or empty.");
      return;
    }
    startSubmit(async () => {
      const r = await createAssignment({
        creator_id: selectedId,
        campaign_id: campaignId,
        expected_posts: parseInt(expectedPosts, 10) || 1,
        rate_override_cents: rateOverrideCents,
        applied_multipliers: appliedMultipliers,
        as_invite: sendAsInvite,
      });
      if (!r.ok) { setError(r.error); return; }

      // If the operator ticked any accounts, hand those off too. We
      // do this AFTER the assignment so a failure here doesn't leave
      // the creator-row in a half-onboarded state. The set-accounts
      // action is idempotent — re-running it with the same selection
      // is safe.
      if (selectedAccountIds.size > 0) {
        const accountsR = await setCreatorCampaignAccounts({
          creatorId: selectedId,
          campaignId,
          accountIds: [...selectedAccountIds],
        });
        if (!accountsR.ok) {
          setError(
            `Creator was assigned, but the account hand-off failed: ${accountsR.error}. ` +
            `Use the row's "Accounts" button to retry.`,
          );
          router.refresh();
          return;
        }
      }

      close();
      router.refresh();
    });
  }

  const filtered = creators.filter((c) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      c.legal_name.toLowerCase().includes(s) ||
      (c.display_name?.toLowerCase().includes(s) ?? false) ||
      c.email.toLowerCase().includes(s)
    );
  });

  return (
    <>
      <Button variant={variant} type="button" onClick={() => setOpen(true)}>
        <UserPlus className="h-4 w-4 mr-1.5" />
        {label}
      </Button>

      {open && (
        <div className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm flex items-center justify-center p-4" onClick={close}>
          <div
            className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-2xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between px-5 py-4 border-b border-border">
              <h2 className="text-base font-semibold">Assign creator to this campaign</h2>
              <button onClick={close} className="text-muted-foreground hover:text-foreground"><X className="h-4 w-4" /></button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Search box */}
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="Search creators by name or email…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                />
              </div>

              {/* Creator list */}
              <div className="border border-border/50 rounded-md max-h-64 overflow-y-auto">
                {loading ? (
                  <div className="py-8 text-center text-xs text-muted-foreground">
                    <Loader2 className="h-4 w-4 mx-auto animate-spin" />
                    <p className="mt-2">Loading creators…</p>
                  </div>
                ) : filtered.length === 0 ? (
                  <div className="py-6 text-center text-xs text-muted-foreground space-y-2">
                    {creators.length === 0 ? (
                      <>
                        <p>No creators in your directory yet.</p>
                        <Link href="/creators/new" className="text-primary underline-offset-4 hover:underline">
                          Invite your first creator →
                        </Link>
                      </>
                    ) : (
                      <p>No matches for &ldquo;{search}&rdquo;.</p>
                    )}
                  </div>
                ) : (
                  <div className="divide-y divide-border/40">
                    {filtered.map((c) => {
                      const existingStatus = existingAssignments.get(c.id);
                      const alreadyOn = !!existingStatus;
                      return (
                      <label
                        key={c.id}
                        className={`flex items-center gap-3 px-3 py-2 transition-colors ${
                          alreadyOn
                            ? "opacity-60 cursor-not-allowed"
                            : selectedId === c.id
                              ? "bg-primary/5 cursor-pointer"
                              : "hover:bg-muted/30 cursor-pointer"
                        }`}
                      >
                        <input
                          type="radio"
                          name="creator"
                          checked={selectedId === c.id}
                          onChange={() => { if (!alreadyOn) setSelectedId(c.id); }}
                          disabled={alreadyOn}
                          className="h-3.5 w-3.5"
                        />
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium">
                            {c.display_name || c.legal_name}
                            {c.kind === "team_member" && (
                              <span className="ml-2 text-[9px] uppercase tracking-wider rounded-full px-1.5 py-0.5 bg-blue-500/10 text-blue-700">Team</span>
                            )}
                            {alreadyOn && (
                              <span className="ml-2 text-[9px] uppercase tracking-wider rounded-full px-1.5 py-0.5 bg-amber-500/10 text-amber-700 dark:text-amber-400">
                                Already on · {existingStatus}
                              </span>
                            )}
                          </p>
                          <p className="text-[11px] text-muted-foreground">{c.email}{c.country && ` · ${c.country}`}</p>
                        </div>
                      </label>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="text-[11px] text-muted-foreground">
                Don&apos;t see them?{" "}
                <Link href="/creators/new" className="text-primary underline-offset-4 hover:underline">Invite a new creator</Link>
              </div>

              {/* Per-assignment fields */}
              {selectedId && (
                <div className="rounded-md border border-border/60 px-4 py-3 space-y-3">
                  <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                    Assignment terms
                  </p>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Expected posts</label>
                      <Input type="number" min={1} max={100} value={expectedPosts} onChange={(e) => setExpectedPosts(e.target.value)} />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Rate override per post (optional)</label>
                      <Input type="number" step="0.01" min="0" value={rateOverride} onChange={(e) => setRateOverride(e.target.value)} placeholder="(use campaign default)" />
                    </div>
                  </div>

                  {multipliers.length > 0 && (
                    <div className="space-y-1.5">
                      <label className="text-xs font-medium">Multipliers that apply to this creator</label>
                      <div className="flex flex-wrap gap-1.5">
                        {multipliers.map((m) => (
                          <button
                            key={m.id}
                            type="button"
                            onClick={() => toggleMultiplier(m.id)}
                            className={`px-2 py-1 rounded-md border text-[11px] transition-colors ${
                              appliedMultipliers.includes(m.id)
                                ? "bg-primary text-primary-foreground border-primary"
                                : "border-border hover:bg-muted/40"
                            }`}
                          >
                            {m.label} {m.pct >= 0 ? "+" : ""}{m.pct}%
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Invite vs direct-add toggle. Two cards because radio
                      buttons in a tight modal are easy to miss; cards
                      make the chosen mode visually obvious. */}
                  <div className="space-y-1.5 pt-2 border-t border-border/50">
                    <label className="text-xs font-medium">How to add this creator</label>
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        type="button"
                        onClick={() => setSendAsInvite(true)}
                        className={`text-left rounded-md border px-3 py-2 transition-colors ${
                          sendAsInvite ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                        }`}
                      >
                        <p className="text-xs font-medium">Send as invite</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Creator must Accept in their portal before this counts.
                        </p>
                      </button>
                      <button
                        type="button"
                        onClick={() => setSendAsInvite(false)}
                        className={`text-left rounded-md border px-3 py-2 transition-colors ${
                          !sendAsInvite ? "border-primary bg-primary/5" : "border-border hover:bg-muted/40"
                        }`}
                      >
                        <p className="text-xs font-medium">Add directly</p>
                        <p className="text-[10px] text-muted-foreground mt-0.5">
                          Skip the handshake — we already agreed offline.
                        </p>
                      </button>
                    </div>
                  </div>

                  {/* OPTIONAL: hand them some of this campaign's accounts
                      right now. Collapsed by default — the operator can
                      always do it later via the row's "Accounts" button,
                      but offering it here saves a navigation when the
                      account assignment is already decided. List is
                      scoped strictly to this campaign's accounts. */}
                  {campaignAccounts.length > 0 && (
                    <div className="pt-2 border-t border-border/50">
                      <button
                        type="button"
                        onClick={() => setAccountsExpanded((v) => !v)}
                        className="w-full flex items-center justify-between text-xs font-medium hover:text-foreground"
                      >
                        <span className="flex items-center gap-1.5">
                          Give them campaign accounts{" "}
                          <span className="text-muted-foreground font-normal">
                            ({selectedAccountIds.size} selected · optional)
                          </span>
                        </span>
                        {accountsExpanded ? (
                          <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                        ) : (
                          <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                        )}
                      </button>

                      {accountsExpanded && (
                        <div className="mt-2 rounded-md border border-border/60 divide-y divide-border/30 max-h-56 overflow-y-auto">
                          {campaignAccounts.map((a) => {
                            const ownedByOther =
                              a.current_owner_id &&
                              a.current_owner_id !== selectedId;
                            const checked = selectedAccountIds.has(a.id);
                            return (
                              <label
                                key={a.id}
                                className={`flex items-start gap-3 px-3 py-2 cursor-pointer text-xs ${
                                  checked ? "bg-primary/5" : "hover:bg-muted/40"
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={() => toggleAccount(a.id)}
                                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-primary"
                                />
                                <div className="min-w-0 flex-1">
                                  <p className="font-medium flex items-center gap-1.5">
                                    <AtSign className="h-3 w-3 text-muted-foreground" />
                                    <span className="font-mono">{a.handle}</span>
                                    {!a.active && (
                                      <span className="text-[9px] text-muted-foreground uppercase">paused</span>
                                    )}
                                  </p>
                                  <p className="text-[10px] text-muted-foreground mt-0.5">
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
                                    {!a.current_owner_id && (
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
                  )}
                </div>
              )}
            </div>

            <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
              <Button variant="outline" type="button" onClick={close}>Cancel</Button>
              <Button type="button" disabled={!selectedId || submitting} onClick={onSubmit}>
                {submitting ? <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" /> : <UserPlus className="h-3.5 w-3.5 mr-1.5" />}
                Assign
              </Button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
