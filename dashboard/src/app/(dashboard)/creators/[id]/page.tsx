/**
 * /creators/[id] — full creator profile.
 *
 * Top: identity + payout method + earnings card (pending / approved /
 * paid trio with last-30-day trend).
 *
 * Below: per-campaign assignment list, then full payout history with
 * per-row breakdown drawer (the same pattern as /payouts but scoped
 * to this creator).
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  ArrowLeft, Mail, Globe, Wallet,
  Eye, Heart, Bookmark, MessageCircle,
} from "lucide-react";
import type { Creator, Assignment, Campaign, PayoutWithJoins } from "@/lib/types";
import { PayoutsList } from "../../payouts/payouts-list";
import { CreatorDangerZone } from "./danger-zone";
import { OwnedAccountsEditor } from "./owned-accounts-editor";
import { AllPostsDropdown } from "./all-posts-collapsible";

export const dynamic = "force-dynamic";

interface AssignmentRow {
  assignment: Assignment;
  campaign: Pick<Campaign, "id" | "slug" | "name" | "status">;
  posts_delivered: number;
  earned_cents: number;
  views: number;
  likes: number;
}

// Shape we pull for every post tagged to this creator. Picks the
// columns the profile actually renders (totals, per-account stats,
// recent list) so we never have to round-trip a second time.
interface CreatorPost {
  id: string;
  date: string | null;
  account: string | null;
  views: number | null;
  likes: number | null;
  saves: number | null;
  shares: number | null;
  comments: number | null;
  status: string | null;
  tiktok_url: string | null;
  hook_style: string | null;
  format: string | null;
  assignment_id: string | null;
  campaign_id: string | null;
}

async function load(id: string) {
  const sb = await createClient();

  const [{ data: creator }, { data: assignments }, { data: payouts }, { data: posts }] = await Promise.all([
    sb.from("creators").select("*").eq("id", id).maybeSingle<Creator>(),
    sb.from("assignments")
      .select("*, campaign:campaign_id(id, slug, name, status)")
      .eq("creator_id", id)
      .returns<Array<Assignment & { campaign: Pick<Campaign, "id"|"slug"|"name"|"status"> | Pick<Campaign, "id"|"slug"|"name"|"status">[] }>>(),
    sb.from("payouts")
      .select("*, creator:creator_id(id, legal_name, display_name, email, preferred_processor, manual_payout_notes, payment_upi_id, payment_screenshot_path, payment_screenshot_uploaded_at), campaign:campaign_id(id, slug, name)")
      .eq("creator_id", id)
      .order("created_at", { ascending: false })
      .returns<PayoutWithJoins[]>(),
    sb.from("posts")
      .select("id, date, account, views, likes, saves, shares, comments, status, tiktok_url, hook_style, format, assignment_id, campaign_id")
      .eq("creator_id", id)
      .order("date", { ascending: false })
      .returns<CreatorPost[]>(),
  ]);

  if (!creator) return null;

  // Resolve owned_account_ids → account rows (with their campaign) so
  // we can render a real "Owned accounts" panel on the profile.
  // Cheap: at most a few dozen ids per creator. Skipped entirely when
  // the array is empty so UGC creators don't trigger a wasted query.
  const ownedIds = creator.owned_account_ids ?? [];
  type OwnedAccount = {
    id: string;
    handle: string;
    name: string | null;
    active: boolean;
    campaign: { slug: string; name: string } | { slug: string; name: string }[] | null;
  };
  let ownedAccountsRaw: OwnedAccount[] = [];
  if (ownedIds.length > 0) {
    const { data } = await sb
      .from("accounts")
      .select("id, handle, name, active, campaign:campaign_id(slug, name)")
      .in("id", ownedIds)
      .order("handle")
      .returns<OwnedAccount[]>();
    ownedAccountsRaw = data ?? [];
  }

  const safeAssignments = (assignments ?? []).map((a) => {
    const campRaw = a.campaign;
    const campaign = Array.isArray(campRaw) ? campRaw[0] : campRaw;
    return { ...a, campaign };
  }).filter((a): a is Assignment & { campaign: Pick<Campaign,"id"|"slug"|"name"|"status"> } => !!a.campaign);

  const safePayouts: PayoutWithJoins[] = (payouts ?? []).map((p: PayoutWithJoins & {
    creator: PayoutWithJoins["creator"] | PayoutWithJoins["creator"][];
    campaign: PayoutWithJoins["campaign"] | PayoutWithJoins["campaign"][];
  }) => ({
    ...p,
    creator: Array.isArray(p.creator) ? p.creator[0] : p.creator,
    campaign: Array.isArray(p.campaign) ? p.campaign[0] : p.campaign,
  })) as PayoutWithJoins[];

  const allPosts = posts ?? [];

  // Per-assignment stats: posts delivered + earnings + view/like
  // totals on that campaign. Useful when multiple creators share a
  // campaign — mam can compare each creator's contribution side by
  // side on their respective profile pages.
  const assignmentRows: AssignmentRow[] = safeAssignments.map((a) => {
    const earned = safePayouts
      .filter((p) => p.assignment_id === a.id && (p.status === "paid" || p.status === "approved" || p.status === "pending"))
      .reduce((s, p) => s + p.amount_cents, 0);
    const postsOnAssignment = allPosts.filter((p) => p.assignment_id === a.id);
    const delivered = postsOnAssignment.length;
    const views = postsOnAssignment.reduce((s, p) => s + (p.views ?? 0), 0);
    const likes = postsOnAssignment.reduce((s, p) => s + (p.likes ?? 0), 0);
    return {
      assignment: a,
      campaign: a.campaign,
      posts_delivered: delivered,
      earned_cents: earned,
      views,
      likes,
    };
  });

  // Per-handle breakdown: which @accounts has this creator's content
  // gone out on, and what did each contribute. Sorted by views desc
  // so the top-performing handle is first.
  const perAccount = new Map<string, {
    handle: string; posts: number; views: number; likes: number; saves: number; shares: number; comments: number;
  }>();
  for (const p of allPosts) {
    const h = p.account;
    if (!h) continue;
    const cur = perAccount.get(h) ?? { handle: h, posts: 0, views: 0, likes: 0, saves: 0, shares: 0, comments: 0 };
    cur.posts += 1;
    cur.views += p.views ?? 0;
    cur.likes += p.likes ?? 0;
    cur.saves += p.saves ?? 0;
    cur.shares += p.shares ?? 0;
    cur.comments += p.comments ?? 0;
    perAccount.set(h, cur);
  }
  // `perAccount` is still used below to merge post stats into each
  // owned-account row — we just no longer surface the full
  // accounts-they-post-on breakdown on the profile.

  // Flatten the campaign join (Supabase returns it as object|array)
  // and merge the post-stats so each owned account row can show its
  // own contribution without a second lookup at render time.
  const ownedAccounts = ownedAccountsRaw.map((a) => {
    const camp = Array.isArray(a.campaign) ? a.campaign[0] : a.campaign;
    const stats = perAccount.get(a.handle);
    return {
      id: a.id,
      handle: a.handle,
      name: a.name,
      active: a.active,
      campaign_slug: camp?.slug ?? null,
      campaign_name: camp?.name ?? null,
      posts: stats?.posts ?? 0,
      views: stats?.views ?? 0,
    };
  });

  return { creator, assignmentRows, payouts: safePayouts, allPosts, ownedAccounts };
}

function fmtUsd(cents: number, currency: string = "USD"): string {
  const sym = currency === "USD" ? "$" : currency === "INR" ? "₹" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "";
  return `${sym}${(cents / 100).toFixed(2)}`;
}

export default async function CreatorProfilePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await load(id);
  if (!data) notFound();
  const { creator, assignmentRows, payouts, allPosts, ownedAccounts } = data;

  // Earnings card numbers — across ALL of this creator's campaigns.
  const pending = payouts.filter((p) => p.status === "pending").reduce((s, p) => s + p.amount_cents, 0);
  const approved = payouts.filter((p) => p.status === "approved" || p.status === "processing").reduce((s, p) => s + p.amount_cents, 0);
  const paid = payouts.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount_cents, 0);
  const totalEarned = pending + approved + paid;

  // Aggregate engagement across every post tagged to this creator.
  // These five numbers are what mam will look at first to decide
  // "is this creator pulling their weight."
  const totalPosts = allPosts.length;
  const publishedPosts = allPosts.filter((p) => p.status === "published").length;
  const totalViews = allPosts.reduce((s, p) => s + (p.views ?? 0), 0);
  const totalLikes = allPosts.reduce((s, p) => s + (p.likes ?? 0), 0);
  const totalSaves = allPosts.reduce((s, p) => s + (p.saves ?? 0), 0);
  const totalEngagements = allPosts.reduce(
    (s, p) => s + (p.likes ?? 0) + (p.saves ?? 0) + (p.comments ?? 0) + (p.shares ?? 0),
    0,
  );
  const engagementRate = totalViews > 0 ? (totalEngagements / totalViews) * 100 : 0;
  const recentPosts = allPosts.slice(0, 6);

  // Time-bucketed post counts so mam can scan recent productivity.
  // Compare post.date (YYYY-MM-DD) against today / -6d / -29d windows.
  // Posts with a null date (rare — only happens for pre-publish drafts)
  // fall out of all three buckets, which is the right behaviour.
  const today = new Date();
  const todayStr = today.toISOString().slice(0, 10);
  const sevenDaysAgo = new Date(today.getTime() - 6 * 86_400_000).toISOString().slice(0, 10);
  const thirtyDaysAgo = new Date(today.getTime() - 29 * 86_400_000).toISOString().slice(0, 10);
  const postsToday = allPosts.filter((p) => p.date === todayStr).length;
  const postsThisWeek = allPosts.filter((p) => p.date && p.date >= sevenDaysAgo).length;
  const postsThisMonth = allPosts.filter((p) => p.date && p.date >= thirtyDaysAgo).length;

  return (
    <div className="space-y-6">
      <Link href="/creators" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-3.5 w-3.5" /> Back to creators
      </Link>

      {/* Header — identity + payout method */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">{creator.display_name || creator.legal_name}</h1>
          <p className="text-muted-foreground mt-1 flex items-center gap-3 text-sm">
            <span className="inline-flex items-center gap-1">
              <Mail className="h-3.5 w-3.5" /> {creator.email}
            </span>
            {creator.country && (
              <span className="inline-flex items-center gap-1">
                <Globe className="h-3.5 w-3.5" /> {creator.country}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Wallet className="h-3.5 w-3.5" /> {creator.preferred_processor}
            </span>
          </p>
          {creator.kind === "team_member" && (
            <p className="text-[11px] text-muted-foreground mt-1">
              Team member — owns {creator.owned_account_ids.length} account{creator.owned_account_ids.length === 1 ? "" : "s"}
              {creator.owned_account_ids.length === 0 && " (none assigned yet — set below)"}
            </p>
          )}
        </div>
      </div>

      {/* Earnings card */}
      <Card>
        <CardContent className="pt-6 space-y-4">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
            Earnings
          </p>
          <p className="text-4xl font-bold tabular-nums">{fmtUsd(totalEarned)}</p>
          <p className="text-xs text-muted-foreground">
            across {assignmentRows.length} campaign{assignmentRows.length === 1 ? "" : "s"} · {payouts.length} payout{payouts.length === 1 ? "" : "s"}
          </p>
          <div className="grid grid-cols-3 gap-3 pt-2 border-t border-border/40">
            <SubMetric label="Pending approval" value={fmtUsd(pending)} accent="amber" />
            <SubMetric label="Approved · awaiting payment" value={fmtUsd(approved)} accent="blue" />
            <SubMetric label="Paid externally" value={fmtUsd(paid)} accent="emerald" />
          </div>

          {creator.preferred_processor === "manual" && creator.manual_payout_notes && (
            <div className="pt-3 border-t border-border/40">
              <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Payout method</p>
              <code className="block mt-1 text-xs font-mono bg-muted/50 px-3 py-2 rounded">{creator.manual_payout_notes}</code>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Performance overview — five top-line numbers across every post
          tagged to this creator. Always rendered, even at zero, so the
          page layout stays consistent and "no posts yet" is obvious. */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <PerfTile label="Posts" value={totalPosts.toLocaleString("en-US")} hint={totalPosts > 0 ? `${publishedPosts} published` : "no posts yet"} />
        <PerfTile label="Views" value={totalViews.toLocaleString("en-US")} />
        <PerfTile label="Likes" value={totalLikes.toLocaleString("en-US")} />
        <PerfTile label="Saves" value={totalSaves.toLocaleString("en-US")} />
        <PerfTile label="Engagement" value={totalPosts > 0 ? `${engagementRate.toFixed(1)}%` : "—"} hint={totalPosts > 0 ? "likes + saves + comments + shares ÷ views" : undefined} />
      </div>

      {/* Activity at a glance — how many posts in the recent windows.
          Critical when comparing multiple creators on the same
          campaign: who actually shipped this week? */}
      <Card>
        <CardContent className="pt-6">
          <p className="text-base font-semibold mb-3">Activity</p>
          <div className="grid grid-cols-3 gap-3">
            <ActivityTile label="Posted today" value={postsToday} accent={postsToday > 0 ? "emerald" : "muted"} />
            <ActivityTile label="Last 7 days" value={postsThisWeek} accent={postsThisWeek > 0 ? "emerald" : "muted"} />
            <ActivityTile label="Last 30 days" value={postsThisMonth} accent={postsThisMonth > 0 ? "emerald" : "muted"} />
          </div>
          {totalPosts === 0 && (
            <p className="text-[11px] text-muted-foreground mt-3 leading-relaxed">
              {creator.kind === "ugc"
                ? "Nothing tagged to this creator yet — tag posts to them from the post detail drawer."
                : "Posts on their owned accounts will appear here once they go live and the runner ticks."}
            </p>
          )}
        </CardContent>
      </Card>

      {/* Owned accounts — the ownership relationship straight from
          creators.owned_account_ids. Shown for every creator type
          so the operator can answer "what does this person own?"
          at a glance. Post-stats (views + count) on each row are
          merged in from the perAccount aggregation above. */}
      <Card>
        <CardContent className="pt-6">
          <div className="flex items-baseline justify-between mb-3">
            <div>
              <p className="text-base font-semibold">Owned accounts</p>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                Handles this creator owns. Future posts on these auto-attribute to them.
              </p>
            </div>
            <p className="text-xs text-muted-foreground shrink-0">
              {ownedAccounts.length === 0
                ? "none assigned"
                : `${ownedAccounts.length} handle${ownedAccounts.length === 1 ? "" : "s"}`}
            </p>
          </div>
          {ownedAccounts.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
              {creator.kind === "team_member" ? (
                <>
                  No accounts assigned yet. Assign them from a campaign&apos;s{" "}
                  <span className="font-medium text-foreground">Creators</span> tab
                  &rsaquo; the row&apos;s <span className="font-medium text-foreground">Accounts</span> button.
                </>
              ) : (
                "UGC creators don't typically own accounts. Their posts are tagged manually via the post detail drawer."
              )}
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {ownedAccounts.map((a) => (
                <div key={a.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium flex items-center gap-2">
                      <span className="font-mono">@{a.handle}</span>
                      {!a.active && (
                        <span className="text-[10px] uppercase tracking-wider text-muted-foreground rounded-full bg-muted px-1.5 py-0.5">
                          paused
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {a.name ? `${a.name} · ` : ""}
                      {a.campaign_slug ? (
                        <Link
                          href={`/campaigns/${a.campaign_slug}`}
                          className="hover:underline"
                        >
                          {a.campaign_name}
                        </Link>
                      ) : (
                        <span className="italic">unassigned to a campaign</span>
                      )}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-sm font-semibold tabular-nums">
                      {a.views > 0 ? a.views.toLocaleString("en-US") : "—"}
                    </p>
                    <p className="text-[10px] text-muted-foreground">
                      {a.posts > 0 ? `${a.posts} post${a.posts === 1 ? "" : "s"}` : "no posts yet"}
                    </p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Recent posts — at-a-glance list of the latest 6 things this
          creator has posted, with view counts and a TikTok link.
          Empty state explains how to get posts tagged. */}
      <Card>
        <CardContent className="pt-6">
          <p className="text-base font-semibold mb-3">Recent posts</p>
          {recentPosts.length === 0 ? (
            <div className="rounded-md border border-dashed border-border/60 bg-muted/20 px-4 py-6 text-center text-xs text-muted-foreground">
              Nothing posted yet by this creator.
              {creator.kind === "ugc"
                ? " UGC posts are tagged manually — open the post drawer on /posts and pick this creator."
                : " Posts on their owned accounts will auto-tag here on the next analytics tick."}
            </div>
          ) : (
            <div className="divide-y divide-border/60">
              {recentPosts.map((p) => (
                <div key={p.id} className="flex items-center gap-4 py-3">
                  {/* Left: hook + meta. Width-capped so it can't push
                      the metrics off-screen on narrow viewports; the
                      metrics row stays right-aligned via ml-auto. */}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{p.hook_style || "—"}</p>
                    <p className="text-xs text-muted-foreground mt-0.5 truncate">
                      {p.date}
                      {p.account && <> · @{p.account}</>}
                      {p.format && <> · {p.format}</>}
                      {p.status && p.status !== "published" && (
                        <> · <span className="uppercase">{p.status}</span></>
                      )}
                    </p>
                  </div>
                  {/* Right: compact metric chips. Showed views only
                      before; lifted likes/saves/comments inline here
                      so the row is scannable without clicking through
                      to the post drawer. Icons disambiguate the
                      numbers without needing per-cell text labels. */}
                  <div className="flex items-center gap-3 shrink-0 text-xs tabular-nums text-muted-foreground">
                    <MetricChip icon={Eye} value={p.views} title="Views" />
                    <MetricChip icon={Heart} value={p.likes} title="Likes" />
                    <MetricChip icon={Bookmark} value={p.saves} title="Saves" />
                    <MetricChip icon={MessageCircle} value={p.comments} title="Comments" />
                  </div>
                  {p.tiktok_url && p.tiktok_url !== "-" ? (
                    <a
                      href={p.tiktok_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs font-medium text-emerald-600 hover:underline shrink-0"
                    >
                      View →
                    </a>
                  ) : (
                    <span className="text-[10px] text-muted-foreground/60 uppercase shrink-0">{p.status ?? "—"}</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* All posts — collapsible. Holds the full list (vs Recent posts'
          top 6) plus an inline search. Each row opens the universal
          post detail drawer via PostTrigger when clicked. Default
          collapsed to keep the profile compact for a creator with
          hundreds of posts. */}
      <AllPostsDropdown
        posts={allPosts.map((p) => ({
          id: p.id,
          date: p.date,
          account: p.account,
          views: p.views,
          likes: p.likes,
          saves: p.saves,
          status: p.status,
          hook_style: p.hook_style,
          format: p.format,
          tiktok_url: p.tiktok_url,
        }))}
      />

      {/* Team-member-only: which engine-managed accounts they own. Auto-attribution
          relies on this list — keep it editable inline rather than via SQL. */}
      {creator.kind === "team_member" && (
        <OwnedAccountsEditor
          creatorId={creator.id}
          initialOwnedIds={creator.owned_account_ids}
        />
      )}

      {/* Per-campaign assignments — each row now also shows the views
          and likes this creator's posts pulled on that specific
          campaign. When multiple creators share a campaign, this is
          where you compare contributions side-by-side (open each
          creator's profile in parallel tabs). */}
      {assignmentRows.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-base font-semibold mb-3">Campaigns</p>
            <div className="divide-y divide-border/60">
              {assignmentRows.map((r) => (
                <Link
                  key={r.assignment.id}
                  href={`/campaigns/${r.campaign.slug}/creators`}
                  className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-4 py-3 hover:bg-muted/40 -mx-4 px-4 transition-colors"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium truncate">{r.campaign.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {r.posts_delivered} / {r.assignment.expected_posts} posts ·{" "}
                      <span className="uppercase">{r.assignment.status}</span>
                      {r.assignment.applied_multipliers.length > 0 && (
                        <> · {r.assignment.applied_multipliers.length} multiplier{r.assignment.applied_multipliers.length === 1 ? "" : "s"}</>
                      )}
                    </p>
                  </div>
                  <div className="text-right tabular-nums">
                    <p className="text-sm font-medium">{r.views.toLocaleString("en-US")}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">views</p>
                  </div>
                  <div className="text-right tabular-nums">
                    <p className="text-sm font-medium">{r.likes.toLocaleString("en-US")}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">likes</p>
                  </div>
                  <div className="text-right tabular-nums">
                    <p className="text-sm font-semibold">{fmtUsd(r.earned_cents)}</p>
                    <p className="text-[10px] text-muted-foreground uppercase tracking-widest">earned</p>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Full payout list — reuses the global inbox component */}
      {payouts.length > 0 && (
        <div>
          <p className="text-base font-semibold mb-3">Payout history</p>
          <PayoutsList initial={payouts} />
        </div>
      )}

      {/* Danger zone — archive (soft) and delete (hard, blocked if payouts) */}
      <CreatorDangerZone
        id={creator.id}
        email={creator.email}
        displayLabel={creator.display_name || creator.legal_name}
        status={creator.status}
        hasActivePayouts={payouts.some((p) => p.status === "pending" || p.status === "approved" || p.status === "processing")}
      />
    </div>
  );
}

function SubMetric({ label, value, accent }: { label: string; value: string; accent: "amber" | "blue" | "emerald" }) {
  const colour =
    accent === "amber" ? "text-amber-600" :
    accent === "blue" ? "text-blue-600" :
    "text-emerald-600";
  return (
    <div>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`text-lg font-bold tabular-nums mt-0.5 ${colour}`}>{value}</p>
    </div>
  );
}

function PerfTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-border bg-card px-4 py-3 transition-colors hover:border-emerald-500/30">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums mt-1 leading-none">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground mt-2">{hint}</p>}
    </div>
  );
}

function ActivityTile({ label, value, accent }: { label: string; value: number; accent: "emerald" | "muted" }) {
  const numClass = accent === "emerald"
    ? "text-emerald-600 dark:text-emerald-400"
    : "text-muted-foreground";
  return (
    <div className="rounded-lg bg-muted/30 px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`text-2xl font-bold tabular-nums mt-1 leading-none ${numClass}`}>
        {value.toLocaleString("en-US")}
      </p>
      <p className="text-[10px] text-muted-foreground mt-1">post{value === 1 ? "" : "s"}</p>
    </div>
  );
}

/**
 * Compact icon + number used in the Recent-posts row. Renders nothing
 * (a muted "—") when the metric hasn't been pulled yet — drafts and
 * very-fresh posts will hit this path until the next analytics tick.
 * `title` becomes the native tooltip so hovering names the metric.
 */
function MetricChip({
  icon: Icon,
  value,
  title,
}: {
  icon: React.ComponentType<{ className?: string }>;
  value: number | null | undefined;
  title: string;
}) {
  return (
    <span
      className="inline-flex items-center gap-1 whitespace-nowrap"
      title={title}
      aria-label={title}
    >
      <Icon className="h-3.5 w-3.5" />
      <span>{value == null ? "—" : compactNum(value)}</span>
    </span>
  );
}

/**
 * Compact-decimal formatter for inline metric chips. 12_345 → "12.3K",
 * 1_200_000 → "1.2M". Falls back to plain locale-formatted digits
 * under 1,000 so small counts (a 7-view draft) stay precise. We use
 * Intl directly so the rounding stays in sync with the browser's
 * locale even if we later add more locales.
 */
function compactNum(n: number): string {
  if (n < 1000) return n.toLocaleString("en-US");
  return new Intl.NumberFormat("en-US", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}
