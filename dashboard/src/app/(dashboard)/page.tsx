import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { ViewsChart } from "@/components/views-chart";
import { DateRangeFilter } from "@/components/date-range-filter";
import { ExportButton } from "@/components/export-button";
import { getDateFilter } from "@/lib/utils";
import {
  Eye,
  Heart,
  Clock,
  TrendingUp,
  ExternalLink,
  AlertTriangle,
} from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

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

  const [postsRes, accountsRes, formatsRes, experimentsRes] = await Promise.all(
    [
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
      supabase
        .from("experiments")
        .select("*")
        .order("date", { ascending: false })
        .limit(20),
    ]
  );

  return {
    posts: postsRes.data ?? [],
    accountStats: accountsRes.data ?? [],
    formatRankings: formatsRes.data ?? [],
    experiments: experimentsRes.data ?? [],
  };
}

export default async function OverviewPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await props.searchParams;
  const range =
    typeof searchParams.range === "string" ? searchParams.range : undefined;
  const dateFrom = getDateFilter(range);

  const { posts, accountStats, formatRankings, experiments } =
    await getOverviewData(dateFrom);

  const publishedPosts = posts.filter((p) => p.status === "published");

  // Aggregate KPIs
  const totalViews = publishedPosts.reduce((s, p) => s + (p.views || 0), 0);
  const totalLikes = publishedPosts.reduce((s, p) => s + (p.likes || 0), 0);
  const totalSaves = publishedPosts.reduce((s, p) => s + (p.saves || 0), 0);
  const avgSaveRate =
    publishedPosts.length > 0
      ? (
          publishedPosts.reduce(
            (s, p) => s + (Number(p.save_rate) || 0),
            0
          ) / publishedPosts.length
        ).toFixed(1)
      : "0";

  const latestStats = new Map<string, (typeof accountStats)[0]>();
  for (const stat of accountStats) {
    if (!latestStats.has(stat.account)) latestStats.set(stat.account, stat);
  }

  const kpis = [
    {
      label: "Estimated Views",
      value:
        totalViews >= 1000
          ? `${(totalViews / 1000).toFixed(1)}K`
          : String(totalViews),
      icon: Eye,
      color: "bg-emerald-100 text-emerald-700",
    },
    {
      label: "Total Likes",
      value:
        totalLikes >= 1000
          ? `${(totalLikes / 1000).toFixed(1)}K`
          : String(totalLikes),
      icon: Heart,
      color: "bg-rose-100 text-rose-700",
    },
    {
      label: "Total Saves",
      value:
        totalSaves >= 1000
          ? `${(totalSaves / 1000).toFixed(1)}K`
          : String(totalSaves),
      icon: Clock,
      color: "bg-amber-100 text-amber-700",
    },
    {
      label: "Avg Save Rate",
      value: `${avgSaveRate}%`,
      icon: TrendingUp,
      color: "bg-purple-100 text-purple-700",
    },
  ];

  // Chart data
  const viewsByDate = new Map<string, number>();
  for (const p of publishedPosts) {
    if (p.date) {
      viewsByDate.set(
        p.date,
        (viewsByDate.get(p.date) || 0) + (p.views || 0)
      );
    }
  }
  const chartData = Array.from(viewsByDate.entries())
    .map(([date, views]) => ({ date, views }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // Top posts (published with views)
  const topPosts = [...publishedPosts]
    .sort((a, b) => (b.views || 0) - (a.views || 0))
    .slice(0, 5);

  // Failed / not posted
  const failedPosts = posts.filter(
    (p) =>
      p.status === "failed" ||
      p.status === "in-progress" ||
      p.status === "error" ||
      (p.status === "published" && !p.tiktok_url && (p.views || 0) === 0)
  );

  // Account leaderboard
  const accountViews = new Map<
    string,
    { views: number; saves: number; posts: number }
  >();
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
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Overview</h1>
          <p className="text-muted-foreground mt-1">
            Platform performance snapshot.
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

      {/* KPI Cards — Compact */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {kpis.map((kpi) => {
          const Icon = kpi.icon;
          return (
            <Card key={kpi.label} className="shadow-sm border-0 ring-0">
              <CardContent className="py-4 px-4">
                <div className="flex items-center gap-3">
                  <div
                    className={`h-9 w-9 rounded-lg flex items-center justify-center ${kpi.color}`}
                  >
                    <Icon className="h-4 w-4" strokeWidth={2} />
                  </div>
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
                      {kpi.label}
                    </p>
                    <p className="text-xl font-bold tracking-tight">
                      {kpi.value}
                    </p>
                  </div>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Failed / Not Posted Alert */}
      {failedPosts.length > 0 && (
        <Card className="shadow-sm border-0 ring-0 border-l-4 border-l-amber-500">
          <CardContent className="py-4">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              <p className="text-sm font-semibold">
                {failedPosts.length} Post{failedPosts.length > 1 ? "s" : ""} Not
                Posted
              </p>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Post ID</TableHead>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Account</TableHead>
                    <TableHead className="text-xs">Hook</TableHead>
                    <TableHead className="text-xs">Format</TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                    <TableHead className="text-xs">Reason</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {failedPosts.slice(0, 8).map((p) => {
                    let reason = "Unknown";
                    if (p.status === "failed" || p.status === "error")
                      reason = "Post failed to publish";
                    else if (p.status === "in-progress")
                      reason = "Stuck in draft — never published";
                    else if (!p.tiktok_url)
                      reason = "Published but no TikTok URL captured";

                    return (
                      <TableRow key={p.id}>
                        <TableCell className="text-xs font-mono">
                          {p.id.slice(0, 12)}...
                        </TableCell>
                        <TableCell className="text-xs">{p.date}</TableCell>
                        <TableCell className="text-xs">
                          @{p.account || "unknown"}
                        </TableCell>
                        <TableCell className="text-xs">
                          {p.hook_style}
                        </TableCell>
                        <TableCell className="text-xs">{p.format}</TableCell>
                        <TableCell>
                          <span
                            className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                              p.status === "failed" || p.status === "error"
                                ? "bg-red-500/10 text-red-500"
                                : "bg-amber-500/10 text-amber-600"
                            }`}
                          >
                            {p.status}
                          </span>
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {reason}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
            {failedPosts.length > 8 && (
              <Link
                href="/posts"
                className="block text-xs font-medium text-primary hover:underline text-center pt-2"
              >
                View all {failedPosts.length} unposted items
              </Link>
            )}
          </CardContent>
        </Card>
      )}

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

        {/* Top Performing Content — with View Post + Account */}
        <Card className="lg:col-span-2 shadow-sm border-0 ring-0">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-base font-semibold">Top Performing Content</p>
              <Link
                href="/posts"
                className="text-xs font-medium text-primary hover:underline"
              >
                View all
              </Link>
            </div>
            <div className="space-y-3">
              {topPosts.map((post, i) => (
                <div
                  key={post.id}
                  className="flex items-center gap-3 py-1.5"
                >
                  <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-xs font-bold text-primary shrink-0">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-medium truncate">
                        {post.hook_style}
                      </p>
                      <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-500 shrink-0">
                        @{post.account}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {(post.views || 0).toLocaleString()} views ·{" "}
                      {post.saves || 0} saves · {post.date}
                    </p>
                  </div>
                  {post.tiktok_url && (
                    <a
                      href={post.tiktok_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-muted-foreground hover:text-primary transition-colors"
                      title="View on TikTok"
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  )}
                </div>
              ))}
              {topPosts.length === 0 && (
                <p className="text-sm text-muted-foreground">
                  No published posts yet.
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Experiments — Table Format */}
      {experiments.length > 0 && (
        <Card className="shadow-sm border-0 ring-0">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-4">
              <p className="text-base font-semibold">Recent Experiments</p>
              <Link
                href="/experiments"
                className="text-sm font-medium text-primary hover:underline"
              >
                View all
              </Link>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">ID</TableHead>
                    <TableHead className="text-xs">Date</TableHead>
                    <TableHead className="text-xs">Account</TableHead>
                    <TableHead className="text-xs">Variable</TableHead>
                    <TableHead className="text-xs">Variant A</TableHead>
                    <TableHead className="text-xs">Variant B</TableHead>
                    <TableHead className="text-xs text-right">
                      Views A
                    </TableHead>
                    <TableHead className="text-xs text-right">
                      Views B
                    </TableHead>
                    <TableHead className="text-xs text-right">
                      Save% A
                    </TableHead>
                    <TableHead className="text-xs text-right">
                      Save% B
                    </TableHead>
                    <TableHead className="text-xs">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {experiments.slice(0, 10).map((exp) => {
                    const isWinner = exp.status
                      ?.toLowerCase()
                      .includes("winner");
                    const isInconclusive = exp.status
                      ?.toLowerCase()
                      .includes("inconclusive");
                    const isCrossAccount = exp.account?.includes(",");

                    return (
                      <TableRow key={exp.id}>
                        <TableCell className="text-xs font-mono font-medium">
                          {exp.id}
                        </TableCell>
                        <TableCell className="text-xs">{exp.date}</TableCell>
                        <TableCell className="text-xs">
                          <div className="flex flex-wrap gap-1">
                            {exp.account
                              ?.split(",")
                              .map((a: string) => (
                                <span
                                  key={a.trim()}
                                  className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-blue-500/10 text-blue-500"
                                >
                                  @{a.trim()}
                                </span>
                              ))}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {exp.variable}
                        </TableCell>
                        <TableCell className="text-xs max-w-[120px] truncate">
                          {exp.variant_a}
                        </TableCell>
                        <TableCell className="text-xs max-w-[120px] truncate">
                          {exp.variant_b}
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {exp.views_a?.toLocaleString() || 0}
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {exp.views_b?.toLocaleString() || 0}
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {exp.save_rate_a || 0}%
                        </TableCell>
                        <TableCell className="text-xs text-right tabular-nums">
                          {exp.save_rate_b || 0}%
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {isCrossAccount && (
                              <span className="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium bg-red-500/10 text-red-500">
                                Cross
                              </span>
                            )}
                            <span
                              className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                                isWinner
                                  ? "bg-[#248a3d]/10 text-[#248a3d]"
                                  : isInconclusive
                                    ? "bg-[#bf4800]/10 text-[#bf4800]"
                                    : "bg-[#16a34a]/10 text-[#16a34a]"
                              }`}
                            >
                              {isWinner
                                ? `Winner ${exp.winner || ""}`
                                : isInconclusive
                                  ? "Inconclusive"
                                  : "Active"}
                            </span>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      )}

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
                    <span className="text-sm font-medium">@{a.account}</span>
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
                    <span className="text-sm font-medium">{f.hook_style}</span>
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
