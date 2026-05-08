/**
 * /campaigns/[slug] — Overview tab.
 *
 * Trackr-mirrored layout for one campaign:
 *   - KPI row (Videos · Views · Likes · Comments · Shares · Saves ·
 *     Engagement Rate · Comment Rate) with week-over-week trend arrows
 *   - Daily Views chart
 *   - Posting progress bar (X/Y posts) + countdown card
 *   - Top Posts (Cards/Table toggle)
 *   - Account Progress (Mon-Sun cadence grid per account)
 *   - Timeline card showing the campaign date range
 *
 * All scoped to the campaign via campaign_id. The layout (parent)
 * already loaded the campaign row + counts, but we re-load posts +
 * accounts here to do the heavy aggregation work.
 */

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Calendar as CalendarIcon, Target } from "lucide-react";
import type { Campaign } from "@/lib/types";
import { ViewsChart } from "@/components/views-chart";
import { KpiRow, type PostMetricRow } from "./kpi-row";
import { TopPosts, type TopPost } from "./top-posts";
import { AccountProgress, type AccountProgressRow } from "./account-progress";

export const revalidate = 30;

// ─── Helpers ────────────────────────────────────────────────────────

const DAY_MS = 86_400_000;

/** ISO Monday (00:00 UTC) of the week containing `d`. */
function isoWeekStart(d: Date): Date {
  const day = d.getUTCDay(); // 0 = Sunday … 6 = Saturday
  const diff = day === 0 ? 6 : day - 1; // Monday-first
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  monday.setUTCDate(monday.getUTCDate() - diff);
  return monday;
}

function formatDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

// ─── Data loader ────────────────────────────────────────────────────

async function loadOverview(slug: string) {
  const sb = await createClient();

  const { data: campaign } = await sb
    .from("campaigns")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<Campaign>();
  if (!campaign) return null;

  const [postsRes, accountsRes] = await Promise.all([
    sb
      .from("posts")
      .select("id, hook_style, account, views, likes, saves, shares, comments, save_rate, status, tiktok_url, thumbnail_url, date")
      .eq("campaign_id", campaign.id)
      .order("date", { ascending: false }),
    sb
      .from("accounts")
      .select("id, name, handle, active")
      .eq("campaign_id", campaign.id)
      .eq("active", true)
      .order("created_at", { ascending: true }),
  ]);

  const posts = postsRes.data ?? [];
  const accounts = accountsRes.data ?? [];

  return { campaign, posts, accounts };
}

// ─── Main page ──────────────────────────────────────────────────────

export default async function CampaignOverviewPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await loadOverview(slug);
  if (!data) notFound();

  const { campaign, posts, accounts } = data;

  // ── Prepare KPI data ──────────────────────────────────────────────
  const kpiPosts: PostMetricRow[] = posts.map((p) => ({
    date: p.date,
    views: p.views ?? 0,
    likes: p.likes ?? 0,
    saves: p.saves ?? 0,
    shares: p.shares ?? 0,
    comments: p.comments ?? 0,
    status: p.status,
  }));

  // ── Daily views chart data ────────────────────────────────────────
  const viewsByDate = new Map<string, number>();
  for (const p of posts) {
    if (p.status !== "published" || !p.date) continue;
    viewsByDate.set(p.date, (viewsByDate.get(p.date) ?? 0) + (p.views ?? 0));
  }
  const chartData = Array.from(viewsByDate.entries())
    .map(([date, views]) => ({ date, views }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ── Top Posts ─────────────────────────────────────────────────────
  const publishedPosts = posts.filter((p) => p.status === "published");
  const topPosts: TopPost[] = [...publishedPosts]
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
    .slice(0, 5)
    .map((p) => ({
      id: p.id,
      hook_style: p.hook_style,
      account: p.account,
      views: p.views ?? 0,
      likes: p.likes ?? 0,
      saves: p.saves ?? 0,
      shares: p.shares ?? 0,
      save_rate: p.save_rate,
      tiktok_url: p.tiktok_url,
      thumbnail_url: (p as { thumbnail_url?: string | null }).thumbnail_url ?? null,
      status: p.status,
      date: p.date,
    }));

  // ── Account Progress (Mon-Sun this week) ──────────────────────────
  const weekStart = isoWeekStart(new Date());
  const weekStartMs = weekStart.getTime();

  const progressByHandle = new Map<string, number[]>();
  for (const a of accounts) {
    progressByHandle.set(a.handle, [0, 0, 0, 0, 0, 0, 0]);
  }
  for (const p of publishedPosts) {
    if (!p.date || !p.account) continue;
    const t = new Date(p.date).getTime();
    if (t < weekStartMs) continue;
    if (t >= weekStartMs + 7 * DAY_MS) continue;
    const dayIdx = Math.min(6, Math.max(0, Math.floor((t - weekStartMs) / DAY_MS)));
    const arr = progressByHandle.get(p.account);
    if (arr) arr[dayIdx]++;
  }

  const progressRows: AccountProgressRow[] = accounts.map((a) => {
    const week = progressByHandle.get(a.handle) ?? [0, 0, 0, 0, 0, 0, 0];
    return {
      handle: a.handle,
      name: a.name,
      thisWeek: week,
      totalThisWeek: week.reduce((s, n) => s + n, 0),
      target: campaign.target_posts_per_week,
    };
  });

  // ── Posting progress totals (mirrors layout math) ─────────────────
  const totalPosts = posts.length;
  let postsTargetTotal = 0;
  if (campaign.start_date && campaign.end_date) {
    const weeks = Math.max(
      1,
      Math.round(
        (new Date(campaign.end_date).getTime() -
          new Date(campaign.start_date).getTime()) /
          (7 * DAY_MS),
      ),
    );
    postsTargetTotal = accounts.length * campaign.target_posts_per_week * weeks;
  }
  const progressPct = postsTargetTotal > 0
    ? Math.min(100, (totalPosts / postsTargetTotal) * 100)
    : null;

  return (
    <div className="space-y-6">
      {/* KPI row */}
      <KpiRow posts={kpiPosts} />

      {/* Chart + posting progress side-by-side */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <Card className="lg:col-span-2 shadow-sm border-0 ring-0">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <div>
                <p className="text-base font-semibold">Daily Views Over Time</p>
                <p className="text-sm text-muted-foreground">
                  Views per day across all posts in this campaign.
                </p>
              </div>
              <span className="flex items-center gap-1.5 text-xs">
                <span className="h-2 w-2 rounded-full bg-primary" />
                Views
              </span>
            </div>
            <ViewsChart data={chartData} />
          </CardContent>
        </Card>

        <Card className="shadow-sm border-0 ring-0">
          <CardContent className="pt-6 space-y-5">
            <div>
              <p className="text-base font-semibold">Posting Goals</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {campaign.target_posts_per_week} posts/week per account
              </p>
            </div>

            {progressPct !== null ? (
              <div className="space-y-2">
                <div className="flex items-baseline justify-between">
                  <p className="text-3xl font-bold tabular-nums">{totalPosts}</p>
                  <p className="text-sm text-muted-foreground tabular-nums">
                    of {postsTargetTotal}
                  </p>
                </div>
                <div className="h-2 w-full rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-primary"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <p className="text-xs text-muted-foreground tabular-nums">
                  {progressPct.toFixed(0)}% of target
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-3xl font-bold tabular-nums">{totalPosts}</p>
                <p className="text-xs text-muted-foreground">
                  posts published. Set start + end dates to compute a target.
                </p>
              </div>
            )}

            <div className="border-t border-border/60 pt-4 space-y-2 text-xs">
              <div className="flex items-center gap-2 text-muted-foreground">
                <Target className="h-3.5 w-3.5" />
                <span>{accounts.length} active account{accounts.length === 1 ? "" : "s"}</span>
              </div>
              <div className="flex items-center gap-2 text-muted-foreground">
                <CalendarIcon className="h-3.5 w-3.5" />
                <span>
                  {campaign.start_date && campaign.end_date
                    ? `${formatDate(new Date(campaign.start_date))} → ${formatDate(new Date(campaign.end_date))}`
                    : "No date range set"}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Posts */}
      <Card className="shadow-sm border-0 ring-0">
        <CardContent className="pt-6">
          <TopPosts posts={topPosts} />
        </CardContent>
      </Card>

      {/* Account Progress */}
      <AccountProgress accounts={progressRows} />
    </div>
  );
}
