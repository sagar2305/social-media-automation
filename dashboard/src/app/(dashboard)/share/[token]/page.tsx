import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { ViewsChart } from "@/components/views-chart";
import { Badge } from "@/components/ui/badge";

export const revalidate = 300;

export default async function SharedDashboardPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const supabase = await createClient();

  // Look up the share link
  const { data: link } = await supabase
    .from("share_links")
    .select("*")
    .eq("token", token)
    .single();

  if (!link) notFound();

  // Check expiry
  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="text-muted-foreground text-lg">
          This shared dashboard link has expired.
        </p>
      </div>
    );
  }

  const accountFilter = link.accounts?.length > 0 ? link.accounts : null;

  // Fetch posts
  let postsQuery = supabase
    .from("posts")
    .select("*")
    .eq("status", "published")
    .order("date", { ascending: false })
    .limit(200);

  if (accountFilter) {
    postsQuery = postsQuery.in("account", accountFilter);
  }

  const [postsRes, statsRes] = await Promise.all([
    postsQuery,
    supabase
      .from("account_stats")
      .select("*")
      .order("date", { ascending: false })
      .limit(50),
  ]);

  const posts = postsRes.data ?? [];
  const stats = statsRes.data ?? [];

  // Filter stats by accounts if needed
  const filteredStats = accountFilter
    ? stats.filter((s) => accountFilter.includes(s.account))
    : stats;

  // Aggregate
  const totalViews = posts.reduce((s, p) => s + (p.views || 0), 0);
  const totalLikes = posts.reduce((s, p) => s + (p.likes || 0), 0);
  const totalSaves = posts.reduce((s, p) => s + (p.saves || 0), 0);
  const avgSaveRate =
    posts.length > 0
      ? (
          posts.reduce((s, p) => s + (Number(p.save_rate) || 0), 0) /
          posts.length
        ).toFixed(2)
      : "0";

  const latestStats = new Map<string, (typeof filteredStats)[0]>();
  for (const s of filteredStats) {
    if (!latestStats.has(s.account)) latestStats.set(s.account, s);
  }
  const totalFollowers = Array.from(latestStats.values()).reduce(
    (s, st) => s + (st.followers || 0),
    0
  );

  // Chart
  const viewsByDate = new Map<string, number>();
  for (const p of posts) {
    if (p.date) {
      viewsByDate.set(p.date, (viewsByDate.get(p.date) || 0) + (p.views || 0));
    }
  }
  const chartData = Array.from(viewsByDate.entries())
    .map(([date, views]) => ({ date, views }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const kpis = [
    { label: "Total Views", value: totalViews.toLocaleString() },
    { label: "Total Likes", value: totalLikes.toLocaleString() },
    { label: "Total Saves", value: totalSaves.toLocaleString() },
    { label: "Avg Save %", value: `${avgSaveRate}%` },
    { label: "Posts", value: String(posts.length) },
    { label: "Followers", value: totalFollowers.toLocaleString() },
  ];

  return (
    <div className="max-w-6xl mx-auto px-6 py-10 space-y-10">
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-3 mb-2">
            <span className="text-lg font-semibold tracking-tight">
              MinuteWise
            </span>
            <Badge variant="secondary">Shared</Badge>
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">
            {link.title}
          </h1>
          {accountFilter && (
            <p className="text-muted-foreground mt-1">
              {accountFilter.map((a: string) => `@${a}`).join(", ")}
            </p>
          )}
        </div>
      </div>

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
    </div>
  );
}
