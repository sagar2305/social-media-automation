/**
 * /campaigns/[slug]/hashtags — hashtag performance scoped to one campaign.
 *
 * Hashtags live as a text[] column on posts (not a separate table), so
 * "campaign-scoped" means: aggregate every published post that has
 * campaign_id = this campaign's id, and group by hashtag. Identical
 * math to the global /hashtags page; just the post query is filtered.
 */

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { HashtagChart } from "@/components/hashtag-chart";
import { HashtagsTable } from "@/components/hashtags-table";
import type { Campaign, HashtagSummary } from "@/lib/types";

export const revalidate = 120;

interface PostHashtagRow {
  hashtags: string[] | null;
  views: number | null;
  likes: number | null;
  saves: number | null;
  save_rate: number | null;
}

export default async function CampaignHashtagsPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sb = await createClient();
  const { data: campaign } = await sb
    .from("campaigns")
    .select("id, slug, name")
    .eq("slug", slug)
    .maybeSingle<Pick<Campaign, "id" | "slug" | "name">>();
  if (!campaign) notFound();

  const { data: postsData } = await sb
    .from("posts")
    .select("hashtags, views, likes, saves, save_rate")
    .eq("campaign_id", campaign.id)
    .eq("status", "published");

  const allPosts = (postsData ?? []) as PostHashtagRow[];

  // Aggregate per hashtag (case-insensitive grouping)
  const map = new Map<string, {
    display: string;
    views: number;
    likes: number;
    saves: number;
    saveRates: number[];
    count: number;
  }>();

  for (const p of allPosts) {
    if (!p.hashtags || !Array.isArray(p.hashtags)) continue;
    for (const raw of p.hashtags) {
      const tag = (raw ?? "").trim();
      if (!tag) continue;
      const key = tag.toLowerCase();
      const existing = map.get(key) ?? {
        display: tag,
        views: 0,
        likes: 0,
        saves: 0,
        saveRates: [],
        count: 0,
      };
      existing.views += p.views ?? 0;
      existing.likes += p.likes ?? 0;
      existing.saves += p.saves ?? 0;
      if (p.save_rate != null) existing.saveRates.push(Number(p.save_rate));
      existing.count++;
      map.set(key, existing);
    }
  }

  const hashtags: HashtagSummary[] = Array.from(map.values())
    .map((h) => ({
      hashtag: h.display,
      views: h.views,
      likes: h.likes,
      saves: h.saves,
      avg_save_rate:
        h.saveRates.length > 0
          ? h.saveRates.reduce((a, b) => a + b, 0) / h.saveRates.length
          : 0,
      posts: h.count,
    }))
    .sort((a, b) => b.views - a.views);

  const top10 = hashtags.slice(0, 10);

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          {hashtags.length} unique hashtag{hashtags.length === 1 ? "" : "s"} ·{" "}
          {allPosts.length} published post{allPosts.length === 1 ? "" : "s"}
        </p>
      </div>

      {hashtags.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-12 text-center">
            <p className="text-base font-medium mb-1">No hashtag data yet</p>
            <p className="text-sm text-muted-foreground">
              Hashtag rankings show up here once published posts have
              accumulated for this campaign.
            </p>
          </CardContent>
        </Card>
      )}

      {hashtags.length > 0 && (
        <>
          <Card>
            <CardContent className="pt-6">
              <p className="text-sm font-medium text-muted-foreground mb-3">
                Top 10 hashtags by views
              </p>
              <HashtagChart data={top10} />
            </CardContent>
          </Card>

          <HashtagsTable hashtags={hashtags} />
        </>
      )}
    </div>
  );
}
