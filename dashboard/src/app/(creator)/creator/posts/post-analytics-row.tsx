"use client";

/**
 * Expandable per-post analytics row for the creator portal.
 *
 * Collapsed: thumbnail (if present), hook + format + campaign + date,
 * three primary numbers (views, save rate, engagement), chevron.
 *
 * Expanded: full 5-metric grid (views, likes, saves, comments, shares)
 * plus computed engagement rate and a comparison-to-your-avg badge so
 * the creator instantly knows whether this post is over- or under-
 * performing their baseline.
 */

import { useState } from "react";
import { ChevronDown, TrendingUp, TrendingDown } from "lucide-react";

export interface PostAnalytics {
  id: string;
  date: string | null;
  hook_style: string | null;
  format: string | null;
  views: number | null;
  likes: number | null;
  saves: number | null;
  shares: number | null;
  comments: number | null;
  save_rate: number | string | null;
  status: string | null;
  tiktok_url: string | null;
  thumbnail_url: string | null;
  campaign_name: string | null;
}

interface Props {
  post: PostAnalytics;
  /** Average views across all the creator's posts — drives the
   *  comparison badge in the expanded panel. Pass 0 to skip. */
  avgViews: number;
}

function pluralDays(n: number) {
  if (n === 0) return "today";
  if (n === 1) return "1 day ago";
  return `${n} days ago`;
}

function engagementRate(p: PostAnalytics): number {
  const v = p.views ?? 0;
  if (v === 0) return 0;
  const eng = (p.likes ?? 0) + (p.saves ?? 0) + (p.comments ?? 0) + (p.shares ?? 0);
  return (eng / v) * 100;
}

export function PostAnalyticsRow({ post, avgViews }: Props) {
  const [open, setOpen] = useState(false);
  const views = post.views ?? 0;
  const er = engagementRate(post);

  // % above/below the creator's own average. Skip when avg is 0 or
  // when this is the only post (avgViews === views).
  const showCompare = avgViews > 0 && views !== avgViews;
  const compareDelta = showCompare ? ((views - avgViews) / avgViews) * 100 : 0;
  const above = compareDelta > 0;

  // "Posted N days ago" — fail gracefully on missing date.
  const daysAgo = post.date
    ? Math.max(0, Math.floor((Date.now() - new Date(post.date).getTime()) / 86_400_000))
    : null;

  return (
    <div className="px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-3 text-left"
      >
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {/* Thumbnail — gracefully degrades when null. The slot stays
              the same width so rows align even on the rare null case. */}
          <div className="h-12 w-12 shrink-0 rounded-md bg-muted overflow-hidden flex items-center justify-center">
            {post.thumbnail_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={post.thumbnail_url} alt="" className="h-full w-full object-cover" />
            ) : (
              <span className="text-[10px] text-muted-foreground/60 uppercase tracking-wider">
                {post.format?.split("-")[0] ?? "post"}
              </span>
            )}
          </div>

          <div className="min-w-0">
            <p className="text-sm font-medium truncate">{post.hook_style || "—"}</p>
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {post.campaign_name ?? "Campaign"}
              {post.format && <> · {post.format}</>}
              {post.date && <> · {post.date}</>}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-5 shrink-0 text-sm tabular-nums">
          <Compact label="views" value={views.toLocaleString("en-US")} />
          <Compact label="save rate" value={`${Number(post.save_rate ?? 0)}%`} />
          <Compact label="engagement" value={`${er.toFixed(1)}%`} />
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {open && (
        <div className="mt-4 pt-4 border-t border-border/40 space-y-4">
          {/* Five-metric grid — full breakdown of engagement */}
          <div className="grid grid-cols-5 gap-2">
            <Stat label="Views" value={views} />
            <Stat label="Likes" value={post.likes ?? 0} />
            <Stat label="Saves" value={post.saves ?? 0} />
            <Stat label="Comments" value={post.comments ?? 0} />
            <Stat label="Shares" value={post.shares ?? 0} />
          </div>

          <div className="flex items-center justify-between gap-4 pt-3 border-t border-border/40 text-xs">
            <div className="space-y-0.5">
              <p className="text-muted-foreground">
                Engagement rate: <span className="font-semibold text-foreground tabular-nums">{er.toFixed(1)}%</span>{" "}
                (likes + saves + comments + shares ÷ views)
              </p>
              {daysAgo !== null && (
                <p className="text-muted-foreground">Posted {pluralDays(daysAgo)}</p>
              )}
            </div>
            {post.tiktok_url && post.tiktok_url !== "-" && (
              <a
                href={post.tiktok_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs font-medium text-emerald-600 hover:underline shrink-0"
              >
                Watch on TikTok →
              </a>
            )}
          </div>

          {/* Comparison badge — colour-coded so it's readable at a glance.
              Shows the creator how this post stacks against THEIR baseline,
              which is more useful than abstract benchmarks. */}
          {showCompare && (
            <div
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-xs ${
                above
                  ? "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                  : "bg-amber-500/10 text-amber-700 dark:text-amber-400"
              }`}
            >
              {above ? (
                <TrendingUp className="h-4 w-4 shrink-0" />
              ) : (
                <TrendingDown className="h-4 w-4 shrink-0" />
              )}
              <span>
                <span className="font-semibold tabular-nums">
                  {above ? "+" : ""}
                  {compareDelta.toFixed(0)}%
                </span>{" "}
                vs your average ({Math.round(avgViews).toLocaleString("en-US")} avg views)
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Compact({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <p className="font-semibold">{value}</p>
      <p className="text-[10px] text-muted-foreground uppercase tracking-wider">{label}</p>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <p className="text-lg sm:text-xl font-bold tabular-nums">{value.toLocaleString("en-US")}</p>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mt-0.5">
        {label}
      </p>
    </div>
  );
}
