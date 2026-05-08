/**
 * /campaigns — list view of every campaign in the system.
 *
 * Card grid showing each campaign's name, image, status, accounts count,
 * posts progress, days remaining, and a mini KPIs preview. The card
 * lives at /campaigns/[id] (Phase 6+ builds the detail page).
 *
 * "+ New Campaign" button routes to /campaigns/new (Phase 4.3).
 *
 * Aggregates are computed in-page from Supabase joins to keep the
 * cards self-contained — no per-card N+1.
 */

import Link from "next/link";
import Image from "next/image";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, Image as ImageIcon, Eye, Heart, Bookmark } from "lucide-react";
import type { Campaign, CampaignSummary } from "@/lib/types";

export const revalidate = 60;

async function getCampaignsWithStats(): Promise<CampaignSummary[]> {
  const sb = await createClient();

  // 1. All campaigns
  const { data: campaigns } = await sb
    .from("campaigns")
    .select("*")
    .order("created_at", { ascending: true })
    .returns<Campaign[]>();
  if (!campaigns?.length) return [];

  // 2. Aggregate posts per campaign (single query — group on client to avoid
  //    a per-campaign round-trip).
  const { data: posts } = await sb
    .from("posts")
    .select("campaign_id, views, likes, saves, save_rate, status")
    .not("campaign_id", "is", null);

  const postStats = new Map<string, {
    count: number;
    views: number;
    likes: number;
    saves: number;
    saveRates: number[];
  }>();
  for (const p of posts ?? []) {
    if (!p.campaign_id) continue;
    const acc = postStats.get(p.campaign_id) ?? {
      count: 0, views: 0, likes: 0, saves: 0, saveRates: [],
    };
    acc.count++;
    acc.views += p.views ?? 0;
    acc.likes += p.likes ?? 0;
    acc.saves += p.saves ?? 0;
    if (p.save_rate != null) acc.saveRates.push(Number(p.save_rate));
    postStats.set(p.campaign_id, acc);
  }

  // 3. Accounts per campaign (count of active rows)
  const { data: accounts } = await sb
    .from("accounts")
    .select("campaign_id, active")
    .eq("active", true)
    .not("campaign_id", "is", null);

  const accountCount = new Map<string, number>();
  for (const a of accounts ?? []) {
    if (!a.campaign_id) continue;
    accountCount.set(a.campaign_id, (accountCount.get(a.campaign_id) ?? 0) + 1);
  }

  // 4. Synthesise the summary per campaign.
  const today = new Date();
  return campaigns.map((c) => {
    const stats = postStats.get(c.id);
    const accounts = accountCount.get(c.id) ?? 0;

    const daysLeft = c.end_date
      ? Math.max(0, Math.ceil((new Date(c.end_date).getTime() - today.getTime()) / 86_400_000))
      : null;

    // Total target = accounts × posts_per_week × weeks (start→end).
    // Falls back to 0 if dates aren't set.
    let postsTargetTotal = 0;
    if (c.start_date && c.end_date) {
      const weeks = Math.max(
        1,
        Math.round((new Date(c.end_date).getTime() - new Date(c.start_date).getTime()) / (7 * 86_400_000)),
      );
      postsTargetTotal = accounts * c.target_posts_per_week * weeks;
    }

    return {
      ...c,
      account_count: accounts,
      posts_count: stats?.count ?? 0,
      total_views: stats?.views ?? 0,
      total_likes: stats?.likes ?? 0,
      total_saves: stats?.saves ?? 0,
      avg_save_rate:
        stats && stats.saveRates.length > 0
          ? stats.saveRates.reduce((s, n) => s + n, 0) / stats.saveRates.length
          : 0,
      days_left: daysLeft,
      posts_target_total: postsTargetTotal,
    };
  });
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

function StatusPill({ status }: { status: Campaign["status"] }) {
  const styles: Record<Campaign["status"], string> = {
    active: "bg-[#16a34a]/10 text-[#16a34a]",
    paused: "bg-[#bf4800]/10 text-[#bf4800]",
    archived: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}

export default async function CampaignsPage() {
  const campaigns = await getCampaignsWithStats();
  const activeCount = campaigns.filter((c) => c.status === "active").length;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Campaigns</h1>
          <p className="text-muted-foreground mt-1">
            {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"} ·{" "}
            {activeCount} active
          </p>
        </div>
        <Link
          href="/campaigns/new"
          className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
        >
          <Plus className="h-4 w-4" />
          New Campaign
        </Link>
      </div>

      {/* Empty state */}
      {campaigns.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <p className="text-base font-medium mb-1">No campaigns yet</p>
            <p className="text-sm text-muted-foreground mb-6">
              Create your first campaign to start posting for an app.
            </p>
            <Link
              href="/campaigns/new"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              New Campaign
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Card grid */}
      {campaigns.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {campaigns.map((c) => {
            const progress = c.posts_target_total > 0
              ? Math.min(100, (c.posts_count / c.posts_target_total) * 100)
              : null;

            return (
              <Link key={c.id} href={`/campaigns/${c.slug}`} className="group block">
                <Card className="overflow-hidden hover:ring-2 hover:ring-primary/30 transition-all">
                  {/* Hero image */}
                  <div className="relative h-32 bg-gradient-to-br from-muted to-muted/50 flex items-center justify-center">
                    {c.image_url ? (
                      <Image
                        src={c.image_url}
                        alt={c.name}
                        fill
                        className="object-cover"
                        sizes="(max-width: 768px) 100vw, 33vw"
                      />
                    ) : (
                      <ImageIcon className="h-10 w-10 text-muted-foreground/40" />
                    )}
                  </div>

                  <CardContent className="p-4 space-y-3">
                    {/* Name + status */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <h3 className="text-base font-semibold truncate group-hover:text-primary transition-colors">
                          {c.name}
                        </h3>
                        <p className="text-xs text-muted-foreground font-mono">
                          {c.slug}
                        </p>
                      </div>
                      <StatusPill status={c.status} />
                    </div>

                    {/* Posts progress */}
                    {progress !== null ? (
                      <div className="space-y-1">
                        <div className="flex items-center justify-between text-xs">
                          <span className="text-muted-foreground">
                            {c.posts_count}/{c.posts_target_total} posts
                          </span>
                          <span className="font-medium tabular-nums">
                            {progress.toFixed(0)}%
                          </span>
                        </div>
                        <div className="h-1.5 w-full rounded-full bg-muted overflow-hidden">
                          <div
                            className="h-full bg-primary transition-all"
                            style={{ width: `${progress}%` }}
                          />
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        {c.posts_count} posts
                      </p>
                    )}

                    {/* Mini KPIs */}
                    <div className="flex items-center gap-4 text-xs pt-2 border-t border-border/60">
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Eye className="h-3 w-3" />
                        <span className="tabular-nums font-medium text-foreground">
                          {formatNumber(c.total_views)}
                        </span>
                      </span>
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Heart className="h-3 w-3" />
                        <span className="tabular-nums font-medium text-foreground">
                          {formatNumber(c.total_likes)}
                        </span>
                      </span>
                      <span className="flex items-center gap-1 text-muted-foreground">
                        <Bookmark className="h-3 w-3" />
                        <span className="tabular-nums font-medium text-foreground">
                          {c.avg_save_rate.toFixed(2)}%
                        </span>
                      </span>
                    </div>

                    {/* Footer: accounts + days left */}
                    <div className="flex items-center justify-between text-xs text-muted-foreground pt-2 border-t border-border/60">
                      <span>
                        {c.account_count} account{c.account_count === 1 ? "" : "s"}
                      </span>
                      {c.days_left !== null && (
                        <span className="font-medium">
                          {c.days_left === 0
                            ? "Ends today"
                            : c.days_left === 1
                              ? "1 day left"
                              : `${c.days_left} days left`}
                        </span>
                      )}
                      {c.days_left === null && c.start_date === null && (
                        <span className="italic">No end date</span>
                      )}
                    </div>
                  </CardContent>
                </Card>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
