import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ViewsChart } from "@/components/views-chart";
import { DateRangeFilter } from "@/components/date-range-filter";
import { ExportButton } from "@/components/export-button";
import { getDateFilter } from "@/lib/utils";
import { Eye, Heart, Clock, TrendingUp } from "lucide-react";

export const revalidate = 300;

async function getOverviewData(dateFrom: string | null) {
  const supabase = await createClient();
  let postsQuery = supabase
    .from("posts")
    .select("*")
    .order("date", { ascending: false })
    .limit(500);

  if (dateFrom) {
    postsQuery = postsQuery.gte("date", dateFrom);
  }

  const [postsRes, accountsRes, formatsRes] = await Promise.all([
    postsQuery,
    supabase
      .from("account_stats")
      .select("*")
      .order("date", { ascending: false })
      .limit(50),
    supabase
      .from("format_rankings")
      .select("*")
      .order("rank", { ascending: true }),
  ]);

  return {
    posts: postsRes.data ?? [],
    accountStats: accountsRes.data ?? [],
    formatRankings: formatsRes.data ?? [],
  };
}

export default async function OverviewPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await props.searchParams;
  const range = typeof searchParams.range === "string" ? searchParams.range : undefined;
  const dateFrom = getDateFilter(range);

  const { posts, accountStats, formatRankings } = await getOverviewData(dateFrom);

  const publishedPosts = posts.filter((p) => p.status === "published");

  // Aggregate KPIs
  const totalViews = publishedPosts.reduce((s, p) => s + (p.views || 0), 0);
  const totalLikes = publishedPosts.reduce((s, p) => s + (p.likes || 0), 0);
  const totalSaves = publishedPosts.reduce((s, p) => s + (p.saves || 0), 0);
  const avgSaveRate =
    publishedPosts.length > 0
      ? (
          publishedPosts.reduce((s, p) => s + (Number(p.save_rate) || 0), 0) /
          publishedPosts.length
        ).toFixed(1)
      : "0";

  const latestStats = new Map<string, (typeof accountStats)[0]>();
  for (const stat of accountStats) {
    if (!latestStats.has(stat.account)) latestStats.set(stat.account, stat);
  }
  const totalFollowers = Array.from(latestStats.values()).reduce(
    (s, st) => s + (st.followers || 0),
    0
  );

  const kpis = [
    {
      label: "Estimated Views",
      value: totalViews >= 1000 ? `${(totalViews / 1000).toFixed(1)}K` : String(totalViews),
      change: "+12.5%",
      icon: Eye,
      color: "bg-emerald-100 text-emerald-700",
    },
    {
      label: "Total Likes",
      value: totalLikes >= 1000 ? `${(totalLikes / 1000).toFixed(1)}K` : String(totalLikes),
      change: "+8.2%",
      icon: Heart,
      color: "bg-emerald-100 text-emerald-700",
    },
    {
      label: "Total Saves",
      value: totalSaves >= 1000 ? `${(totalSaves / 1000).toFixed(1)}K` : String(totalSaves),
      change: "+1.4%",
      icon: Clock,
      color: "bg-emerald-100 text-emerald-700",
    },
    {
      label: "Avg Save Rate",
      value: `${avgSaveRate}%`,
      change: "+24.0%",
      icon: TrendingUp,
      color: "bg-purple-100 text-purple-700",
    },
  ];

  // Chart data
  const viewsByDate = new Map<string, number>();
  for (const p of publishedPosts) {
    if (p.date) {
      viewsByDate.set(p.date, (viewsByDate.get(p.date) || 0) + (p.views || 0));
    }
  }
  const chartData = Array.from(viewsByDate.entries())
    .map(([date, views]) => ({ date, views }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Top posts
  const topPosts = [...publishedPosts]
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, 4);

  // Account leaderboard
  const accountViews = new Map<string, { views: number; saves: number; posts: number }>();
  for (const p of publishedPosts) {
    const acc = p.account || "unknown";
    const existing = accountViews.get(acc) || { views: 0, saves: 0, posts: 0 };
    existing.views += p.views || 0;
    existing.saves += p.saves || 0;
    existing.posts++;
    accountViews.set(acc, existing);
  }
  const leaderboard = Array.from(accountViews.entries())
    .map(([account, data]) => ({ account, ...data }))
    .sort((a, b) => b.views - a.views);

  return (
    <div className="space-y-8">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
          <p className="text-muted-foreground mt-1">
            Monitoring platform performance for the last 30 days.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Suspense>
            <DateRangeFilter />
          </Suspense>
          <ExportButton
            data={publishedPosts.map((p) => ({
              date: p.date,
              account: p.account,
              views: p.views,
              likes: p.likes,
              saves: p.saves,
              save_rate: p.save_rate,
            }))}
            filename="overview-report"
          />
        </div>
      </div>

      {/* KPI Cards — Stitch style */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-5">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className="shadow-sm border-0 ring-0">
              <CardContent className="pt-6 pb-5">
                <div className="flex items-start justify-between mb-4">
                  <div className={`h-12 w-12 rounded-xl flex items-center justify-center ${kpi.color}`}>
                    <Icon className="h-6 w-6" strokeWidth={1.5} />
                  </div>
                  <span className="text-xs font-semibold text-emerald-600 flex items-center gap-0.5">
                    <TrendingUp className="h-3 w-3" />
                    {kpi.change}
                  </span>
                </div>
                <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
                  {kpi.label}
                </p>
                <p className="text-3xl font-bold tracking-tight mt-1">
                  {kpi.value}
                </p>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Two-column: Chart + Top Content */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
        {/* Audience Growth Chart */}
        {chartData.length > 1 && (
          <Card className="lg:col-span-3 shadow-sm border-0 ring-0">
            <CardContent className="pt-6">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="text-base font-semibold">Audience Growth</p>
                  <p className="text-sm text-muted-foreground">
                    Views over time
                  </p>
                </div>
                <div className="flex items-center gap-4 text-xs">
                  <span className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-primary" />
                    Views
                  </span>
                </div>
              </div>
              <ViewsChart data={chartData} />
            </CardContent>
          </Card>
        )}

        {/* Top Performing Content */}
        <Card className="lg:col-span-2 shadow-sm border-0 ring-0">
          <CardContent className="pt-6">
            <p className="text-base font-semibold mb-4">Top Performing Content</p>
            <div className="space-y-4">
              {topPosts.map((post) => (
                <div key={post.id} className="flex items-center gap-3">
                  <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center text-xs font-bold text-muted-foreground shrink-0">
                    {post.hook_style?.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {post.hook_style} — @{post.account}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {(post.views || 0).toLocaleString()} views · {post.date}
                    </p>
                  </div>
                </div>
              ))}
              {topPosts.length > 0 && (
                <Link
                  href="/posts"
                  className="block text-sm font-medium text-primary hover:underline text-center pt-2"
                >
                  View All Content
                </Link>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Account Leaderboard */}
      {leaderboard.length > 0 && (
        <Card className="shadow-sm border-0 ring-0">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-5">
              <p className="text-base font-semibold">Account Leaderboard</p>
              <Link
                href="/accounts"
                className="text-sm font-medium text-primary hover:underline"
              >
                View all accounts
              </Link>
            </div>
            <div className="divide-y divide-border/60">
              {leaderboard.map((a, i) => (
                <Link
                  key={a.account}
                  href={`/accounts/${a.account}`}
                  className="flex items-center justify-between py-3 hover:bg-muted/40 -mx-4 px-4 rounded-lg transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-bold text-primary">
                      {i + 1}
                    </span>
                    <span className="text-sm font-medium">
                      @{a.account}
                    </span>
                  </div>
                  <div className="flex items-center gap-6 tabular-nums text-sm">
                    <span>
                      <span className="font-semibold">
                        {a.views.toLocaleString()}
                      </span>{" "}
                      <span className="text-muted-foreground">views</span>
                    </span>
                    <span>
                      <span className="font-semibold">
                        {a.saves.toLocaleString()}
                      </span>{" "}
                      <span className="text-muted-foreground">saves</span>
                    </span>
                    <span className="text-muted-foreground">
                      {a.posts} posts
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {posts.length === 0 && (
        <p className="text-muted-foreground text-center py-12">
          No posts yet.
        </p>
      )}

      {/* Format Rankings */}
      {formatRankings.length > 0 && (
        <Card className="shadow-sm border-0 ring-0">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-5">
              <p className="text-base font-semibold">Format Rankings</p>
              <Link
                href="/formats"
                className="text-sm font-medium text-primary hover:underline"
              >
                View details
              </Link>
            </div>
            <div className="divide-y divide-border/60">
              {formatRankings.map((f) => (
                <Link
                  key={f.id}
                  href="/formats"
                  className="flex items-center justify-between py-3 hover:bg-muted/40 -mx-4 px-4 rounded-lg transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-bold text-primary">
                      {f.rank}
                    </span>
                    <span className="text-sm font-medium">
                      {f.hook_style}
                    </span>
                  </div>
                  <div className="flex items-center gap-6 tabular-nums text-sm">
                    <span>
                      <span className="font-semibold">
                        {Number(f.avg_views).toFixed(0)}
                      </span>{" "}
                      <span className="text-muted-foreground">avg views</span>
                    </span>
                    <span>
                      <span className="font-semibold">{f.avg_save_rate}%</span>{" "}
                      <span className="text-muted-foreground">save rate</span>
                    </span>
                    <span className="text-muted-foreground">
                      {f.post_count} posts
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
