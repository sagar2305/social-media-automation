"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChevronDown, ChevronRight, ExternalLink } from "lucide-react";

interface FailedPost {
  id: string;
  date: string | null;
  hook_style: string | null;
  format: string | null;
  status: string | null;
  account: string | null;
  flow: string | null;
  tiktok_url: string | null;
  hashtags: string[] | null;
  views: number | null;
  saves: number | null;
  created_at: string | null;
}

interface AutoFixEvent {
  id: number;
  occurred_at: string;
  source: string;
  tier: string;
  signature: string;
  message: string | null;
  action: string | null;
  handled: string;
}

function classifyReason(p: FailedPost): { reason: string; explain: string } {
  if (p.status === "failed" || p.status === "error") {
    return {
      reason: "Post failed to publish",
      explain:
        "Blotato accepted the submission but TikTok rejected it during publish. Common causes: TikTok app on the phone is too old (update App Store), photo carousel rejected by trust/safety, or the account was rate-limited. Check the linked auto-fix event below for the exact upstream reason.",
    };
  }
  if (p.status === "in-progress" || p.status === "draft") {
    return {
      reason: "Stuck in draft — never published",
      explain:
        "Submission landed in TikTok's draft inbox but was never published. Either an admin must open the TikTok app and tap Publish on the draft, or the cycle ran with --path=draft (UPLOAD mode) intentionally. If unintentional, the post can be retried via the Run Cycle Now button.",
    };
  }
  if (!p.tiktok_url && p.status === "published") {
    return {
      reason: "Published but no TikTok URL captured",
      explain:
        "Blotato says published, but ScrapeCreators couldn't match this post to a live TikTok video by hashtag overlap. Either the post is shadowbanned, or the analytics matcher needs more data — try `npm run analytics` to retry.",
    };
  }
  return {
    reason: "Status unknown",
    explain: `Status="${p.status ?? "(null)"}" — this combination wasn't expected. Check POST-TRACKER.md for raw row.`,
  };
}

function fmtAbsolute(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString();
  } catch {
    return iso;
  }
}

export function FailedPostsTable({ posts }: { posts: FailedPost[] }) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [eventsByDate, setEventsByDate] = useState<Map<string, AutoFixEvent[]>>(new Map());
  const [loadingEvents, setLoadingEvents] = useState(false);

  const visible = posts.slice(0, 8);

  // When user expands a row, fetch matching auto_fix_events from the same day
  useEffect(() => {
    if (expanded.size === 0) return;
    const datesToLoad = Array.from(expanded)
      .map((id) => visible.find((p) => p.id === id)?.date)
      .filter((d): d is string => !!d && !eventsByDate.has(d));
    if (datesToLoad.length === 0) return;

    let cancelled = false;
    setLoadingEvents(true);
    const supabase = createBrowserSupabase();

    Promise.all(
      datesToLoad.map(async (date) => {
        const start = `${date}T00:00:00Z`;
        const end = `${date}T23:59:59Z`;
        const { data } = await supabase
          .from("auto_fix_events")
          .select("id, occurred_at, source, tier, signature, message, action, handled")
          .gte("occurred_at", start)
          .lte("occurred_at", end)
          .order("occurred_at", { ascending: false });
        return [date, (data as AutoFixEvent[] | null) ?? []] as const;
      })
    ).then((entries) => {
      if (cancelled) return;
      setEventsByDate((prev) => {
        const next = new Map(prev);
        for (const [date, events] of entries) next.set(date, events);
        return next;
      });
      setLoadingEvents(false);
    });

    return () => { cancelled = true; };
  }, [expanded, visible, eventsByDate]);

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (visible.length === 0) return null;

  return (
    <>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[28px]" />
              <TableHead className="text-xs">Post ID</TableHead>
              <TableHead className="text-xs">Date</TableHead>
              <TableHead className="text-xs">Account</TableHead>
              <TableHead className="text-xs">Hook</TableHead>
              <TableHead className="text-xs">Format</TableHead>
              <TableHead className="text-xs">Status</TableHead>
              <TableHead className="text-xs">Reason</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((p) => {
              const isOpen = expanded.has(p.id);
              const { reason, explain } = classifyReason(p);
              const dateEvents = (p.date && eventsByDate.get(p.date)) || [];
              const relevantEvents = dateEvents.filter(
                (e) =>
                  e.source === "blotato" ||
                  e.source === "scrapeCreators" ||
                  e.tier === "HUMAN-ONLY",
              );

              return (
                <Fragment key={p.id}>
                  <TableRow
                    onClick={() => toggle(p.id)}
                    className="cursor-pointer align-top"
                    aria-expanded={isOpen}
                  >
                    <TableCell className="text-muted-foreground pt-3">
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </TableCell>
                    <TableCell className="text-xs font-mono pt-3">
                      {p.id.slice(0, 12)}…
                    </TableCell>
                    <TableCell className="text-xs pt-3">{p.date ?? "—"}</TableCell>
                    <TableCell className="text-xs pt-3">@{p.account || "unknown"}</TableCell>
                    <TableCell className="text-xs pt-3">{p.hook_style ?? "—"}</TableCell>
                    <TableCell className="text-xs pt-3">{p.format ?? "—"}</TableCell>
                    <TableCell className="pt-3">
                      <span
                        className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-medium ${
                          p.status === "failed" || p.status === "error"
                            ? "bg-red-500/10 text-red-500"
                            : "bg-amber-500/10 text-amber-600"
                        }`}
                      >
                        {p.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground pt-3">{reason}</TableCell>
                  </TableRow>

                  {isOpen && (
                    <TableRow className="bg-muted/30 hover:bg-muted/30">
                      <TableCell />
                      <TableCell colSpan={7} className="py-4 align-top">
                        <div className="space-y-4 max-w-3xl pr-4">
                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-3 text-xs">
                            <div className="min-w-0">
                              <p className="text-muted-foreground uppercase tracking-wide mb-0.5">Post ID</p>
                              <code className="block font-mono text-[11px] break-all leading-snug">{p.id}</code>
                            </div>
                            <div className="min-w-0">
                              <p className="text-muted-foreground uppercase tracking-wide mb-0.5">Created</p>
                              <p className="tabular-nums break-words">{fmtAbsolute(p.created_at)}</p>
                            </div>
                            <div className="min-w-0">
                              <p className="text-muted-foreground uppercase tracking-wide mb-0.5">Flow</p>
                              <p className="break-words">{p.flow ?? "—"}</p>
                            </div>
                            <div className="min-w-0">
                              <p className="text-muted-foreground uppercase tracking-wide mb-0.5">Status</p>
                              <p className="break-words">{p.status ?? "—"}</p>
                            </div>
                          </div>

                          <div className="min-w-0">
                            <p className="text-muted-foreground uppercase tracking-wide text-xs mb-1">
                              Why this likely failed
                            </p>
                            <p className="text-sm leading-relaxed break-words">{explain}</p>
                          </div>

                          {p.hashtags && p.hashtags.length > 0 && (
                            <div className="min-w-0">
                              <p className="text-muted-foreground uppercase tracking-wide text-xs mb-1">
                                Hashtags ({p.hashtags.length})
                              </p>
                              <div className="flex flex-wrap gap-1">
                                {p.hashtags.slice(0, 20).map((tag, i) => (
                                  <code
                                    key={i}
                                    className="text-[11px] font-mono bg-background border border-border/40 rounded px-1.5 py-0.5 break-all"
                                  >
                                    {tag}
                                  </code>
                                ))}
                              </div>
                            </div>
                          )}

                          <div>
                            <p className="text-muted-foreground uppercase tracking-wide text-xs mb-1">
                              Auto-fix events on {p.date ?? "this date"}
                              {loadingEvents && p.date && !eventsByDate.has(p.date) && " (loading…)"}
                            </p>
                            {relevantEvents.length > 0 ? (
                              <div className="space-y-2">
                                {relevantEvents.slice(0, 5).map((e) => (
                                  <div
                                    key={e.id}
                                    className="bg-background border border-border/40 rounded p-2 text-xs"
                                  >
                                    <div className="flex items-center gap-2 mb-1">
                                      <span className="font-medium">{e.source}</span>
                                      <span className="text-muted-foreground">·</span>
                                      <span className="text-[10px] uppercase tracking-wide bg-muted rounded px-1.5 py-0.5">
                                        {e.tier}
                                      </span>
                                      <span className="text-[10px] text-muted-foreground ml-auto">
                                        {new Date(e.occurred_at).toLocaleTimeString()}
                                      </span>
                                    </div>
                                    <code className="block font-mono text-[11px] break-all mb-1">
                                      {e.signature}
                                    </code>
                                    {e.action && (
                                      <p className="text-muted-foreground">{e.action}</p>
                                    )}
                                  </div>
                                ))}
                                <Link
                                  href={`/errors?source=blotato`}
                                  className="text-xs font-medium text-primary hover:underline inline-flex items-center gap-1"
                                >
                                  View all errors <ExternalLink className="h-3 w-3" />
                                </Link>
                              </div>
                            ) : (
                              <p className="text-xs text-muted-foreground italic">
                                No related auto-fix events recorded on this date. The failure may have happened on a different date or wasn&apos;t captured by the classifier.
                              </p>
                            )}
                          </div>

                          <div className="flex gap-2 pt-2 border-t border-border/40">
                            <Link
                              href={`/posts?search=${p.id.slice(0, 12)}`}
                              className="text-xs font-medium text-primary hover:underline"
                            >
                              See full post details →
                            </Link>
                            {p.tiktok_url && (
                              <a
                                href={p.tiktok_url}
                                target="_blank"
                                rel="noreferrer"
                                className="text-xs font-medium text-primary hover:underline ml-auto inline-flex items-center gap-1"
                              >
                                Open on TikTok <ExternalLink className="h-3 w-3" />
                              </a>
                            )}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      </div>
      {posts.length > 8 && (
        <Link
          href="/posts"
          className="block text-xs font-medium text-primary hover:underline text-center pt-2"
        >
          View all {posts.length} unposted items
        </Link>
      )}
    </>
  );
}
