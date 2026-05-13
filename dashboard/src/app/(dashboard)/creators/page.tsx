/**
 * /creators — global creator directory.
 *
 * Lists every creator (UGC + team_member rows) with their status,
 * earnings-to-date across all campaigns, and a quick "Invite" entry
 * point. Click a row → /creators/<id>.
 */

import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { UserPlus, ChevronRight, User2 } from "lucide-react";
import type { Creator } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * Activity bucket — derived from each creator's last post date.
 * Mam's question "is this creator posting or not" maps cleanly to
 * these four buckets:
 *
 *   - active_today  → posted at least once today
 *   - active_week   → posted in the last 7 days but not today
 *   - idle          → has past posts but nothing in 7+ days
 *   - never_posted  → no posts ever tagged to them
 */
type ActivityStatus = "active_today" | "active_week" | "idle" | "never_posted";

interface CreatorRowAgg extends Creator {
  total_earned_cents: number;     // sum of paid + approved + pending
  pending_cents: number;
  approved_cents: number;
  paid_cents: number;
  campaign_count: number;
  // Posting activity
  total_posts: number;
  posts_today: number;
  posts_last_7d: number;
  last_posted_at: string | null;  // YYYY-MM-DD or null
  activity: ActivityStatus;
}

async function loadCreators(): Promise<CreatorRowAgg[]> {
  const sb = await createClient();
  const { data: creators } = await sb
    .from("creators")
    .select("*")
    .order("created_at", { ascending: false })
    .returns<Creator[]>();

  if (!creators || creators.length === 0) return [];

  // Pull payouts AND posts in parallel — one round-trip each. Posts
  // table stays under a few thousand rows in our setup; if it ever
  // explodes we'll move this to a SQL view with per-creator counts.
  const [{ data: payouts }, { data: posts }] = await Promise.all([
    sb.from("payouts")
      .select("creator_id, campaign_id, status, amount_cents")
      .returns<Array<{ creator_id: string; campaign_id: string; status: string; amount_cents: number }>>(),
    sb.from("posts")
      .select("creator_id, date")
      .not("creator_id", "is", null)
      .returns<Array<{ creator_id: string | null; date: string | null }>>(),
  ]);

  const aggMap = new Map<string, {
    earned: number; pending: number; approved: number; paid: number; campaigns: Set<string>;
    total_posts: number; posts_today: number; posts_last_7d: number; last_posted_at: string | null;
  }>();
  for (const c of creators) {
    aggMap.set(c.id, {
      earned: 0, pending: 0, approved: 0, paid: 0, campaigns: new Set(),
      total_posts: 0, posts_today: 0, posts_last_7d: 0, last_posted_at: null,
    });
  }

  for (const p of payouts ?? []) {
    const a = aggMap.get(p.creator_id);
    if (!a) continue;
    a.campaigns.add(p.campaign_id);
    if (p.status === "pending") { a.pending += p.amount_cents; a.earned += p.amount_cents; }
    else if (p.status === "approved" || p.status === "processing") { a.approved += p.amount_cents; a.earned += p.amount_cents; }
    else if (p.status === "paid") { a.paid += p.amount_cents; a.earned += p.amount_cents; }
  }

  // Date buckets — compute today + 7-day cutoff once outside the loop.
  // posts.date is stored as YYYY-MM-DD text so string comparison is
  // safe (lexicographic order matches calendar order at this resolution).
  const today = new Date().toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(Date.now() - 6 * 86_400_000).toISOString().slice(0, 10);

  for (const post of posts ?? []) {
    if (!post.creator_id) continue;
    const a = aggMap.get(post.creator_id);
    if (!a) continue;
    a.total_posts += 1;
    if (post.date) {
      if (post.date === today) a.posts_today += 1;
      if (post.date >= sevenDaysAgo) a.posts_last_7d += 1;
      if (!a.last_posted_at || post.date > a.last_posted_at) a.last_posted_at = post.date;
    }
  }

  return creators.map((c) => {
    const a = aggMap.get(c.id) ?? {
      earned: 0, pending: 0, approved: 0, paid: 0, campaigns: new Set(),
      total_posts: 0, posts_today: 0, posts_last_7d: 0, last_posted_at: null,
    };
    let activity: ActivityStatus;
    if (a.total_posts === 0) activity = "never_posted";
    else if (a.posts_today > 0) activity = "active_today";
    else if (a.posts_last_7d > 0) activity = "active_week";
    else activity = "idle";
    return {
      ...c,
      total_earned_cents: a.earned,
      pending_cents: a.pending,
      approved_cents: a.approved,
      paid_cents: a.paid,
      campaign_count: a.campaigns.size,
      total_posts: a.total_posts,
      posts_today: a.posts_today,
      posts_last_7d: a.posts_last_7d,
      last_posted_at: a.last_posted_at,
      activity,
    };
  });
}

function lastPostedLabel(date: string | null): string {
  if (!date) return "Never";
  const today = new Date().toISOString().slice(0, 10);
  if (date === today) return "Today";
  const d = new Date(date + "T00:00:00Z");
  const diffDays = Math.floor((Date.now() - d.getTime()) / 86_400_000);
  if (diffDays === 1) return "Yesterday";
  if (diffDays < 7) return `${diffDays}d ago`;
  if (diffDays < 30) return `${Math.floor(diffDays / 7)}w ago`;
  if (diffDays < 365) return `${Math.floor(diffDays / 30)}mo ago`;
  return `${Math.floor(diffDays / 365)}y ago`;
}

const ACTIVITY_LABEL: Record<ActivityStatus, { label: string; dot: string; pill: string }> = {
  active_today: {
    label: "Posted today",
    dot: "bg-emerald-500",
    pill: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  },
  active_week: {
    label: "Active this week",
    dot: "bg-blue-500",
    pill: "bg-blue-500/10 text-blue-700 dark:text-blue-400",
  },
  idle: {
    label: "Idle (no posts 7d+)",
    dot: "bg-amber-500",
    pill: "bg-amber-500/10 text-amber-700 dark:text-amber-400",
  },
  never_posted: {
    label: "Never posted",
    dot: "bg-muted-foreground/50",
    pill: "bg-muted text-muted-foreground",
  },
};

function fmtUsd(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

export default async function CreatorsPage({
  searchParams,
}: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" ? sp.tab : "all";
  const validTabs = ["all", "active_today", "active_week", "idle", "never_posted"] as const;
  type TabKey = typeof validTabs[number];
  const activeTab: TabKey = (validTabs as readonly string[]).includes(tab) ? (tab as TabKey) : "all";

  const creators = await loadCreators();

  // Per-bucket counts — used by the tab pills to show how many
  // creators each filter would surface. Always computed across the
  // full creators list (not the filtered one) so the counts don't
  // shift based on the current tab.
  const bucketCounts: Record<TabKey, number> = {
    all: creators.length,
    active_today: creators.filter((c) => c.activity === "active_today").length,
    active_week: creators.filter((c) => c.activity === "active_week").length,
    idle: creators.filter((c) => c.activity === "idle").length,
    never_posted: creators.filter((c) => c.activity === "never_posted").length,
  };

  const filteredCreators =
    activeTab === "all" ? creators : creators.filter((c) => c.activity === activeTab);

  const totalEarned = creators.reduce((s, c) => s + c.total_earned_cents, 0);
  const totalPending = creators.reduce((s, c) => s + c.pending_cents, 0);
  const totalPaid = creators.reduce((s, c) => s + c.paid_cents, 0);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Creators</h1>
          <p className="text-muted-foreground mt-1">
            Everyone the platform calculates payouts for — UGC creators and team
            members behind engine-managed accounts. Earnings update automatically
            after each analytics refresh.
          </p>
        </div>
        <Link href="/creators/new">
          <Button>
            <UserPlus className="h-4 w-4 mr-1.5" />
            Invite creator
          </Button>
        </Link>
      </div>

      {/* Summary tiles */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <SummaryTile label="Total earned (all-time)" value={fmtUsd(totalEarned)} />
        <SummaryTile label="Pending approval" value={fmtUsd(totalPending)} accent="amber" />
        <SummaryTile label="Paid externally" value={fmtUsd(totalPaid)} accent="emerald" />
      </div>

      {/* Activity tabs — answers mam's "is this creator posting?"
          question. URL-driven (?tab=…) so links are shareable and
          browser back/forward navigates between filters. */}
      {creators.length > 0 && (
        <div className="flex flex-wrap gap-1.5 border-b border-border/60">
          <TabPill href="/creators" label="All" count={bucketCounts.all} active={activeTab === "all"} />
          <TabPill href="/creators?tab=active_today" label="Posted today" count={bucketCounts.active_today} active={activeTab === "active_today"} accent="emerald" />
          <TabPill href="/creators?tab=active_week" label="This week" count={bucketCounts.active_week} active={activeTab === "active_week"} accent="blue" />
          <TabPill href="/creators?tab=idle" label="Idle (7d+)" count={bucketCounts.idle} active={activeTab === "idle"} accent="amber" />
          <TabPill href="/creators?tab=never_posted" label="Never posted" count={bucketCounts.never_posted} active={activeTab === "never_posted"} />
        </div>
      )}

      {creators.length === 0 ? (
        <Card className="border-dashed border border-border/60">
          <CardContent className="py-10 text-center text-sm text-muted-foreground space-y-3">
            <User2 className="h-6 w-6 mx-auto text-muted-foreground/60" />
            <p>No creators yet.</p>
            <Link href="/creators/new">
              <Button variant="outline" size="sm">
                <UserPlus className="h-3.5 w-3.5 mr-1.5" />
                Invite your first creator
              </Button>
            </Link>
          </CardContent>
        </Card>
      ) : filteredCreators.length === 0 ? (
        <Card className="border-dashed border border-border/60">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            <p>No creators match this filter.</p>
            <Link href="/creators" className="text-primary hover:underline mt-2 inline-block text-xs">
              Show all creators →
            </Link>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-0 divide-y divide-border/60">
            {filteredCreators.map((c) => {
              const meta = ACTIVITY_LABEL[c.activity];
              return (
                <Link
                  key={c.id}
                  href={`/creators/${c.id}`}
                  className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <span className={`h-2 w-2 rounded-full ${meta.dot} shrink-0`} title={meta.label} />
                      {c.display_name || c.legal_name}
                      <KindBadge kind={c.kind} />
                      {c.status !== "onboarded" && c.status !== "invited" && (
                        <span className="text-[10px] uppercase tracking-wider text-amber-600">{c.status}</span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {c.email}
                      {c.country && <> · {c.country}</>}
                      {c.campaign_count > 0 && <> · {c.campaign_count} campaign{c.campaign_count === 1 ? "" : "s"}</>}
                    </p>
                  </div>
                  <div className="flex items-center gap-4 shrink-0">
                    {/* Activity column — last-posted + this-week count */}
                    <div className="text-right hidden sm:block">
                      <p className="text-sm font-medium tabular-nums">{lastPostedLabel(c.last_posted_at)}</p>
                      <p className="text-[10px] text-muted-foreground">
                        {c.total_posts > 0 ? (
                          <>
                            {c.posts_last_7d}/wk · {c.total_posts} total
                          </>
                        ) : (
                          <>0 posts</>
                        )}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums">{fmtUsd(c.total_earned_cents)}</p>
                      <p className="text-[10px] text-muted-foreground">earned</p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function TabPill({
  href,
  label,
  count,
  active,
  accent,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
  accent?: "emerald" | "blue" | "amber";
}) {
  const accentBar =
    accent === "emerald" ? "border-emerald-500" :
    accent === "blue"    ? "border-blue-500"    :
    accent === "amber"   ? "border-amber-500"   :
                           "border-foreground";
  return (
    <Link
      href={href}
      className={`px-3 py-2 -mb-px border-b-2 transition-colors ${
        active ? `${accentBar} text-foreground` : "border-transparent text-muted-foreground hover:text-foreground"
      }`}
    >
      <p className="text-sm font-medium">{label}</p>
      <p className="text-[10px] text-muted-foreground tabular-nums">{count} creator{count === 1 ? "" : "s"}</p>
    </Link>
  );
}

function SummaryTile({ label, value, accent }: { label: string; value: string; accent?: "amber" | "emerald" }) {
  const accentClass =
    accent === "amber" ? "text-amber-600" :
    accent === "emerald" ? "text-emerald-600" :
    "text-foreground";
  return (
    <Card>
      <CardContent className="py-4">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className={`text-2xl font-bold tabular-nums mt-1 ${accentClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}

function KindBadge({ kind }: { kind: "ugc" | "team_member" }) {
  if (kind === "team_member") {
    return (
      <span className="text-[9px] uppercase tracking-wider rounded-full px-1.5 py-0.5 bg-blue-500/10 text-blue-700 dark:text-blue-400">
        Team
      </span>
    );
  }
  return null;
}
