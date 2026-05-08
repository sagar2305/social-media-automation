"use client";

/**
 * PostDetailDrawer — slide-in panel that shows everything we know about
 * a single post. Universal: any link/button anywhere in the dashboard
 * can open it by appending ?post=<id> to the current URL.
 *
 * Layout (Trackr-mirrored):
 *   ── Header: hook (title) · close button
 *   ── Top row: thumbnail (TikTok-shaped) | metric cards (7 metrics)
 *   ── Account block: platform badge · @handle · followers · following
 *   ── Caption (full text)
 *   ── Published timestamp
 *   ── View History sparkline (chart of views over time from
 *      post_metrics_history)
 *
 * Data is fetched browser-side because the drawer is opened from
 * client interactions; doing it via a server component would force
 * a full-page navigation just to flip the drawer open.
 */

import { useEffect, useMemo, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import {
  X, Eye, Heart, Bookmark, Share2, MessageCircle,
  TrendingUp, ExternalLink, Loader2, Music,
} from "lucide-react";
import {
  AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
} from "recharts";

interface DrawerProps {
  postId: string;
  onClose: () => void;
}

interface PostRow {
  id: string;
  hook_style: string | null;
  format: string | null;
  hashtags: string[] | null;
  views: number | null;
  likes: number | null;
  saves: number | null;
  shares: number | null;
  comments: number | null;
  save_rate: number | null;
  status: string | null;
  tiktok_url: string | null;
  account: string | null;
  flow: string | null;
  date: string | null;
  created_at: string | null;
  campaign_id: string | null;
}

interface AccountStatRow {
  followers: number;
  total_likes: number;
  videos: number;
  date: string;
}

interface HistoryPoint {
  captured_at: string;
  views: number;
  likes: number;
  saves: number;
  shares: number;
  comments: number;
}

interface CampaignRow {
  slug: string;
  name: string;
}

interface Loaded {
  post: PostRow;
  history: HistoryPoint[];
  account: AccountStatRow | null;
  campaign: CampaignRow | null;
}

function fmt(n: number | null | undefined): string {
  const v = n ?? 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

function fmtPct(numer: number, denom: number): string {
  if (!denom) return "0%";
  return `${((numer / denom) * 100).toFixed(2)}%`;
}

function fmtPublished(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
}

export function PostDetailDrawer({ postId, onClose }: DrawerProps) {
  const [data, setData] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Lock body scroll while drawer is open.
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = prev; };
  }, []);

  // Close on Escape key.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Fetch post + sparkline + account stats in parallel.
  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const sb = createBrowserSupabase();
      try {
        const { data: post, error: pErr } = await sb
          .from("posts")
          .select("*")
          .eq("id", postId)
          .maybeSingle();
        if (pErr) throw pErr;
        if (!post) throw new Error("Post not found");

        // Two more queries can run in parallel now that we have the post.
        const [historyRes, statsRes, campaignRes] = await Promise.all([
          sb.from("post_metrics_history")
            .select("captured_at, views, likes, saves, shares, comments")
            .eq("post_id", postId)
            .order("captured_at", { ascending: true })
            .limit(60),
          post.account
            ? sb.from("account_stats")
                .select("followers, total_likes, videos, date")
                .eq("account", post.account)
                .order("date", { ascending: false })
                .limit(1)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
          post.campaign_id
            ? sb.from("campaigns")
                .select("slug, name")
                .eq("id", post.campaign_id)
                .maybeSingle()
            : Promise.resolve({ data: null, error: null }),
        ]);

        if (cancelled) return;
        setData({
          post: post as PostRow,
          history: (historyRes.data ?? []) as HistoryPoint[],
          account: (statsRes.data ?? null) as AccountStatRow | null,
          campaign: (campaignRes.data ?? null) as CampaignRow | null,
        });
        setLoading(false);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load");
        setLoading(false);
      }
    }
    load();
    return () => { cancelled = true; };
  }, [postId]);

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm animate-in fade-in"
        onClick={onClose}
      />
      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-50 w-full sm:w-[640px] bg-background border-l border-border shadow-2xl flex flex-col animate-in slide-in-from-right duration-200">
        {/* Header */}
        <header className="flex items-start justify-between gap-4 px-6 py-4 border-b border-border">
          <div className="min-w-0">
            <h2 className="text-lg font-bold truncate">
              {loading ? "Loading…" : data?.post.hook_style ?? "Post"}
            </h2>
            {data && !loading && (
              <p className="text-xs text-muted-foreground mt-0.5">
                TikTok {data.post.flow ?? "post"}
                {data.account ? ` by @${data.post.account}` : ""}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground p-1 rounded-md hover:bg-muted shrink-0"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {loading && (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          )}

          {error && !loading && (
            <div className="rounded-md border border-destructive bg-destructive/5 px-4 py-3 text-sm text-destructive">
              {error}
            </div>
          )}

          {data && !loading && <DrawerBody data={data} />}
        </div>
      </div>
    </>
  );
}

function DrawerBody({ data }: { data: Loaded }) {
  const { post, history, account, campaign } = data;
  const eng = useMemo(() => {
    const v = post.views ?? 0;
    const total = (post.likes ?? 0) + (post.comments ?? 0) +
                  (post.shares ?? 0) + (post.saves ?? 0);
    return { engRate: fmtPct(total, v), commentRate: fmtPct(post.comments ?? 0, v) };
  }, [post]);

  const sparkData = useMemo(() => {
    return history.map((h) => ({
      t: new Date(h.captured_at).toLocaleDateString("en-US", {
        month: "short", day: "numeric",
      }),
      views: h.views,
    }));
  }, [history]);

  return (
    <>
      {/* Top: thumbnail + metrics */}
      <div className="grid grid-cols-[180px_1fr] gap-4">
        <Thumbnail post={post} />
        <MetricsCard post={post} eng={eng} />
      </div>

      {/* Account block */}
      <AccountBlock post={post} account={account} campaign={campaign} />

      {/* Caption */}
      {post.hashtags && post.hashtags.length > 0 && (
        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Hashtags
          </h3>
          <div className="flex flex-wrap gap-1.5">
            {post.hashtags.map((h) => (
              <span
                key={h}
                className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium"
              >
                {h.startsWith("#") ? h : `#${h}`}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Published */}
      <section className="space-y-1.5">
        <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Published
        </h3>
        <p className="text-sm tabular-nums">{fmtPublished(post.created_at ?? post.date)}</p>
      </section>

      {/* View history sparkline */}
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            View History
          </h3>
          {sparkData.length > 0 && (
            <span className="text-[10px] text-muted-foreground tabular-nums">
              {sparkData.length} snapshots
            </span>
          )}
        </div>
        {sparkData.length === 0 ? (
          <p className="text-sm text-muted-foreground border border-dashed border-border rounded-md px-3 py-6 text-center">
            No history snapshots yet. The next pull_analytics run will record one.
          </p>
        ) : (
          <div className="rounded-md border border-border bg-card p-3">
            <ResponsiveContainer width="100%" height={140}>
              <AreaChart data={sparkData}>
                <defs>
                  <linearGradient id="drawerSparkGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#16a34a" stopOpacity={0.18} />
                    <stop offset="100%" stopColor="#16a34a" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <XAxis
                  dataKey="t"
                  tick={{ fontSize: 10, fill: "#86868b" }}
                  stroke="transparent"
                  tickLine={false}
                  axisLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: "#86868b" }}
                  stroke="transparent"
                  tickLine={false}
                  axisLine={false}
                  width={36}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "#ffffff",
                    border: "1px solid #e8e8ed",
                    borderRadius: "8px",
                    fontSize: 12,
                    boxShadow: "0 4px 16px rgba(0,0,0,0.08)",
                  }}
                  labelStyle={{ color: "#86868b", fontSize: 11 }}
                />
                <Area
                  type="monotone"
                  dataKey="views"
                  stroke="#16a34a"
                  strokeWidth={2}
                  fill="url(#drawerSparkGrad)"
                  dot={false}
                  activeDot={{ r: 4, fill: "#16a34a", stroke: "#fff", strokeWidth: 2 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
      </section>

      {/* Footer link to TikTok */}
      {post.tiktok_url && post.tiktok_url !== "-" && (
        <div className="pt-2 border-t border-border/60">
          <a
            href={post.tiktok_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" />
            View on TikTok
          </a>
        </div>
      )}
    </>
  );
}

function Thumbnail({ post }: { post: PostRow }) {
  // We don't have a direct image URL for the post (TikTok thumbnails
  // require oembed which is rate-limited and CORS-restricted). Until the
  // pipeline starts archiving slide_1 to a public path we render a
  // gradient + hook label as the visual.
  return (
    <div className="relative aspect-[9/16] rounded-lg overflow-hidden border border-border bg-gradient-to-br from-amber-100 via-orange-100 to-rose-100">
      <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center">
        <Music className="h-6 w-6 text-orange-500/60 mb-2" />
        <p className="text-xs font-semibold text-orange-900/80 line-clamp-3">
          {post.hook_style ?? "post"}
        </p>
        <p className="text-[10px] text-muted-foreground mt-1">
          {post.format ?? ""}
        </p>
      </div>
    </div>
  );
}

function MetricsCard({
  post,
  eng,
}: {
  post: PostRow;
  eng: { engRate: string; commentRate: string };
}) {
  const items = [
    { label: "Views", value: fmt(post.views), Icon: Eye },
    { label: "Likes", value: fmt(post.likes), Icon: Heart },
    { label: "Saves", value: fmt(post.saves), Icon: Bookmark },
    { label: "Shares", value: fmt(post.shares), Icon: Share2 },
    { label: "Comments", value: fmt(post.comments), Icon: MessageCircle },
    { label: "Eng. Rate", value: eng.engRate, Icon: TrendingUp },
    { label: "Com. Rate", value: eng.commentRate, Icon: MessageCircle },
  ];

  return (
    <div className="rounded-lg border border-border bg-card p-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground mb-2">
        Metrics
      </p>
      <div className="grid grid-cols-2 gap-x-3 gap-y-3">
        {items.map(({ label, value, Icon }) => (
          <div key={label} className="flex items-start gap-2">
            <span className="h-7 w-7 rounded-md bg-muted flex items-center justify-center shrink-0">
              <Icon className="h-3.5 w-3.5 text-muted-foreground" />
            </span>
            <div className="min-w-0">
              <p className="text-base font-bold tabular-nums leading-tight">{value}</p>
              <p className="text-[10px] text-muted-foreground">{label}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function AccountBlock({
  post,
  account,
  campaign,
}: {
  post: PostRow;
  account: AccountStatRow | null;
  campaign: CampaignRow | null;
}) {
  if (!post.account) return null;
  return (
    <section className="space-y-2">
      <h3 className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
        Account
      </h3>
      <div className="rounded-lg border border-border bg-card px-4 py-3 flex items-center gap-3 flex-wrap">
        <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider">
          TikTok
        </span>
        {post.tiktok_url && post.tiktok_url !== "-" ? (
          <a
            href={post.tiktok_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm font-semibold hover:underline inline-flex items-center gap-1"
          >
            @{post.account}
            <ExternalLink className="h-3 w-3 text-muted-foreground" />
          </a>
        ) : (
          <span className="text-sm font-semibold">@{post.account}</span>
        )}
        {campaign && (
          <span className="inline-flex items-center rounded-md bg-blue-500/10 text-blue-600 px-2 py-0.5 text-[10px] font-medium">
            {campaign.name}
          </span>
        )}
        <div className="ml-auto flex items-center gap-3 text-xs text-muted-foreground">
          {account && (
            <>
              <span>
                <span className="font-semibold text-foreground tabular-nums">
                  {fmt(account.followers)}
                </span>{" "}
                followers
              </span>
              <span>
                <span className="font-semibold text-foreground tabular-nums">
                  {fmt(account.videos)}
                </span>{" "}
                videos
              </span>
            </>
          )}
        </div>
      </div>
    </section>
  );
}
