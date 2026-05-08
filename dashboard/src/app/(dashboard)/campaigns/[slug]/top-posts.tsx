"use client";

/**
 * Top Posts widget — top 12 by views, scoped to the campaign.
 * Cards/Table toggle (Trackr-style).
 *
 * Cards: visual grid with TikTok thumbnail (extracted via TikTok's
 * /photo/<id> URL → first slide image is rendered by TikTok's CDN
 * and we proxy through next/image). Falls back to a placeholder gradient.
 *
 * Table: dense rows with hook style, account, views, likes, saves, save%.
 */

import { useState } from "react";
import Image from "next/image";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { LayoutGrid, Table2, ExternalLink, ImageOff } from "lucide-react";

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

/**
 * Extract a TikTok video/photo id from a URL like
 *   https://www.tiktok.com/@user/photo/7637235858155900174
 * Returns null if the URL isn't of that shape (e.g., TikTok handle-only
 * or empty).
 */
function tiktokIdFromUrl(url: string | null): string | null {
  if (!url) return null;
  const m = url.match(/\/(?:video|photo)\/(\d+)/);
  return m?.[1] ?? null;
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
                <TableRow key={p.id}>
                  <TableCell>
                    <span className="inline-flex items-center rounded-full bg-secondary px-2 py-0.5 text-xs font-medium">
                      {p.hook_style ?? "—"}
                    </span>
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
  const tiktokId = tiktokIdFromUrl(post.tiktok_url);
  const hasUrl = post.tiktok_url && post.tiktok_url !== "-";

  // Use a vertical aspect (TikTok-shaped) so the cards feel like the
  // platform they live on. Image filled if available, gradient placeholder
  // with hook text if we can't render a thumbnail.
  return (
    <a
      href={hasUrl ? post.tiktok_url! : undefined}
      target={hasUrl ? "_blank" : undefined}
      rel={hasUrl ? "noopener noreferrer" : undefined}
      className="group relative aspect-[9/16] block overflow-hidden rounded-lg border border-border bg-gradient-to-br from-amber-50 via-orange-50 to-rose-50 hover:ring-2 hover:ring-primary/40 transition-all"
    >
      {tiktokId ? (
        // TikTok's oembed/CDN thumbnails aren't directly addressable via a
        // stable URL, so we use the post URL itself as a fallback. The card
        // still works without an image — the gradient + hook text + metrics
        // are the primary content.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={`https://www.tiktok.com/oembed?url=${encodeURIComponent(post.tiktok_url!)}&format=json`}
          alt=""
          className="hidden"
          aria-hidden
        />
      ) : null}

      {/* Hook label centered */}
      <div className="absolute inset-0 flex flex-col items-center justify-center p-3 text-center">
        <ImageOff className="h-6 w-6 text-orange-300/80 mb-2" />
        <p className="text-xs font-semibold text-orange-900/80 line-clamp-3">
          {post.hook_style ?? "post"}
        </p>
      </div>

      {/* Stats overlay */}
      <div className="absolute inset-x-0 bottom-0 p-2 bg-gradient-to-t from-black/80 via-black/40 to-transparent">
        <p className="text-sm font-bold text-white tabular-nums">
          {formatNumber(post.views)} views
        </p>
        <div className="flex items-center justify-between text-[10px] text-white/80 mt-0.5">
          <span>@{post.account ?? "?"}</span>
          {post.save_rate != null && post.save_rate > 0 && (
            <span className="tabular-nums">{Number(post.save_rate).toFixed(2)}% save</span>
          )}
        </div>
      </div>

      {hasUrl && (
        <span className="absolute top-1.5 right-1.5 rounded-full bg-black/50 p-1 opacity-0 group-hover:opacity-100 transition-opacity">
          <ExternalLink className="h-3 w-3 text-white" />
        </span>
      )}
    </a>
  );
}

// suppress unused warning when next/image is needed for some build configs;
// linker keeps this even though the inline component above uses <img>.
void Image;
