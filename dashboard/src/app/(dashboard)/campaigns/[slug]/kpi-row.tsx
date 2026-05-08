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
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

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

interface KpiCellProps {
  label: string;
  value: string;
  trend: ReturnType<typeof trendArrow>;
}

/**
 * One cell in the grouped KPI panel. Trackr-style: just the label, the
 * value, and a tiny trend chip. No coloured icon — multiple coloured
 * tiles in a single panel feel noisy.
 */
function KpiCell({ label, value, trend }: KpiCellProps) {
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
    <div className="px-5 py-4">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <span className={`inline-flex items-center gap-0.5 text-[10px] font-medium tabular-nums ${trendColor}`}>
          <TrendIcon className="h-3 w-3" />
          {trend.pct === null
            ? "new"
            : trend.direction === "flat"
              ? "—"
              : `${trend.direction === "up" ? "+" : ""}${trend.pct.toFixed(0)}%`}
        </span>
      </div>
      <p className="text-2xl font-semibold tracking-tight tabular-nums">{value}</p>
    </div>
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

  const cells: KpiCellProps[] = [
    { label: "Videos",   value: String(totals.videos), trend: trendArrow(tCurrent.videos, tPrior.videos) },
    { label: "Views",    value: formatNumber(totals.views), trend: trendArrow(tCurrent.views, tPrior.views) },
    { label: "Likes",    value: formatNumber(totals.likes), trend: trendArrow(tCurrent.likes, tPrior.likes) },
    { label: "Comments", value: formatNumber(totals.comments), trend: trendArrow(tCurrent.comments, tPrior.comments) },
    { label: "Shares",   value: formatNumber(totals.shares), trend: trendArrow(tCurrent.shares, tPrior.shares) },
    { label: "Saves",    value: formatNumber(totals.saves), trend: trendArrow(tCurrent.saves, tPrior.saves) },
    {
      label: "Engagement rate",
      value: `${engRate.toFixed(2)}%`,
      trend: (() => {
        const curEng = tCurrent.likes + tCurrent.comments + tCurrent.shares + tCurrent.saves;
        const priorEng = tPrior.likes + tPrior.comments + tPrior.shares + tPrior.saves;
        const cur = tCurrent.views > 0 ? (curEng / tCurrent.views) * 100 : 0;
        const prv = tPrior.views > 0 ? (priorEng / tPrior.views) * 100 : 0;
        return trendArrow(cur, prv);
      })(),
    },
    {
      label: "Comment rate",
      value: `${commentRate.toFixed(2)}%`,
      trend: (() => {
        const cur = tCurrent.views > 0 ? (tCurrent.comments / tCurrent.views) * 100 : 0;
        const prv = tPrior.views > 0 ? (tPrior.comments / tPrior.views) * 100 : 0;
        return trendArrow(cur, prv);
      })(),
    },
  ];

  // One container, two rows of four. The grid has its own thin internal
  // dividers (border-r/border-b) on each cell instead of every cell being
  // a separate floating card — gives the panel a single, sorted feel
  // matching Trackr's reference.
  return (
    <Card className="shadow-sm border-0 ring-0 overflow-hidden">
      <CardContent className="p-0">
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-x divide-y divide-border/60">
          {cells.map((c) => (
            <KpiCell key={c.label} {...c} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
