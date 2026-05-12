"use client";

/**
 * Collapsible "all posts by this creator" section for the profile.
 *
 * Default state: collapsed. Header shows the total count + a hint, so
 * the profile page doesn't grow proportionally with the creator's
 * volume of work (a creator with 500 posts would otherwise dwarf
 * every other section).
 *
 * Expanded: a scrollable list of every post tagged to this creator,
 * each row wrapped in <PostTrigger> so clicking opens the universal
 * post detail drawer (the same one mounted globally in
 * (dashboard)/layout.tsx). The drawer shows views / likes / saves /
 * comments / shares / hashtags / hook + the "Tag creator" action,
 * so this row click is the natural "tell me everything about this
 * post" affordance.
 */

import { useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PostTrigger } from "@/components/post-trigger";

export interface CreatorProfilePost {
  id: string;
  date: string | null;
  account: string | null;
  views: number | null;
  likes: number | null;
  saves: number | null;
  status: string | null;
  hook_style: string | null;
  format: string | null;
  tiktok_url: string | null;
}

export function AllPostsDropdown({ posts }: { posts: CreatorProfilePost[] }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");

  // Cheap client-side filter so the operator can find a specific post
  // without paging — matches hook style, account handle, date, format.
  // For a creator with 500 posts this stays snappy because the list
  // is already in memory.
  const filtered = query.trim()
    ? posts.filter((p) => {
        const q = query.trim().toLowerCase();
        return (
          (p.hook_style ?? "").toLowerCase().includes(q) ||
          (p.account ?? "").toLowerCase().includes(q) ||
          (p.format ?? "").toLowerCase().includes(q) ||
          (p.date ?? "").includes(q) ||
          (p.status ?? "").toLowerCase().includes(q)
        );
      })
    : posts;

  return (
    <Card>
      <CardContent className="pt-6">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="w-full flex items-center justify-between gap-3 group"
          aria-expanded={open}
        >
          <div className="text-left min-w-0">
            <p className="text-base font-semibold">All posts</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {posts.length === 0
                ? "Nothing here yet."
                : `${posts.length} post${posts.length === 1 ? "" : "s"} — click any row for the full details drawer.`}
            </p>
          </div>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform shrink-0 ${open ? "rotate-180" : ""}`}
          />
        </button>

        {open && posts.length > 0 && (
          <div className="mt-4 space-y-3">
            {/* Inline search — only renders when there are enough
                posts to make scanning slow. */}
            {posts.length > 8 && (
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                <Input
                  className="pl-9 h-9 text-sm"
                  placeholder="Search by hook, account, date, format…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  {filtered.length} of {posts.length} match
                </p>
              </div>
            )}

            <div className="divide-y divide-border/60 max-h-[600px] overflow-y-auto -mx-2 rounded-md border border-border/40">
              {filtered.length === 0 ? (
                <p className="px-4 py-6 text-center text-xs text-muted-foreground">
                  No matches for &ldquo;{query}&rdquo;.
                </p>
              ) : (
                filtered.map((p) => (
                  <PostTrigger
                    key={p.id}
                    postId={p.id}
                    className="w-full flex items-center justify-between gap-3 px-3 py-2.5 text-left hover:bg-muted/40 transition-colors"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium truncate">
                        {p.hook_style || "—"}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5 truncate">
                        {p.date ?? "no date"}
                        {p.account && <> · @{p.account}</>}
                        {p.format && <> · {p.format}</>}
                        {p.status && p.status !== "published" && (
                          <> · <span className="uppercase">{p.status}</span></>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-4 shrink-0 text-sm tabular-nums">
                      <div className="text-right">
                        <p className="font-semibold">{(p.views ?? 0).toLocaleString("en-US")}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-widest">views</p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold">{(p.likes ?? 0).toLocaleString("en-US")}</p>
                        <p className="text-[10px] text-muted-foreground uppercase tracking-widest">likes</p>
                      </div>
                    </div>
                  </PostTrigger>
                ))
              )}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
