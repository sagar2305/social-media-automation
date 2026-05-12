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
      sb.from("assignments")
        .select("creator_id")
        .eq("campaign_id", campaignId)
        .returns<Array<{ creator_id: string }>>(),
      sb.from("creators")
        .select("owned_account_ids")
        .eq("id", currentCreatorId)
        .maybeSingle<{ owned_account_ids: string[] | null }>(),
    ]).then(async ([creatorsRes, assignRes, currentCreatorRes]) => {
      if (creatorsRes.error) { setError(creatorsRes.error.message); setLoading(false); return; }
      const onCampaign = new Set((assignRes.data ?? []).map((a) => a.creator_id));
      setEligible(
        (creatorsRes.data ?? []).filter(
          (c) => c.id !== currentCreatorId && !onCampaign.has(c.id),
        ),
      );

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

              {/* Hard block: no campaign-scoped accounts to move means
                  the new creator can't actually post anything. Same
                  rule the server enforces; we surface it early. */}
              {accountsToMoveCount === 0 && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>
                    {currentCreatorName} has no accounts attached to this campaign — there&apos;s nothing to hand off.
                    Attach at least one account to them first (or use <span className="font-medium">Assign creator</span> to add the new creator directly).
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

              {/* Editable expected-posts target for the new assignment.
                  Defaults to remaining when there's leftover work, else
                  falls back to the original campaign target. Operator
                  can always override. Whole numbers only, min 1. */}
              <div className="space-y-1.5">
                <div className="flex items-baseline justify-between">
                  <label htmlFor="reassign-new-target" className="text-xs font-medium">
                    New creator&apos;s post target
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
                <p className="text-[11px] text-muted-foreground">
                  How many posts the new creator commits to delivering. Edit any time after via the campaign edit page.
                </p>
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
                      <div className="divide-y divide-border/40">
                        {filtered.map((c) => (
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
                              </p>
                              <p className="text-[11px] text-muted-foreground">{c.email}</p>
                            </div>
                          </label>
                        ))}
                      </div>
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
                      A new <span className="font-mono text-foreground">active</span> assignment opens for{" "}
                      <span className="font-medium text-foreground">
                        {mode === "pick"
                          ? eligible.find((c) => c.id === selectedId)?.display_name ?? eligible.find((c) => c.id === selectedId)?.legal_name
                          : (newDisplay || newLegal)}
                      </span>{" "}
                      with <span className="font-semibold text-foreground">{newTarget} post{newTarget === 1 ? "" : "s"}</span> as the target.
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
                  accountsToMoveCount === 0 ||
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
                  : `Reassign (${newTarget} post${newTarget === 1 ? "" : "s"})`}
              </Button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
