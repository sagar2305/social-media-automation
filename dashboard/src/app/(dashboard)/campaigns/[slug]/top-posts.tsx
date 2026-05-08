"use client";

/**
 * Top Posts widget — top 12 by views, scoped to the campaign.
 * Cards/Table toggle (Trackr-style).
 *
 * Click a card body or table row → opens the universal post detail
 * drawer (see PostTrigger / PostDrawerMount). External-link icons
 * still open TikTok in a new tab.
 *
 * Cards show a gradient placeholder with hook label + view count
 * overlay. Proper TikTok thumbnails ride on a future archival pass
 * — this widget renders the same card style regardless.
 */

import { useState } from "react";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { LayoutGrid, Table2, ExternalLink, ImageOff } from "lucide-react";
import { PostTrigger } from "@/components/post-trigger";

export interface TopPost {
  id: string;
  hook_style: string | null;
  account: string | null;
  views: number;
  likes: number;
  saves: number;
  shares: number;
  save_rate: number | null;
  tiktok_url: string | null;
  status: string | null;
  date: string | null;
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function TopPosts({ posts }: { posts: TopPost[] }) {
  const [view, setView] = useState<"cards" | "table">("cards");

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-base font-semibold">Top Posts</p>
        <div className="inline-flex items-center rounded-lg bg-muted p-0.5">
          <button
            type="button"
            onClick={() => setView("cards")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              view === "cards"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Cards
          </button>
          <button
            type="button"
            onClick={() => setView("table")}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
              view === "table"
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            <Table2 className="h-3.5 w-3.5" />
            Table
          </button>
        </div>
      </div>

      {posts.length === 0 && (
        <p className="text-sm text-muted-foreground py-12 text-center border border-dashed rounded-lg">
          No published posts yet.
        </p>
      )}

      {posts.length > 0 && view === "cards" && (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} />
          ))}
        </div>
      )}

      {posts.length > 0 && view === "table" && (
        <div className="rounded-lg border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Hook</TableHead>
                <TableHead>Account</TableHead>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">Views</TableHead>
                <TableHead className="text-right">Likes</TableHead>
                <TableHead className="text-right">Saves</TableHead>
                <TableHead className="text-right">Save %</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {posts.map((p) => (
                <TableRow
                  key={p.id}
                  className="cursor-pointer hover:bg-muted/40"
                >
                  <TableCell>
                    <PostTrigger
                      postId={p.id}
                      className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium hover:bg-secondary/80"
                    >
                      {p.hook_style ?? "—"}
                    </PostTrigger>
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {p.account ? `@${p.account}` : "—"}
                  </TableCell>
                  <TableCell className="text-xs tabular-nums">{p.date ?? "—"}</TableCell>
                  <TableCell className="text-right tabular-nums font-semibold">
                    {p.views.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.likes.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.saves.toLocaleString()}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {p.save_rate ? `${p.save_rate}%` : "—"}
                  </TableCell>
                  <TableCell>
                    {p.tiktok_url && p.tiktok_url !== "-" && (
                      <a
                        href={p.tiktok_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="text-muted-foreground hover:text-primary"
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}

function PostCard({ post }: { post: TopPost }) {
  const hasUrl = post.tiktok_url && post.tiktok_url !== "-";

  return (
    <div className="group relative aspect-[9/16] overflow-hidden rounded-lg border border-border bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 hover:ring-2 hover:ring-primary/40 transition-all">
      {/* Card body — opens the universal post drawer when clicked */}
      <PostTrigger postId={post.id} className="absolute inset-0 w-full h-full">
        <span className="sr-only">Open post details</span>
        {/* Hook label centered */}
        <span className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center">
          <ImageOff className="h-6 w-6 text-orange-300/80 mb-2" />
          <span className="text-xs font-semibold text-orange-900/80 line-clamp-3">
            {post.hook_style ?? "post"}
          </span>
        </span>

        {/* Stats overlay */}
        <span className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent block text-left">
          <span className="block text-sm font-bold text-white tabular-nums">
            {formatNumber(post.views)} views
          </span>
          <span className="flex items-center justify-between text-[10px] text-white/80 mt-0.5">
            <span>@{post.account ?? "?"}</span>
            {post.save_rate != null && post.save_rate > 0 && (
              <span className="tabular-nums">{Number(post.save_rate).toFixed(2)}% save</span>
            )}
          </span>
        </span>
      </PostTrigger>

      {/* TikTok external-link badge — sits above the trigger so a click on
          the icon goes to TikTok instead of opening the drawer. */}
      {hasUrl && (
        <a
          href={post.tiktok_url!}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="absolute top-1.5 right-1.5 rounded-full bg-black/50 p-1 opacity-0 group-hover:opacity-100 transition-opacity hover:bg-black/70 z-10"
          aria-label="Open on TikTok"
        >
          <ExternalLink className="h-3 w-3 text-white" />
        </a>
      )}
    </div>
  );
}
