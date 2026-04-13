import { Suspense } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import { ViewsChart } from "@/components/views-chart";
import { DateRangeFilter } from "@/components/date-range-filter";
import { getDateFilter } from "@/lib/utils";

export const revalidate = 300;

async function getAccountData(account: string, dateFrom: string | null) {
  const supabase = await createClient();
  let postsQuery = supabase
    .from("posts")
    .select("*")
    .eq("account", account)
    .order("date", { ascending: false });

  if (dateFrom) {
    postsQuery = postsQuery.gte("date", dateFrom);
  }

  const [postsRes, statsRes] = await Promise.all([
    postsQuery,
    supabase
      .from("account_stats")
      .select("*")
      .eq("account", account)
      .order("date", { ascending: false })
      .limit(1),
  ]);

  return {
    posts: postsRes.data ?? [],
    latestStat: (statsRes.data ?? [])[0] || null,
  };
}

function StatusPill({ status }: { status: string }) {
  const variant =
    status === "published"
      ? "default"
      : status === "scheduled"
        ? "outline"
        : "secondary";
  const color =
    status === "published"
      ? "bg-[#248a3d]/10 text-[#248a3d]"
      : status === "scheduled"
        ? "bg-[#bf4800]/10 text-[#bf4800]"
        : "";
  return (
    <Badge variant={variant} className={color}>
      {status}
    </Badge>
  );
}

export default async function AccountDetailPage(props: {
  params: Promise<{ account: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const { account } = await props.params;
  const searchParams = await props.searchParams;
  const range = typeof searchParams.range === "string" ? searchParams.range : undefined;
  const dateFrom = getDateFilter(range);

  const { posts, latestStat } = await getAccountData(
    decodeURIComponent(account),
    dateFrom
  );

  const publishedPosts = posts.filter((p) => p.status === "published");
  const totalViews = publishedPosts.reduce((s, p) => s + (p.views || 0), 0);
  const totalLikes = publishedPosts.reduce((s, p) => s + (p.likes || 0), 0);
  const totalSaves = publishedPosts.reduce((s, p) => s + (p.saves || 0), 0);
  const avgSaveRate =
    publishedPosts.length > 0
      ? (
          publishedPosts.reduce((s, p) => s + (Number(p.save_rate) || 0), 0) /
          publishedPosts.length
        ).toFixed(2)
      : "0";

  // Views over time
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

  const kpis = [
    { label: "Views", value: totalViews.toLocaleString() },
    { label: "Likes", value: totalLikes.toLocaleString() },
    { label: "Saves", value: totalSaves.toLocaleString() },
    { label: "Avg Save %", value: `${avgSaveRate}%` },
    { label: "Posts", value: String(posts.length) },
    { label: "Followers", value: (latestStat?.followers || 0).toLocaleString() },
  ];

  return (
    <div className="space-y-10">
      <div className="flex items-center justify-between">
        <div>
          <Link
            href="/accounts"
            className="text-sm font-medium text-[#16a34a] hover:text-[#16a34a]/80 transition-colors"
          >
            ← All accounts
          </Link>
          <h1 className="text-5xl font-semibold tracking-tight mt-2">
            @{decodeURIComponent(account)}
          </h1>
        </div>
        <Suspense>
          <DateRangeFilter />
        </Suspense>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground font-medium">
                {kpi.label}
              </p>
              <p className="text-2xl font-semibold tracking-tight mt-1">
                {kpi.value}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Chart */}
      {chartData.length > 1 && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-muted-foreground mb-4">
              Views over time
            </p>
            <ViewsChart data={chartData} />
          </CardContent>
        </Card>
      )}

      {/* Posts Table */}
      <div>
        <h2 className="text-xl font-semibold mb-4">
          All posts ({posts.length})
        </h2>
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Hook</TableHead>
                  <TableHead>Format</TableHead>
                  <TableHead>Flow</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                  <TableHead className="text-right">Likes</TableHead>
                  <TableHead className="text-right">Saves</TableHead>
                  <TableHead className="text-right">Save %</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Link</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {posts.map((post) => (
                  <TableRow key={post.id}>
                    <TableCell className="tabular-nums">
                      {post.date}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{post.hook_style}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {post.format}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {post.flow || "—"}
                    </TableCell>
                    <TableCell className={`tabular-nums text-right ${post.views ? "font-semibold" : ""}`}>
                      {post.views || "—"}
                    </TableCell>
                    <TableCell className={`tabular-nums text-right ${post.likes ? "font-semibold" : ""}`}>
                      {post.likes || "—"}
                    </TableCell>
                    <TableCell className={`tabular-nums text-right ${post.saves ? "font-semibold" : ""}`}>
                      {post.saves || "—"}
                    </TableCell>
                    <TableCell className="tabular-nums text-right">
                      {post.save_rate ? `${post.save_rate}%` : "—"}
                    </TableCell>
                    <TableCell>
                      <StatusPill status={post.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {post.tiktok_url && post.tiktok_url !== "-" ? (
                        <a
                          href={post.tiktok_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-sm font-medium text-[#16a34a] hover:underline"
                        >
                          View
                        </a>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
                {posts.length === 0 && (
                  <TableRow>
                    <TableCell
                      colSpan={10}
                      className="text-center text-muted-foreground py-8"
                    >
                      No posts found for this account.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
