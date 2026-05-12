/**
 * /creator/posts — list of every post tagged to this creator across
 * every campaign, with views and the running save rate. Read-only.
 *
 * Deliberately does NOT show estimated earnings per post — that
 * number is sensitive to the rate card and a creator who sees it can
 * argue per-post over the multiplier menu. Total earnings are on the
 * landing page; this is just the work.
 */

/**
 * /creator/posts — full post history with creator-friendly analytics.
 *
 * Shows three things, in order:
 *   1. Top-line totals (count, views, saves, average save rate).
 *   2. Best-performing post highlight — by views, with the metric.
 *   3. Format leaderboard — average views per format the creator
 *      makes, sorted desc, so they know what's resonating.
 *   4. Full chronological list with per-post views / save rate /
 *      TikTok link.
 */

import { requireCreator } from "@/lib/auth";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Trophy, TrendingUp } from "lucide-react";
import { PostAnalyticsRow, type PostAnalytics } from "./post-analytics-row";

export const dynamic = "force-dynamic";

interface PostRow extends Omit<PostAnalytics, "campaign_name"> {
  flow: string | null;
  campaign: { name: string } | { name: string }[] | null;
}

export default async function CreatorPosts() {
  const { creator } = await requireCreator();
  const sb = await createClient();

  const { data } = await sb
    .from("posts")
    .select("id, date, hook_style, format, flow, views, likes, saves, shares, comments, save_rate, status, tiktok_url, thumbnail_url, campaign:campaign_id(name)")
    .eq("creator_id", creator.id)
    .order("date", { ascending: false })
    .returns<PostRow[]>();

  const posts = (data ?? []).map((p) => ({
    ...p,
    campaign: Array.isArray(p.campaign) ? p.campaign[0] : p.campaign,
  }));

  const totalViews = posts.reduce((s, p) => s + (p.views ?? 0), 0);
  const totalLikes = posts.reduce((s, p) => s + (p.likes ?? 0), 0);
  const totalSaves = posts.reduce((s, p) => s + (p.saves ?? 0), 0);
  const totalComments = posts.reduce((s, p) => s + (p.comments ?? 0), 0);
  const totalShares = posts.reduce((s, p) => s + (p.shares ?? 0), 0);
  const totalEngagements = totalLikes + totalSaves + totalComments + totalShares;
  const overallEngagementRate = totalViews > 0 ? (totalEngagements / totalViews) * 100 : 0;
  const avgViews = posts.length > 0 ? totalViews / posts.length : 0;
  const avgSaveRate = posts.length > 0
    ? posts.reduce((s, p) => s + Number(p.save_rate ?? 0), 0) / posts.length
    : 0;

  // Best post by views — only consider published ones, fallback to any.
  const published = posts.filter((p) => p.status === "published");
  const candidates = published.length > 0 ? published : posts;
  const bestPost = candidates.length > 0
    ? candidates.reduce((best, p) => ((p.views ?? 0) > (best.views ?? 0) ? p : best))
    : null;

  // Format leaderboard — group by format, average views. Skip 'Other'/null
  // and formats with only 1 post (one data point isn't a trend).
  const byFormat = new Map<string, { views: number; count: number }>();
  for (const p of posts) {
    if (!p.format) continue;
    const cur = byFormat.get(p.format) ?? { views: 0, count: 0 };
    byFormat.set(p.format, { views: cur.views + (p.views ?? 0), count: cur.count + 1 });
  }
  const formatLeaderboard = [...byFormat.entries()]
    .map(([format, agg]) => ({ format, avg: Math.round(agg.views / Math.max(1, agg.count)), count: agg.count }))
    .filter((f) => f.count >= 2)
    .sort((a, b) => b.avg - a.avg)
    .slice(0, 3);

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-medium text-emerald-700/80 dark:text-emerald-400/80 uppercase tracking-widest">
          Performance
        </p>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-1">My posts</h1>
        <p className="text-muted-foreground mt-2 text-sm">
          {posts.length} post{posts.length === 1 ? "" : "s"} attributed to you. Tap any row for the full breakdown.
        </p>
      </div>

      {/* Top-line metric tiles — five primary engagement metrics + the
          overall engagement rate. Mirrors what TikTok's own analytics
          dashboard surfaces, so creators recognise the shape. */}
      {posts.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-3">
          <MetricTile label="Posts" value={posts.length.toLocaleString("en-US")} />
          <MetricTile label="Views" value={totalViews.toLocaleString("en-US")} />
          <MetricTile label="Likes" value={totalLikes.toLocaleString("en-US")} />
          <MetricTile label="Saves" value={totalSaves.toLocaleString("en-US")} />
          <MetricTile label="Comments" value={totalComments.toLocaleString("en-US")} />
          <MetricTile
            label="Engagement"
            value={`${overallEngagementRate.toFixed(1)}%`}
            hint={`${avgSaveRate.toFixed(1)}% avg save rate`}
          />
        </div>
      )}

      {posts.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            No posts attributed to you yet. Once your contact tags one, it&apos;ll show up here.
          </CardContent>
        </Card>
      ) : (
        <>
          {/* Best post + format leaderboard side by side on wider screens. */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {bestPost && (
              <div className="rounded-xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.06] to-transparent p-4 sm:p-5 space-y-2">
                <div className="flex items-center gap-2">
                  <Trophy className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <p className="text-[10px] uppercase tracking-widest text-emerald-700/80 dark:text-emerald-400/80 font-semibold">
                    Best post
                  </p>
                </div>
                <p className="text-2xl font-bold tabular-nums">
                  {(bestPost.views ?? 0).toLocaleString("en-US")} views
                </p>
                <p className="text-xs text-muted-foreground">
                  {bestPost.hook_style || "—"}
                  {bestPost.format && <> · {bestPost.format}</>}
                  {bestPost.date && <> · {bestPost.date}</>}
                </p>
                {bestPost.tiktok_url && bestPost.tiktok_url !== "-" && (
                  <a
                    href={bestPost.tiktok_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-xs font-medium text-emerald-600 hover:underline"
                  >
                    Watch on TikTok →
                  </a>
                )}
              </div>
            )}

            {formatLeaderboard.length > 0 && (
              <div className="rounded-xl border border-border bg-card p-4 sm:p-5 space-y-3">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-muted-foreground" />
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">
                    Formats that work for you
                  </p>
                </div>
                <div className="space-y-2">
                  {formatLeaderboard.map((f, i) => (
                    <div key={f.format} className="flex items-center justify-between gap-3">
                      <p className="text-sm">
                        <span className="text-muted-foreground tabular-nums w-5 inline-block">{i + 1}.</span>{" "}
                        {f.format}
                      </p>
                      <p className="text-sm tabular-nums">
                        <span className="font-semibold">{f.avg.toLocaleString("en-US")}</span>
                        <span className="text-muted-foreground text-xs"> avg views · {f.count} posts</span>
                      </p>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          <Card>
            <CardContent className="p-0 divide-y divide-border/60">
              {posts.map((p) => (
                <PostAnalyticsRow
                  key={p.id}
                  post={{
                    id: p.id,
                    date: p.date,
                    hook_style: p.hook_style,
                    format: p.format,
                    views: p.views,
                    likes: p.likes,
                    saves: p.saves,
                    shares: p.shares,
                    comments: p.comments,
                    save_rate: p.save_rate,
                    status: p.status,
                    tiktok_url: p.tiktok_url,
                    thumbnail_url: p.thumbnail_url,
                    campaign_name: (p.campaign as { name: string } | null)?.name ?? null,
                  }}
                  avgViews={avgViews}
                />
              ))}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function MetricTile({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-4 transition-colors hover:border-emerald-500/30">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-2xl font-semibold tabular-nums mt-1.5 leading-none">{value}</p>
      {hint && <p className="text-[10px] text-muted-foreground mt-2">{hint}</p>}
    </div>
  );
}
