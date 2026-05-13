/**
 * Three presentations of a single share link, picked by share_links.link_type:
 *
 *   - DashboardView : KPIs + Daily Views chart  (the original behavior)
 *   - GalleryView   : visual grid of every published post (Trackr's
 *                     'Gallery' link — for stakeholder / investor sharing)
 *   - OverviewView  : campaign briefing — description, hero image, branded
 *                     hashtags, top performers (for sharing strategy w/
 *                     creators or clients)
 *
 * All three are server components; the page-level dispatcher loads the
 * shared data once and passes it in.
 */

import Link from "next/link";
import Image from "next/image";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ViewsChart } from "@/components/views-chart";
import {
  Eye, Heart, Bookmark, ExternalLink, ImageOff,
} from "lucide-react";
import type { Campaign } from "@/lib/types";

export interface SharedPost {
  id: string;
  date: string | null;
  hook_style: string | null;
  account: string | null;
  views: number | null;
  likes: number | null;
  saves: number | null;
  save_rate: number | null;
  tiktok_url: string | null;
  status: string | null;
}

export interface SharedAccountStat {
  account: string;
  followers: number;
}

export interface ShareViewProps {
  title: string;
  campaign: Campaign | null;
  posts: SharedPost[];
  accountStats: SharedAccountStat[];
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

// ─── Dashboard ──────────────────────────────────────────────────────

export function DashboardView({ title, campaign, posts, accountStats }: ShareViewProps) {
  const totalViews = posts.reduce((s, p) => s + (p.views ?? 0), 0);
  const totalLikes = posts.reduce((s, p) => s + (p.likes ?? 0), 0);
  const totalSaves = posts.reduce((s, p) => s + (p.saves ?? 0), 0);
  const avgSaveRate = posts.length > 0
    ? (posts.reduce((s, p) => s + (Number(p.save_rate) || 0), 0) / posts.length).toFixed(2)
    : "0";
  const totalFollowers = accountStats.reduce((s, a) => s + (a.followers ?? 0), 0);

  const viewsByDate = new Map<string, number>();
  for (const p of posts) {
    if (p.date) {
      viewsByDate.set(p.date, (viewsByDate.get(p.date) ?? 0) + (p.views ?? 0));
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
      <PublicHeader title={title} campaign={campaign} type="Dashboard" />

      <div className="grid grid-cols-2 md:grid-cols-6 gap-4">
        {kpis.map((kpi) => (
          <Card key={kpi.label}>
            <CardContent className="pt-5 pb-4">
              <p className="text-xs text-muted-foreground font-medium">{kpi.label}</p>
              <p className="text-2xl font-semibold tracking-tight mt-1">{kpi.value}</p>
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

// ─── Gallery ────────────────────────────────────────────────────────

export function GalleryView({ title, campaign, posts }: ShareViewProps) {
  const published = posts
    .filter((p) => p.status === "published" && p.tiktok_url && p.tiktok_url !== "-")
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0));

  return (
    <div className="max-w-7xl mx-auto px-6 py-10 space-y-8">
      <PublicHeader title={title} campaign={campaign} type="Gallery" />

      <div className="flex items-center gap-3 text-xs text-muted-foreground">
        <span>{published.length} published post{published.length === 1 ? "" : "s"}</span>
        <span className="text-border">·</span>
        <span>Sorted by views</span>
      </div>

      {published.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <p className="text-base font-medium mb-1">No published posts yet</p>
            <p className="text-sm text-muted-foreground">
              Posts will appear here as they go live.
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {published.map((p) => (
            <a
              key={p.id}
              href={p.tiktok_url!}
              target="_blank"
              rel="noopener noreferrer"
              className="group relative aspect-[9/16] block overflow-hidden rounded-lg border border-border bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 hover:ring-2 hover:ring-primary/40 transition-all"
            >
              <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center">
                <ImageOff className="h-6 w-6 text-orange-300/80 mb-2" />
                <p className="text-xs font-semibold text-orange-900/80 line-clamp-3">
                  {p.hook_style ?? "post"}
                </p>
              </div>
              <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
                <p className="text-sm font-bold text-white tabular-nums">
                  {fmt(p.views ?? 0)} views
                </p>
                <p className="text-[10px] text-white/80 mt-0.5">
                  @{p.account ?? "?"}
                </p>
              </div>
              <span className="absolute top-1.5 right-1.5 rounded-full bg-black/50 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <ExternalLink className="h-3 w-3 text-white" />
              </span>
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Overview ───────────────────────────────────────────────────────

export function OverviewView({ title, campaign, posts }: ShareViewProps) {
  const top5 = posts
    .filter((p) => p.status === "published")
    .sort((a, b) => (b.views ?? 0) - (a.views ?? 0))
    .slice(0, 5);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-10">
      <PublicHeader title={title} campaign={campaign} type="Overview" />

      {/* Hero with image */}
      {campaign && (
        <Card className="overflow-hidden">
          {campaign.image_url && (
            <div className="relative h-48 bg-muted">
              <Image
                src={campaign.image_url}
                alt={campaign.name}
                fill
                className="object-cover"
                sizes="(max-width: 1024px) 100vw, 1024px"
              />
            </div>
          )}
          <CardContent className="pt-6 space-y-4">
            <div>
              <h2 className="text-2xl font-bold">{campaign.name}</h2>
              <p className="text-sm text-muted-foreground font-mono mt-0.5">
                {campaign.slug}
              </p>
            </div>
            {campaign.description && (
              <p className="text-base leading-relaxed">{campaign.description}</p>
            )}

            {(campaign.branded_hashtags?.length ?? 0) > 0 && (
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
                  Branded hashtags
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {(campaign.branded_hashtags ?? []).map((h) => (
                    <Badge key={h} variant="secondary">{h}</Badge>
                  ))}
                </div>
              </div>
            )}

            {campaign.tone_of_voice && (
              <div className="grid grid-cols-2 gap-3 pt-2 border-t border-border/60">
                <Stat label="Tone" value={campaign.tone_of_voice} />
                <Stat label="Posts/week" value={String(campaign.target_posts_per_week)} />
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Top performers */}
      {top5.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-semibold">Top performers</h3>
          <div className="space-y-2">
            {top5.map((p, i) => (
              <Card key={p.id}>
                <CardContent className="py-3 px-4 flex items-center gap-4">
                  <span className="flex h-8 w-8 items-center justify-center rounded-full bg-accent text-sm font-bold text-primary shrink-0">
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="font-medium truncate">{p.hook_style ?? "post"}</p>
                      <Badge variant="secondary" className="text-[10px]">
                        @{p.account ?? "?"}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground tabular-nums">
                      {(p.views ?? 0).toLocaleString()} views · {p.saves ?? 0} saves · {p.date ?? ""}
                    </p>
                  </div>
                  {p.tiktok_url && p.tiktok_url !== "-" && (
                    <a
                      href={p.tiktok_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-muted-foreground hover:text-primary"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Shared chrome ──────────────────────────────────────────────────

function PublicHeader({
  title,
  campaign,
  type,
}: {
  title: string;
  campaign: Campaign | null;
  type: "Dashboard" | "Gallery" | "Overview";
}) {
  return (
    <div className="flex items-center justify-between">
      <div className="min-w-0">
        <div className="flex items-center gap-3 mb-2">
          <Link href="/" className="text-lg font-semibold tracking-tight">
            {campaign?.name ?? "MinuteWise"}
          </Link>
          <Badge variant="secondary">{type}</Badge>
        </div>
        <h1 className="text-3xl md:text-4xl font-semibold tracking-tight">
          {title}
        </h1>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground font-medium">{label}</p>
      <p className="text-base font-semibold mt-0.5">{value}</p>
    </div>
  );
}

// Re-export the icon used inline in GalleryView so other files can use the
// same fallback gracefully (kept for future thumbnail upgrades).
export { Eye, Heart, Bookmark };
