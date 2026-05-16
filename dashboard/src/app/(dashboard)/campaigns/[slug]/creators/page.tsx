/**
 * /campaigns/[slug]/creators — per-campaign creator roster.
 *
 * Shows all assignments on this campaign with: creator info, post
 * progress (delivered vs expected), earnings-to-date, payout status
 * tally, and a link into the full creator profile.
 *
 * Includes the budget-spent progress bar at the top — the operator's
 * single most-glanced UI element on this tab.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronRight, UserPlus, AlertCircle } from "lucide-react";
import type {
  Campaign,
  CampaignPayoutConfig,
  Assignment,
  Creator,
  Payout,
} from "@/lib/types";
import { CampaignAssignCreatorButton } from "./assign-button";
import { ReassignButton } from "./reassign-button";
import {
  ManageAccountsButton,
  type CampaignAccountOption,
} from "./manage-accounts-button";

export const dynamic = "force-dynamic";

interface RosterRow {
  assignment: Assignment;
  creator: Creator;
  posts_delivered: number;
  /** Posts published today (server UTC date — matches posts.date). */
  posts_today: number;
  /** Posts published in the rolling 7-day window ending today. */
  posts_last7: number;
  /** Most recent posts.date for this assignment, or null if none yet. */
  last_post_date: string | null;
  /** Daily post counts for the last 7 days, oldest → newest. Drives
   *  the sparkline column. Length is always 7; missing days are 0. */
  daily_counts_7d: number[];
  earned_cents: number;
  pending_cents: number;
  approved_cents: number;
  paid_cents: number;
}

async function load(slug: string): Promise<{
  campaign: Campaign;
  config: CampaignPayoutConfig | null;
  roster: RosterRow[];
  total_budget_cents: number | null;
  total_earned_cents: number;
  total_paid_cents: number;
  /**
   * Every TikTok account on this campaign, with the creator (if any)
   * who currently owns it. Powers the "Manage accounts" modal per row.
   */
  campaignAccounts: CampaignAccountOption[];
  /** Server's "today" in UTC (YYYY-MM-DD). Passed to the row so the
   *  "Last: X" label can compute its relative-date string against
   *  the same reference the roster used when bucketing posts. */
  todayKey: string;
} | null> {
  const sb = await createClient();
  const { data: campaign } = await sb
    .from("campaigns")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<Campaign>();
  if (!campaign) return null;

  const [{ data: config }, { data: assignments }, { data: payouts }, { data: posts }, { data: accounts }] = await Promise.all([
    sb.from("campaign_payout_configs").select("*").eq("campaign_id", campaign.id).maybeSingle<CampaignPayoutConfig>(),
    sb.from("assignments").select("*").eq("campaign_id", campaign.id).returns<Assignment[]>(),
    sb.from("payouts").select("creator_id, status, amount_cents").eq("campaign_id", campaign.id).returns<Pick<Payout, "creator_id" | "status" | "amount_cents">[]>(),
    // posts.date is the canonical "when did it go live" — same field
    // used by POST-TRACKER and ACCOUNT-STATS. created_at is the row
    // insert time which differs for back-filled rows.
    //
    // We also pull account (the handle) so we can fall back to
    // "which creator owns this handle?" for rows where the post was
    // inserted without a creator_id/assignment_id (drafts that landed
    // before account ownership was wired up, manual SQL inserts, etc.).
    // Today ~4% of recent posts hit this fallback; once the pipeline
    // is updated to always stamp creator_id at insert time, this just
    // becomes belt-and-braces.
    sb.from("posts").select("creator_id, assignment_id, date, account").eq("campaign_id", campaign.id).returns<Array<{ creator_id: string | null; assignment_id: string | null; date: string | null; account: string | null }>>(),
    // Pull the campaign's accounts up front so the manage-accounts
    // modal on each row already has the full list to show — saves
    // a per-row client-side fetch when the operator clicks Accounts.
    sb.from("accounts").select("id, handle, name, active").eq("campaign_id", campaign.id).returns<Array<{ id: string; handle: string; name: string | null; active: boolean }>>(),
  ]);

  // todayKey is also used by the empty-roster early return so callers
  // get a stable shape regardless of whether assignments exist.
  const todayKeyEarly = new Date().toISOString().slice(0, 10);
  if (!assignments || assignments.length === 0) {
    return {
      campaign,
      config: config ?? null,
      roster: [],
      total_budget_cents: config?.total_budget_cents ?? null,
      total_earned_cents: 0,
      total_paid_cents: 0,
      campaignAccounts: [],
      todayKey: todayKeyEarly,
    };
  }

  // Pull creator rows for everyone assigned (one round-trip).
  const creatorIds = [...new Set(assignments.map(a => a.creator_id))];
  const { data: creators } = await sb.from("creators").select("*").in("id", creatorIds).returns<Creator[]>();
  const creatorMap = new Map((creators ?? []).map(c => [c.id, c]));

  // Pre-compute the 7-day window once (UTC YYYY-MM-DD strings) so the
  // per-row reducer below is just dictionary lookups instead of date
  // math per post. Server runs in UTC on Vercel; mismatch with the
  // operator's local "today" can be up to ~24h around midnight which
  // we accept — the rolling 7d cushion absorbs it.
  const today = new Date();
  const dayKey = (d: Date) => d.toISOString().slice(0, 10);
  const todayKey = dayKey(today);
  const last7Keys: string[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setUTCDate(d.getUTCDate() - i);
    last7Keys.push(dayKey(d));
  }
  const last7Set = new Set(last7Keys);

  // Build a handle → creator_id map from the roster's owned accounts.
  // This is the *cross-reference* the operator asked for: when a post
  // row was inserted without a creator_id (common for drafts that the
  // creator later publishes manually), we still want to credit the
  // post to whichever creator owns that TikTok account on this
  // campaign. accounts.id matches creators.owned_account_ids; the
  // accounts payload above gives us id → handle.
  const accountIdToHandle = new Map((accounts ?? []).map(a => [a.id, a.handle]));
  const handleToCreatorId = new Map<string, string>();
  for (const c of creators ?? []) {
    for (const accId of c.owned_account_ids ?? []) {
      const handle = accountIdToHandle.get(accId);
      // First win — multiple creators claiming the same account is a
      // data bug (the Manage Accounts UI enforces one-owner) but if
      // it happens we credit the first to surface and the operator
      // sees both rows lighting up the issue.
      if (handle && !handleToCreatorId.has(handle)) {
        handleToCreatorId.set(handle, c.id);
      }
    }
  }

  // Resolve every post to exactly one creator using a three-tier
  // fallback. Building this map ONCE (instead of filtering posts per
  // assignment) means no post gets double-counted across two
  // assignments for the same creator, and each post lands in
  // exactly one bucket.
  const assignmentById = new Map(assignments.map(a => [a.id, a]));
  const postsByCreator = new Map<string, Array<{ date: string }>>();
  for (const p of posts ?? []) {
    if (!p.date) continue;
    let resolved: string | null = null;
    // 1) assignment_id is the strongest signal — the assignment row
    //    explicitly named the creator.
    if (p.assignment_id) {
      resolved = assignmentById.get(p.assignment_id)?.creator_id ?? null;
    }
    // 2) creator_id stamped directly on the post — used by the
    //    pipeline when there's no specific assignment in play.
    if (!resolved && p.creator_id) resolved = p.creator_id;
    // 3) Cross-reference fallback: which creator owns this handle?
    //    This is the path that catches the ~4% of orphans where the
    //    post landed before ownership was recorded.
    if (!resolved && p.account) resolved = handleToCreatorId.get(p.account) ?? null;
    if (!resolved) continue;
    const arr = postsByCreator.get(resolved) ?? [];
    arr.push({ date: p.date });
    postsByCreator.set(resolved, arr);
  }

  // Aggregate payouts + post counts per assignment.
  const roster: RosterRow[] = assignments.map((a) => {
    const c = creatorMap.get(a.creator_id);
    if (!c) {
      // Orphan assignment with a deleted creator — render a stub
      // row so the operator can fix the data.
      return {
        assignment: a,
        creator: {
          id: a.creator_id, kind: "ugc", legal_name: "(deleted creator)",
          display_name: null, email: "", country: null,
          preferred_processor: "manual", manual_payout_notes: null,
          owned_account_ids: [], status: "archived",
          invited_at: a.invited_at, onboarded_at: null, created_at: a.invited_at,
          payment_upi_id: null, payment_screenshot_path: null, payment_screenshot_uploaded_at: null,
        },
        posts_delivered: 0,
        posts_today: 0, posts_last7: 0, last_post_date: null,
        daily_counts_7d: new Array(7).fill(0),
        earned_cents: 0, pending_cents: 0, approved_cents: 0, paid_cents: 0,
      };
    }
    const myPayouts = (payouts ?? []).filter(p => p.creator_id === a.creator_id);
    const pending = myPayouts.filter(p => p.status === "pending").reduce((s, p) => s + p.amount_cents, 0);
    const approved = myPayouts.filter(p => p.status === "approved" || p.status === "processing").reduce((s, p) => s + p.amount_cents, 0);
    const paid = myPayouts.filter(p => p.status === "paid").reduce((s, p) => s + p.amount_cents, 0);
    // Posts are bucketed per-creator (not per-assignment) above — that
    // lets the account-ownership fallback catch orphan rows AND
    // collapses multi-assignment-same-creator into one count, which
    // is what the operator means by "how many posts has Maya made".
    // For the common 1-assignment-per-creator case this is identical
    // to the old assignment_id filter.
    const myPosts = postsByCreator.get(a.creator_id) ?? [];
    const delivered = myPosts.length;

    // Cadence metrics: walk this assignment's posts once, tally into
    // today / last7 / per-day buckets and track the max date.
    let postsToday = 0;
    let postsLast7 = 0;
    let lastPostDate: string | null = null;
    const perDay = new Map<string, number>();
    for (const p of myPosts) {
      if (!p.date) continue;
      if (!lastPostDate || p.date > lastPostDate) lastPostDate = p.date;
      if (p.date === todayKey) postsToday++;
      if (last7Set.has(p.date)) {
        postsLast7++;
        perDay.set(p.date, (perDay.get(p.date) ?? 0) + 1);
      }
    }
    const dailyCounts7d = last7Keys.map(k => perDay.get(k) ?? 0);

    return {
      assignment: a,
      creator: c,
      posts_delivered: delivered,
      posts_today: postsToday,
      posts_last7: postsLast7,
      last_post_date: lastPostDate,
      daily_counts_7d: dailyCounts7d,
      earned_cents: pending + approved + paid,
      pending_cents: pending,
      approved_cents: approved,
      paid_cents: paid,
    };
  });

  const total_earned = roster.reduce((s, r) => s + r.earned_cents, 0);
  const total_paid = roster.reduce((s, r) => s + r.paid_cents, 0);

  // Cross-reference each campaign account with the rostered creators
  // to find its current owner (if any). We only consider creators
  // assigned to THIS campaign — an account owned by some other
  // creator outside the roster shows as unassigned here, which is
  // the right call (the operator can't move it to someone they
  // can't even see on this page).
  const ownerByAccountId = new Map<string, { id: string; name: string }>();
  for (const r of roster) {
    const owned = r.creator.owned_account_ids ?? [];
    for (const accId of owned) {
      // First win — if two creators on the roster both list the same
      // account id, that's a data-bug, but we surface the first one
      // and the "Manage" save will clean it up (one-owner invariant).
      if (!ownerByAccountId.has(accId)) {
        ownerByAccountId.set(accId, {
          id: r.creator.id,
          name: r.creator.display_name || r.creator.legal_name,
        });
      }
    }
  }
  const campaignAccounts: CampaignAccountOption[] = (accounts ?? []).map((a) => {
    const owner = ownerByAccountId.get(a.id);
    return {
      id: a.id,
      handle: a.handle,
      name: a.name,
      active: a.active,
      current_owner_id: owner?.id ?? null,
      current_owner_name: owner?.name ?? null,
    };
  });

  return {
    campaign,
    config: config ?? null,
    roster,
    total_budget_cents: config?.total_budget_cents ?? null,
    total_earned_cents: total_earned,
    total_paid_cents: total_paid,
    campaignAccounts,
    todayKey,
  };
}

function fmt(cents: number, currency: string): string {
  const sym = currency === "USD" ? "$" : currency === "INR" ? "₹" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "";
  return `${sym}${(cents / 100).toFixed(2)}`;
}

export default async function CampaignCreatorsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();

  const { campaign, config, roster, total_budget_cents, total_earned_cents, total_paid_cents, campaignAccounts, todayKey } = data;
  const currency = config?.currency ?? "USD";
  const utilizationPct = total_budget_cents && total_budget_cents > 0
    ? Math.min(100, (total_earned_cents / total_budget_cents) * 100)
    : null;

  return (
    <div className="space-y-5">
      {/* Soft-warn when the campaign has no payout config — without it,
          the runner skips this campaign and no payouts ever materialise. */}
      {(!config || config.mode === "none") && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-500/5 px-3 py-2 text-xs">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
          <div className="flex-1">
            <p className="font-medium text-foreground">No payout configuration on this campaign yet.</p>
            <p className="text-muted-foreground mt-0.5">
              Set a rate card on the{" "}
              <Link href={`/campaigns/${slug}/edit`} className="text-primary underline-offset-4 hover:underline">Edit page</Link>
              {" "}so the calculator knows how much each creator earns.
            </p>
          </div>
        </div>
      )}

      {/* Budget bar */}
      {total_budget_cents && total_budget_cents > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-2 text-xs">
              <span className="text-muted-foreground">Budget utilization</span>
              <span className="tabular-nums font-medium">
                {fmt(total_earned_cents, currency)} earned / {fmt(total_budget_cents, currency)} budget
              </span>
            </div>
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  utilizationPct! >= 90 ? "bg-destructive" :
                  utilizationPct! >= 80 ? "bg-amber-500" :
                  "bg-primary"
                }`}
                style={{ width: `${utilizationPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-2 text-[11px] text-muted-foreground">
              <span>{utilizationPct!.toFixed(1)}% used</span>
              <span>
                {fmt(total_paid_cents, currency)} paid externally · {fmt(total_earned_cents - total_paid_cents, currency)} outstanding
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Header + invite */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-base font-semibold">Creators on {campaign.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Assignments + delivery progress. Click a row for the creator&apos;s full profile.
          </p>
        </div>
        <CampaignAssignCreatorButton campaignId={campaign.id} multipliers={config?.multipliers ?? []} campaignAccounts={campaignAccounts} />
      </div>

      {/* Roster */}
      {roster.length === 0 ? (
        <Card className="border-dashed border border-border/60">
          <CardContent className="py-10 text-center text-sm text-muted-foreground space-y-3">
            <p>No creators assigned yet.</p>
            <CampaignAssignCreatorButton campaignId={campaign.id} multipliers={config?.multipliers ?? []} campaignAccounts={campaignAccounts} variant="outline" label="Assign your first creator" />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-0 divide-y divide-border/60">
            {roster.map((row) => (
              <div
                key={row.assignment.id}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
              >
                {/* Whole-row click → creator profile, except the
                    Reassign button which has its own stop-propagation. */}
                <Link
                  href={`/creators/${row.creator.id}`}
                  className="flex items-center justify-between gap-3 min-w-0 flex-1"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium flex items-center gap-2">
                      {row.creator.display_name || row.creator.legal_name}
                      <StatusBadge status={row.assignment.status} />
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {row.posts_delivered} / {row.assignment.expected_posts} posts ·{" "}
                      {row.creator.email}
                      {row.assignment.rate_override_cents != null && (
                        <> · <span className="font-mono">{fmt(row.assignment.rate_override_cents, currency)}/post override</span></>
                      )}
                      {row.assignment.applied_multipliers.length > 0 && (
                        <> · {row.assignment.applied_multipliers.length} multiplier{row.assignment.applied_multipliers.length === 1 ? "" : "s"}</>
                      )}
                    </p>
                    {/* Cadence row — the operator's at-a-glance answer
                        to "is this creator still active this week?".
                        Today's count is bold + colored so a quick scan
                        surfaces idle creators. Sparkline shows the
                        last 7 days' rhythm. */}
                    <div className="flex items-center gap-3 mt-1.5 text-[11px]">
                      <span className={`tabular-nums font-semibold ${
                        row.posts_today > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"
                      }`}>
                        Today: {row.posts_today}
                      </span>
                      <span className="text-muted-foreground">
                        7d: <span className="tabular-nums font-medium text-foreground">{row.posts_last7}</span>
                        {" "}<span className="text-muted-foreground/70">({(row.posts_last7 / 7).toFixed(1)}/day)</span>
                      </span>
                      <span className="text-muted-foreground">
                        Last: <span className="font-medium text-foreground">{formatRelativeDate(row.last_post_date, todayKey)}</span>
                      </span>
                      <Sparkline counts={row.daily_counts_7d} />
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">{fmt(row.earned_cents, currency)}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {row.pending_cents > 0 && <span className="text-amber-600">{fmt(row.pending_cents, currency)} pending</span>}
                      {row.pending_cents > 0 && row.paid_cents > 0 && " · "}
                      {row.paid_cents > 0 && <span className="text-emerald-600">{fmt(row.paid_cents, currency)} paid</span>}
                    </p>
                  </div>
                </Link>

                {/* Actions column — only the Reassign button for now,
                    only shown when there's remaining work to hand off
                    AND the assignment is still active/accepted. */}
                <div className="flex items-center gap-2 shrink-0 pl-2 border-l border-border/40 ml-1">
                  {/* "Accounts (N)" — opens the campaign-account
                      picker for this specific creator so the operator
                      can say "Maya owns these 6 of the 30 accounts on
                      this campaign". Server enforces one-owner. */}
                  <ManageAccountsButton
                    creatorId={row.creator.id}
                    creatorName={row.creator.display_name || row.creator.legal_name}
                    campaignId={campaign.id}
                    allCampaignAccounts={campaignAccounts}
                    initiallyOwnedIds={campaignAccounts
                      .filter((a) => a.current_owner_id === row.creator.id)
                      .map((a) => a.id)}
                  />
                  {(row.assignment.status === "active" || row.assignment.status === "accepted") && (
                    <ReassignButton
                      assignmentId={row.assignment.id}
                      currentCreatorId={row.creator.id}
                      currentCreatorName={row.creator.display_name || row.creator.legal_name}
                      campaignId={campaign.id}
                      postsDelivered={row.posts_delivered}
                      expectedPosts={row.assignment.expected_posts}
                    />
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

/**
 * Render a posts.date string as a relative-day phrase the operator
 * can scan quickly. UTC-day comparison — matches how the roster
 * bucketed the posts above, so "Today" here always agrees with
 * "Today: N" on the same row.
 *   2026-05-14 (and today is 2026-05-14) → "Today"
 *   2026-05-13                            → "Yesterday"
 *   2026-05-09                            → "5d ago"
 *   2026-04-01                            → "Apr 1"
 *   null                                  → "—"
 */
function formatRelativeDate(d: string | null, today: string): string {
  if (!d) return "—";
  if (d === today) return "Today";
  const t = Date.parse(today + "T00:00:00Z");
  const x = Date.parse(d + "T00:00:00Z");
  if (Number.isNaN(t) || Number.isNaN(x)) return d;
  const diffDays = Math.round((t - x) / 86_400_000);
  if (diffDays === 1) return "Yesterday";
  if (diffDays > 1 && diffDays <= 30) return `${diffDays}d ago`;
  // Older than 30 days → show month/day so we don't end up with
  // "112d ago" which the operator has to mentally convert.
  const dt = new Date(x);
  return dt.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });
}

/**
 * Inline 7-day bar sparkline. Each bar's height is normalised to the
 * row's own max (not a global max) so a creator who posts 1/day looks
 * "full" instead of getting visually crushed by another creator who
 * posts 10/day. That keeps each row's bar legible on its own terms;
 * the cross-creator comparison stays in the numeric "7d" column.
 */
function Sparkline({ counts }: { counts: number[] }) {
  const max = Math.max(1, ...counts);
  return (
    <span
      aria-label={`Last 7 days: ${counts.join(", ")} posts`}
      className="inline-flex items-end gap-0.5 h-4"
    >
      {counts.map((n, i) => {
        const heightPct = Math.max(8, (n / max) * 100);
        const today = i === counts.length - 1;
        return (
          <span
            key={i}
            className={`w-1 rounded-sm ${
              n === 0
                ? "bg-muted"
                : today
                  ? "bg-emerald-500"
                  : "bg-muted-foreground/60"
            }`}
            style={{ height: `${heightPct}%` }}
            title={`${n} post${n === 1 ? "" : "s"}`}
          />
        );
      })}
    </span>
  );
}

function StatusBadge({ status }: { status: Assignment["status"] }) {
  const colour =
    status === "active"     ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" :
    status === "completed"  ? "bg-blue-500/15 text-blue-700 dark:text-blue-400" :
    status === "pending"    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" :
    "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${colour}`}>
      {status}
    </span>
  );
}
