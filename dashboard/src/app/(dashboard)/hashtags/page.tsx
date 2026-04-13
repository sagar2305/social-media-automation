import { Suspense } from "react";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { HashtagChart } from "@/components/hashtag-chart";
import { HashtagsTable } from "@/components/hashtags-table";
import { DateRangeFilter } from "@/components/date-range-filter";
import { getDateFilter } from "@/lib/utils";
import type { HashtagSummary } from "@/lib/types";

export const revalidate = 300;

async function getHashtagSummaries(dateFrom: string | null) {
  const supabase = await createClient();
  let query = supabase
    .from("posts")
    .select("*")
    .eq("status", "published")
    .order("date", { ascending: false });

  if (dateFrom) {
    query = query.gte("date", dateFrom);
  }

  const { data: posts } = await query;
  const allPosts = posts ?? [];

  // Aggregate per hashtag (normalize to lowercase for grouping)
  const map = new Map<
    string,
    { display: string; views: number; likes: number; saves: number; saveRates: number[]; count: number }
  >();

  for (const p of allPosts) {
    const tags = p.hashtags;
    if (!tags || !Array.isArray(tags)) continue;

    for (const raw of tags) {
      const tag = raw.trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      const existing = map.get(key) || {
        display: tag,
        views: 0,
        likes: 0,
        saves: 0,
        saveRates: [] as number[],
        count: 0,
      };
      existing.views += p.views || 0;
      existing.likes += p.likes || 0;
      existing.saves += p.saves || 0;
      if (p.save_rate) existing.saveRates.push(Number(p.save_rate));
      existing.count++;
      map.set(key, existing);
    }
  }

  const summaries: HashtagSummary[] = Array.from(map.values()).map((h) => ({
    hashtag: h.display,
    views: h.views,
    likes: h.likes,
    saves: h.saves,
    avg_save_rate:
      h.saveRates.length > 0
        ? h.saveRates.reduce((a, b) => a + b, 0) / h.saveRates.length
        : 0,
    posts: h.count,
  }));

  return summaries;
}

export default async function HashtagsPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await props.searchParams;
  const range = typeof searchParams.range === "string" ? searchParams.range : undefined;
  const dateFrom = getDateFilter(range);
  const hashtags = await getHashtagSummaries(dateFrom);

  // Top 15 for chart
  const chartData = [...hashtags]
    .sort((a, b) => b.views - a.views)
    .slice(0, 15)
    .map((h) => ({ hashtag: h.hashtag, views: h.views }));

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-5xl font-semibold tracking-tight">Hashtags</h1>
          <p className="text-lg text-muted-foreground mt-2">
            Performance by hashtag across {hashtags.length} tags.
          </p>
        </div>
        <Suspense>
          <DateRangeFilter />
        </Suspense>
      </div>

      {chartData.length > 0 && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-sm font-medium text-muted-foreground mb-4">
              Top hashtags by views
            </p>
            <HashtagChart data={chartData} />
          </CardContent>
        </Card>
      )}

      <HashtagsTable hashtags={hashtags} />
    </div>
  );
}
