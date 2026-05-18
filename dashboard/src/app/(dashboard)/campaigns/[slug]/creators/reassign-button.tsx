"use client";

/**
 * Reassign-remaining-posts button + modal.
 *
 * Mounted on each row of the campaign roster. When a creator leaves
 * mid-campaign, click this to:
 *   1. Close their assignment cleanly (capped to delivered posts).
 *   2. Open a new assignment for the replacement creator with the
 *      remaining posts as the target.
 *
 * The modal lazy-loads the directory of replacement creators on open
 * (active + invited only, excluding the current creator and anyone
 * already on this campaign). Selecting one shows a preview of the
 * counts before the operator confirms.
 */

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import {
  ArrowRightLeft,
  Loader2,
  X,
  AlertCircle,
  CheckCircle2,
  Search,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { reassignAssignment } from "../../../payouts/actions";

interface CreatorRow {
  id: string;
  legal_name: string;
  display_name: string | null;
  email: string;
  kind: "ugc" | "team_member";
}

interface Props {
  assignmentId: string;
  currentCreatorId: string;
  currentCreatorName: string;
  campaignId: string;
  postsDelivered: number;
  expectedPosts: number;
}

export function ReassignButton({
  assignmentId,
  currentCreatorId,
  currentCreatorName,
  campaignId,
  postsDelivered,
  expectedPosts,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [eligible, setEligible] = useState<CreatorRow[]>([]);
  // Set of creator ids that already have an assignment on this
  // campaign. Drives the two-section split in the picker AND the
  // "merge mode" flag once one of them is selected.
  const [onCampaignIds, setOnCampaignIds] = useState<Set<string>>(new Set());
  // For each on-campaign creator, what their current expected_posts
  // is — so we can render "Maya currently has 6 expected; adding N
  // means her new target is 6+N" in merge mode.
  const [onCampaignExpected, setOnCampaignExpected] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, startSubmit] = useTransition();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // Tab between "Pick existing" and "Invite new". Defaults to existing
  // unless there are no eligible creators — then we auto-flip to the
  // invite form so the operator isn't staring at an empty list.
  const [mode, setMode] = useState<"pick" | "invite">("pick");
  const [newLegal, setNewLegal] = useState("");
  const [newDisplay, setNewDisplay] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newKind, setNewKind] = useState<"ugc" | "team_member">("ugc");
  // Accounts the current creator owns on THIS campaign. We pre-flight
  // this on open so the operator can see exactly what will move and we
  // can block confirm if it's zero (server enforces the same rule).
  const [accountsToMoveCount, setAccountsToMoveCount] = useState<number | null>(null);

  const remaining = Math.max(0, expectedPosts - postsDelivered);

  // Target for the new creator's assignment. Defaults to remaining
  // when there's leftover work; falls back to the original campaign
  // target (or 1) when the old creator hit/exceeded their goal so the
  // operator can still hand off the role cleanly.
  const defaultNewTarget = remaining > 0 ? remaining : Math.max(expectedPosts, 1);
  const [newTarget, setNewTarget] = useState<number>(defaultNewTarget);

  // Load eligible replacement creators on open. Filters out the
  // current creator + anyone already on this campaign (those would
  // hit the unique-key constraint on insert). We also pre-count the
  // accounts that will move with the reassignment — accounts on THIS
  // campaign that the current creator owns. Zero is a hard block.
  useEffect(() => {
    if (!open) return;
    if (eligible.length > 0 && accountsToMoveCount !== null) return;
    setLoading(true);
    setError(null);
    const sb = createBrowserSupabase();
    Promise.all([
      sb.from("creators")
        .select("id, legal_name, display_name, email, kind")
        .in("status", ["invited", "onboarded"])
        .order("legal_name")
        .returns<CreatorRow[]>(),
      // Pull current assignments + their expected_posts so we can
      // (a) mark who's already on the campaign and (b) preview the
      // additive target in merge mode. status='completed' rows are
      // excluded — those creators are done with the campaign and
      // merging back into a closed assignment is the wrong operation.
      sb.from("assignments")
        .select("creator_id, expected_posts, status")
        .eq("campaign_id", campaignId)
        .neq("status", "completed")
        .returns<Array<{ creator_id: string; expected_posts: number; status: string }>>(),
      sb.from("creators")
        .select("owned_account_ids")
        .eq("id", currentCreatorId)
        .maybeSingle<{ owned_account_ids: string[] | null }>(),
    ]).then(async ([creatorsRes, assignRes, currentCreatorRes]) => {
      if (creatorsRes.error) { setError(creatorsRes.error.message); setLoading(false); return; }
      const assignRows = assignRes.data ?? [];
      const onCampaign = new Set(assignRows.map((a) => a.creator_id));
      const expectedByCreator = new Map(assignRows.map((a) => [a.creator_id, a.expected_posts]));
      // We now include on-campaign creators in `eligible` (we no
      // longer filter them out) — only excluding the current creator
      // being reassigned-away-from. The picker UI groups them into
      // two sections below.
      setEligible(
        (creatorsRes.data ?? []).filter((c) => c.id !== currentCreatorId),
      );
      setOnCampaignIds(onCampaign);
      setOnCampaignExpected(expectedByCreator);

      // Count accounts intersecting current creator's owned ids with
      // this campaign's accounts. Same query the server runs to gate.
      const ownedIds = currentCreatorRes.data?.owned_account_ids ?? [];
      if (ownedIds.length === 0) {
        setAccountsToMoveCount(0);
      } else {
        const { count } = await sb
          .from("accounts")
          .select("id", { count: "exact", head: true })
          .eq("campaign_id", campaignId)
          .in("id", ownedIds);
        setAccountsToMoveCount(count ?? 0);
      }
      setLoading(false);
    });
  }, [open, eligible.length, campaignId, currentCreatorId, accountsToMoveCount]);

  function reset() {
    setSelectedId(null);
    setSearch("");
    setError(null);
    setMode("pick");
    setNewLegal("");
    setNewDisplay("");
    setNewEmail("");
    setNewKind("ugc");
    setAccountsToMoveCount(null);
    setEligible([]);
    setOnCampaignIds(new Set());
    setOnCampaignExpected(new Map());
    setNewTarget(defaultNewTarget);
  }

  function close() {
    setOpen(false);
    reset();
  }

  function onConfirm() {
    setError(null);
    if (!Number.isInteger(newTarget) || newTarget < 1) {
      setError("New target must be a whole number of at least 1.");
      return;
    }
    if (mode === "pick") {
      if (!selectedId) { setError("Pick a replacement creator first."); return; }
      startSubmit(async () => {
        const r = await reassignAssignment({
          oldAssignmentId: assignmentId,
          newCreatorId: selectedId,
          expectedPosts: newTarget,
        });
        if (!r.ok) { setError(r.error); return; }
        close();
        router.refresh();
      });
    } else {
      // Invite new — minimal validation; the action enforces the rest.
      if (!newLegal.trim()) { setError("Legal name is required."); return; }
      if (!newEmail.trim()) { setError("Email is required."); return; }
      startSubmit(async () => {
        const r = await reassignAssignment({
          oldAssignmentId: assignmentId,
          newCreator: {
            legal_name: newLegal,
            display_name: newDisplay || null,
            email: newEmail,
            kind: newKind,
          },
          expectedPosts: newTarget,
        });
        if (!r.ok) { setError(r.error); return; }
        close();
        router.refresh();
      });
    }
  }

  // Selecting an on-campaign creator → MERGE mode. Their existing
  // assignment absorbs the leaving creator's accounts (no second
  // assignment is created — the schema's unique(creator_id,campaign_id)
  // means there can only ever be one). The post-target input now
  // represents how much extra work to ADD to that creator's commitment.
  const mergeMode = mode === "pick" && !!selectedId && onCampaignIds.has(selectedId);
  const mergeTargetCurrent = mergeMode ? onCampaignExpected.get(selectedId!) ?? 0 : 0;

  const filtered = eligible.filter((c) => {
    if (!search.trim()) return true;
    const s = search.toLowerCase();
    return (
      c.legal_name.toLowerCase().includes(s) ||
      (c.display_name?.toLowerCase().includes(s) ?? false) ||
      c.email.toLowerCase().includes(s)
    );
  });

  // We intentionally do NOT hide the button when remaining === 0.
  // Reassignment is about handing off the campaign ROLE (accounts +
  // ongoing responsibility), not just leftover work. A creator who
  // over-delivered (277 of 3) or hit target still needs reassignment
  // when they leave the company. The dialog asks the operator for a
  // fresh expected_posts target in that case.

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          setOpen(true);
        }}
        className="inline-flex items-center gap-1 rounded-md border border-input bg-background hover:bg-muted/60 px-2 py-1 text-[11px] font-medium transition-colors"
        title="Hand this campaign — accounts and remaining posts — off to another creator"
      >
        <ArrowRightLeft className="h-3 w-3" />
        Reassign
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
              <div>
                <h2 className="text-base font-semibold">Reassign this campaign</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {currentCreatorName} delivered{" "}
                  <span className="font-semibold text-foreground">{postsDelivered}</span> of{" "}
                  <span className="font-semibold text-foreground">{expectedPosts}</span>. Hand the
                  campaign role — accounts and post target — off to another creator.
                </p>
              </div>
              <button onClick={close} className="text-muted-foreground hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Hard block when there's truly nothing to move AND the
                  operator is creating a fresh assignment for someone
                  new. In merge mode (picking an on-campaign creator)
                  we let 0 accounts through — the operation is still
                  meaningful as a "close this creator's assignment,
                  add their work to an existing campaign-mate." */}
              {accountsToMoveCount === 0 && !mergeMode && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    {currentCreatorName} has no accounts attached to this campaign — there&apos;s nothing to hand off.
                    To bring in a brand-new creator, attach an account to {currentCreatorName} first, or use{" "}
                    <span className="font-medium">Assign creator</span>. To pass the work to an existing
                    campaign-mate, pick one of them below — that path doesn&apos;t require any accounts to move.
                  </span>
                </div>
              )}

              {/* Tab switcher — pick from existing creators or invite a
                  brand new one inline. The inline-invite path creates
                  the creator + opens the new assignment in one server
                  call so the operator never has to leave this modal. */}
              <div className="grid grid-cols-2 gap-1 p-1 bg-muted/40 rounded-md">
                <button
                  type="button"
                  onClick={() => { setMode("pick"); setError(null); }}
                  className={`text-xs font-medium py-1.5 rounded ${
                    mode === "pick" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Pick existing
                </button>
                <button
                  type="button"
                  onClick={() => { setMode("invite"); setSelectedId(null); setError(null); }}
                  className={`text-xs font-medium py-1.5 rounded ${
                    mode === "invite" ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  Invite new
                </button>
              </div>

              {/* Editable expected-posts target. Two modes:
                    - NEW creator path: this number becomes the new
                      assignment's expected_posts.
                    - MERGE path (on-campaign creator selected): this
                      number is ADDED to that creator's existing target.
                      We render the live preview "X + N = Y" so the
                      operator sees exactly what they're committing.
                  Defaults to remaining when there's leftover work. */}
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <label htmlFor="reassign-new-target" className="text-xs font-medium">
                    {mergeMode ? "Extra posts to add to their target" : "New creator's post target"}
                  </label>
                  <span className="text-[11px] text-muted-foreground">
                    {remaining > 0
                      ? `${remaining} remaining from original target`
                      : `original target hit (${postsDelivered}/${expectedPosts} delivered)`}
                  </span>
                </div>
                <Input
                  id="reassign-new-target"
                  type="number"
                  min={1}
                  step={1}
                  value={Number.isFinite(newTarget) ? newTarget : ""}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    setNewTarget(Number.isFinite(v) ? Math.floor(v) : Number.NaN);
                  }}
                />
                {mergeMode ? (
                  <p className="text-[11px] text-muted-foreground">
                    Their current target is{" "}
                    <span className="font-medium text-foreground">{mergeTargetCurrent}</span>; this brings the
                    new total to{" "}
                    <span className="font-medium text-foreground">
                      {mergeTargetCurrent + (Number.isFinite(newTarget) ? newTarget : 0)}
                    </span>
                    . Edit later via the campaign edit page.
                  </p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    How many posts the new creator commits to delivering. Edit any time after via the campaign edit page.
                  </p>
                )}
              </div>

              {mode === "pick" ? (
                <>
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                    <Input
                      className="pl-9"
                      placeholder="Search by name or email…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </div>

                  <div className="border border-border/50 rounded-md max-h-64 overflow-y-auto">
                    {loading ? (
                      <div className="py-8 text-center text-xs text-muted-foreground">
                        <Loader2 className="h-4 w-4 mx-auto animate-spin" />
                        <p className="mt-2">Loading creators…</p>
                      </div>
                    ) : filtered.length === 0 ? (
                      <div className="py-6 text-center text-xs text-muted-foreground space-y-2">
                        {eligible.length === 0 ? (
                          <>
                            <p>No eligible replacement creators in your directory.</p>
                            <button
                              type="button"
                              onClick={() => setMode("invite")}
                              className="text-primary hover:underline font-medium"
                            >
                              Invite a new creator instead →
                            </button>
                          </>
                        ) : (
                          <p>No matches for &ldquo;{search}&rdquo;.</p>
                        )}
                      </div>
                    ) : (
                      // Two-section list: existing campaign creators on
                      // top (the common "redistribute within the team"
                      // path), other creators below (the "bring in an
                      // outsider" path). Each section header gives the
                      // operator a quick reminder of what picking from
                      // it actually does.
                      (() => {
                        const onCampaign = filtered.filter((c) => onCampaignIds.has(c.id));
                        const others = filtered.filter((c) => !onCampaignIds.has(c.id));
                        const renderRow = (c: CreatorRow) => {
                          const isOnCampaign = onCampaignIds.has(c.id);
                          const theirExpected = onCampaignExpected.get(c.id);
                          return (
                            <label
                              key={c.id}
                              className={`flex items-center gap-3 px-3 py-2 cursor-pointer transition-colors ${
                                selectedId === c.id ? "bg-emerald-500/10" : "hover:bg-muted/30"
                              }`}
                            >
                              <input
                                type="radio"
                                name="reassign-creator"
                                checked={selectedId === c.id}
                                onChange={() => setSelectedId(c.id)}
                                className="h-3.5 w-3.5"
                              />
                              <div className="flex-1 min-w-0">
                                <p className="text-sm font-medium">
                                  {c.display_name || c.legal_name}
                                  {c.kind === "team_member" && (
                                    <span className="ml-2 text-[9px] uppercase tracking-wider rounded-full px-1.5 py-0.5 bg-blue-500/10 text-blue-700">
                                      Team
                                    </span>
                                  )}
                                  {isOnCampaign && theirExpected !== undefined && (
                                    <span className="ml-2 text-[10px] text-muted-foreground font-normal">
                                      · already on campaign · {theirExpected} expected
                                    </span>
                                  )}
                                </p>
                                <p className="text-[11px] text-muted-foreground">{c.email}</p>
                              </div>
                            </label>
                          );
                        };
                        return (
                          <div>
                            {onCampaign.length > 0 && (
                              <>
                                <div className="px-3 py-1.5 bg-muted/30 text-[10px] uppercase tracking-widest text-muted-foreground font-medium border-b border-border/40">
                                  On this campaign · adds to their existing target
                                </div>
                                <div className="divide-y divide-border/40">
                                  {onCampaign.map(renderRow)}
                                </div>
                              </>
                            )}
                            {others.length > 0 && (
                              <>
                                <div className="px-3 py-1.5 bg-muted/30 text-[10px] uppercase tracking-widest text-muted-foreground font-medium border-y border-border/40">
                                  Other creators · creates a new assignment
                                </div>
                                <div className="divide-y divide-border/40">
                                  {others.map(renderRow)}
                                </div>
                              </>
                            )}
                          </div>
                        );
                      })()
                    )}
                  </div>
                </>
              ) : (
                /* Invite-new form — minimal fields. Action defaults
                   preferred_processor to "manual"; admin can refine on
                   the creator profile page afterwards. */
                <div className="space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Legal name *</label>
                      <Input value={newLegal} onChange={(e) => setNewLegal(e.target.value)} placeholder="Maya Chen" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Display name</label>
                      <Input value={newDisplay} onChange={(e) => setNewDisplay(e.target.value)} placeholder="Maya" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Email *</label>
                      <Input type="email" value={newEmail} onChange={(e) => setNewEmail(e.target.value)} placeholder="maya@example.com" />
                    </div>
                    <div className="space-y-1">
                      <label className="text-xs font-medium">Creator type</label>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() => setNewKind("ugc")}
                          className={`flex-1 px-2 py-1.5 rounded-md border text-xs transition-colors ${
                            newKind === "ugc" ? "border-primary bg-primary/10" : "border-input hover:bg-muted/40"
                          }`}
                        >
                          UGC
                        </button>
                        <button
                          type="button"
                          onClick={() => setNewKind("team_member")}
                          className={`flex-1 px-2 py-1.5 rounded-md border text-xs transition-colors ${
                            newKind === "team_member" ? "border-primary bg-primary/10" : "border-input hover:bg-muted/40"
                          }`}
                        >
                          Team member
                        </button>
                      </div>
                    </div>
                  </div>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Payout method defaults to <span className="font-mono">manual</span> — you can change it
                    later from the creator&apos;s profile page. Owned accounts (for team members) are also editable there.
                  </p>
                </div>
              )}

              {/* Preview of what will happen — clear, no surprises. Two
                  variants depending on whether we're picking existing
                  or inviting new; copy is otherwise the same shape. */}
              {(mode === "pick" && selectedId) || (mode === "invite" && newLegal.trim() && newEmail.trim()) ? (
                <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-3 py-2.5 text-xs">
                  <p className="font-semibold text-foreground mb-1">After confirming:</p>
                  <ul className="space-y-1 text-muted-foreground list-disc list-inside">
                    <li>
                      {currentCreatorName}&apos;s assignment closes as <span className="font-mono text-foreground">completed</span>{" "}
                      with {postsDelivered}/{postsDelivered} delivered.
                    </li>
                    <li>Their past posts and earnings stay with them. Accounts on other campaigns are untouched.</li>
                    {mode === "invite" && (
                      <li>
                        A new creator{" "}
                        <span className="font-medium text-foreground">{newDisplay || newLegal}</span>{" "}
                        is added to your directory.
                      </li>
                    )}
                    <li>
                      {mergeMode ? (
                        <>
                          <span className="font-medium text-foreground">
                            {eligible.find((c) => c.id === selectedId)?.display_name ??
                              eligible.find((c) => c.id === selectedId)?.legal_name}
                          </span>
                          &apos;s existing assignment absorbs the work — their target goes from{" "}
                          <span className="font-semibold text-foreground">{mergeTargetCurrent}</span>
                          {" "}to{" "}
                          <span className="font-semibold text-foreground">
                            {mergeTargetCurrent + (Number.isFinite(newTarget) ? newTarget : 0)}
                          </span>
                          {" "}expected posts.
                        </>
                      ) : (
                        <>
                          A new <span className="font-mono text-foreground">active</span> assignment opens for{" "}
                          <span className="font-medium text-foreground">
                            {mode === "pick"
                              ? eligible.find((c) => c.id === selectedId)?.display_name ?? eligible.find((c) => c.id === selectedId)?.legal_name
                              : (newDisplay || newLegal)}
                          </span>{" "}
                          with <span className="font-semibold text-foreground">{newTarget} post{newTarget === 1 ? "" : "s"}</span> as the target.
                        </>
                      )}
                    </li>
                    {accountsToMoveCount !== null && accountsToMoveCount > 0 && (
                      <li>
                        <span className="font-semibold text-foreground">
                          {accountsToMoveCount} account{accountsToMoveCount === 1 ? "" : "s"}
                        </span>{" "}
                        on this campaign move to the new creator. Future posts on those handles auto-attribute to them, so analytics and payouts start fresh.
                      </li>
                    )}
                    <li>Any pending account requests the original creator had open on this campaign are auto-cancelled.</li>
                    <li>Same rate-card multipliers carry over. Edit later from the campaign edit page if needed.</li>
                  </ul>
                </div>
              ) : null}
            </div>

            <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
              <Button variant="outline" type="button" onClick={close} disabled={submitting}>
                Cancel
              </Button>
              <Button
                type="button"
                onClick={onConfirm}
                disabled={
                  submitting ||
                  // Block on zero accounts ONLY when creating a fresh
                  // assignment. Merge mode (on-campaign creator picked)
                  // is allowed through even when nothing moves.
                  (accountsToMoveCount === 0 && !mergeMode) ||
                  !Number.isInteger(newTarget) || newTarget < 1 ||
                  (mode === "pick" ? !selectedId : !newLegal.trim() || !newEmail.trim())
                }
              >
                {submitting ? (
                  <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />
                )}
                {mode === "invite"
                  ? `Invite & hand off (${newTarget} post${newTarget === 1 ? "" : "s"})`
                  : mergeMode
                    ? `Merge into their assignment (+${newTarget} post${newTarget === 1 ? "" : "s"})`
                    : `Reassign (${newTarget} post${newTarget === 1 ? "" : "s"})`}
              </Button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
