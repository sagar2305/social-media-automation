/**
 * KPI row for the campaign Overview tab.
 *
 * 8 metrics with week-over-week trend arrows: Videos · Views · Likes ·
 * Comments · Shares · Saves · Engagement Rate · Comment Rate.
 *
 * Trend math: compare the current 7 days vs the 7 days before that.
 *   delta% = (current − prior) / prior × 100  (or "new" if prior was 0)
 * Up = green, down = red, flat = grey.
 *
 * Engagement rate is the standard formula:
 *   (likes + comments + shares + saves) / views × 100
 * computed across the *whole* date window so it stays stable instead
 * of jittering with low-volume days.
 */

import { Card, CardContent } from "@/components/ui/card";
import {
  Eye, Heart, MessageCircle, Share2, Bookmark, Video,
  TrendingUp, TrendingDown, Minus,
} from "lucide-react";

export interface PostMetricRow {
  date: string | null;
  views: number;
  likes: number;
  saves: number;
  shares: number;
  comments: number;
  status: string | null;
}

function dayMs(): number { return 86_400_000; }

function bucket7Days(posts: PostMetricRow[], now: Date): { current: PostMetricRow[]; prior: PostMetricRow[] } {
  const cutoffCurrent = now.getTime() - 7 * dayMs();
  const cutoffPrior = now.getTime() - 14 * dayMs();
  const current: PostMetricRow[] = [];
  const prior: PostMetricRow[] = [];
  for (const p of posts) {
    if (!p.date) continue;
    const t = new Date(p.date).getTime();
    if (t >= cutoffCurrent) current.push(p);
    else if (t >= cutoffPrior) prior.push(p);
  }
  return { current, prior };
}

function sum(rows: PostMetricRow[], key: keyof PostMetricRow): number {
  let n = 0;
  for (const r of rows) {
    const v = r[key];
    if (typeof v === "number") n += v;
  }
  return n;
}

function trendArrow(current: number, prior: number): { direction: "up" | "down" | "flat"; pct: number | null } {
  if (prior === 0) return { direction: current > 0 ? "up" : "flat", pct: current > 0 ? null : 0 };
  if (current === prior) return { direction: "flat", pct: 0 };
  const pct = ((current - prior) / prior) * 100;
  return { direction: pct > 0 ? "up" : "down", pct };
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

interface KpiCardProps {
  label: string;
  value: string;
  icon: React.ComponentType<{ className?: string }>;
  trend: ReturnType<typeof trendArrow>;
  iconColor: string;
}

function KpiCard({ label, value, icon: Icon, trend, iconColor }: KpiCardProps) {
  const TrendIcon = trend.direction === "up"
    ? TrendingUp
    : trend.direction === "down"
      ? TrendingDown
      : Minus;
  const trendColor = trend.direction === "up"
    ? "text-[#16a34a]"
    : trend.direction === "down"
      ? "text-[#bf4800]"
      : "text-muted-foreground";

  return (
    <Card className="shadow-sm border-0 ring-0">
      <CardContent className="py-4 px-4">
        <div className="flex items-start justify-between gap-2">
          <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${iconColor}`}>
            <Icon className="h-4 w-4" />
          </div>
          <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums ${trendColor}`}>
            <TrendIcon className="h-3 w-3" />
            {trend.pct === null
              ? "new"
              : trend.direction === "flat"
                ? "—"
                : `${trend.direction === "up" ? "+" : ""}${trend.pct.toFixed(0)}%`}
          </span>
        </div>
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mt-3">
          {label}
        </p>
        <p className="text-2xl font-bold tracking-tight tabular-nums">{value}</p>
      </CardContent>
    </Card>
  );
}

export function KpiRow({ posts }: { posts: PostMetricRow[] }) {
  const published = posts.filter((p) => p.status === "published");
  const now = new Date();
  const { current, prior } = bucket7Days(published, now);

  const totals = {
    videos: published.length,
    views: sum(published, "views"),
    likes: sum(published, "likes"),
    saves: sum(published, "saves"),
    shares: sum(published, "shares"),
    comments: sum(published, "comments"),
  };

  // Engagement rate across the whole window
  const engRate = totals.views > 0
    ? ((totals.likes + totals.comments + totals.shares + totals.saves) / totals.views) * 100
    : 0;
  const commentRate = totals.views > 0
    ? (totals.comments / totals.views) * 100
    : 0;

  // Trends — current 7d vs prior 7d
  const tCurrent = {
    videos: current.length,
    views: sum(current, "views"),
    likes: sum(current, "likes"),
    saves: sum(current, "saves"),
    shares: sum(current, "shares"),
    comments: sum(current, "comments"),
  };
  const tPrior = {
    videos: prior.length,
    views: sum(prior, "views"),
    likes: sum(prior, "likes"),
    saves: sum(prior, "saves"),
    shares: sum(prior, "shares"),
    comments: sum(prior, "comments"),
  };

  const cards: KpiCardProps[] = [
    {
      label: "Videos",
      value: String(totals.videos),
      icon: Video,
      trend: trendArrow(tCurrent.videos, tPrior.videos),
      iconColor: "bg-blue-100 text-blue-700",
    },
    {
      label: "Views",
      value: formatNumber(totals.views),
      icon: Eye,
      trend: trendArrow(tCurrent.views, tPrior.views),
      iconColor: "bg-emerald-100 text-emerald-700",
    },
    {
      label: "Likes",
      value: formatNumber(totals.likes),
      icon: Heart,
      trend: trendArrow(tCurrent.likes, tPrior.likes),
      iconColor: "bg-rose-100 text-rose-700",
    },
    {
      label: "Comments",
      value: formatNumber(totals.comments),
      icon: MessageCircle,
      trend: trendArrow(tCurrent.comments, tPrior.comments),
      iconColor: "bg-violet-100 text-violet-700",
    },
    {
      label: "Shares",
      value: formatNumber(totals.shares),
      icon: Share2,
      trend: trendArrow(tCurrent.shares, tPrior.shares),
      iconColor: "bg-cyan-100 text-cyan-700",
    },
    {
      label: "Saves",
      value: formatNumber(totals.saves),
      icon: Bookmark,
      trend: trendArrow(tCurrent.saves, tPrior.saves),
      iconColor: "bg-amber-100 text-amber-700",
    },
    {
      label: "Engagement Rate",
      value: `${engRate.toFixed(2)}%`,
      icon: TrendingUp,
      // Eng rate trend = change in window engagement totals vs window views
      trend: (() => {
        const curEng = tCurrent.likes + tCurrent.comments + tCurrent.shares + tCurrent.saves;
        const priorEng = tPrior.likes + tPrior.comments + tPrior.shares + tPrior.saves;
        const cur = tCurrent.views > 0 ? (curEng / tCurrent.views) * 100 : 0;
        const prv = tPrior.views > 0 ? (priorEng / tPrior.views) * 100 : 0;
        return trendArrow(cur, prv);
      })(),
      iconColor: "bg-purple-100 text-purple-700",
    },
    {
      label: "Comment Rate",
      value: `${commentRate.toFixed(2)}%`,
      icon: MessageCircle,
      trend: (() => {
        const cur = tCurrent.views > 0 ? (tCurrent.comments / tCurrent.views) * 100 : 0;
        const prv = tPrior.views > 0 ? (tPrior.comments / tPrior.views) * 100 : 0;
        return trendArrow(cur, prv);
      })(),
      iconColor: "bg-pink-100 text-pink-700",
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
      {cards.map((c) => (
        <KpiCard key={c.label} {...c} />
      ))}
    </div>
  );
}
