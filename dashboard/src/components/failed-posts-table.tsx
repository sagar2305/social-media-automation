"use client";

import { Fragment, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Check, ChevronDown, ChevronRight, ExternalLink } from "lucide-react";

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
  failure_resolved: boolean | null;
  error_message: string | null;
  error_source: string | null;
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

function classifyReason(p: FailedPost): { reason: string; explain: string; isExact: boolean; fixHint?: string } {
  // EXACT reason (from Blotato's errorMessage field) — this is the real
  // upstream cause for THIS specific post. When present, prefer it over
  // any heuristic.
  if (p.error_message && (p.status === "failed" || p.status === "error")) {
    const msg = p.error_message;
    let fixHint: string | undefined;

    // Map known message patterns to actionable fix hints.
    if (/maximum number of \d+ unique accounts/i.test(msg)) {
      fixHint = "Blotato Starter plan caps you at 3 unique TikTok accounts in any 24h window. Either upgrade the Blotato plan, or wait 24h and reduce active accounts. Our scheduler already drops the 4th+ account each day to avoid this — if you're seeing it, a manual run or autoresearch experiment likely tripped the limit.";
    } else if (/update.*TikTok.*(?:latest|version)/i.test(msg)) {
      fixHint = "TikTok rejected the upload because the TikTok app on the phone where this account is logged in is too old. Open the TikTok app on the affected phone, update it from the App Store / Play Store, then the next cycle will succeed for this account.";
    } else if (/Cannot read properties of undefined/i.test(msg) || /Internal error/i.test(msg)) {
      fixHint = "Blotato's backend hit an internal error parsing the TikTok response. Per Blotato support docs, this is usually transient — the next cycle attempt typically succeeds. retry_handler will pick it up automatically on the next run.";
    } else if (/connection error while downloading the photo/i.test(msg) || /publicly accessible/i.test(msg)) {
      fixHint = "TikTok couldn't fetch our slide images while publishing. The image host (Blotato media) may have been rate-limited or briefly unavailable. Usually fixes itself on the next attempt; if it persists, check Blotato media uploader status.";
    } else if (/Something went wrong/i.test(msg)) {
      fixHint = "Generic transient TikTok error. Retry on the next cycle. If it repeats more than 2x in a row for the same account, the account may have a deeper issue (suspension review, etc.).";
    }

    return {
      reason: msg,
      explain: fixHint ?? "Exact upstream error captured from Blotato. No catalog hint available for this specific message — check the auto-fix events below or the run log for context.",
      isExact: true,
      fixHint,
    };
  }

  if (p.status === "failed" || p.status === "error") {
    return {
      reason: "Marked failed at the time (no upstream message captured)",
      explain:
        "This post was recorded as failed but we didn't store the upstream reason — likely an older post from before per-post error capture was wired up. Run `npm run analytics` to refresh statuses; the next status sync will fill in the actual error message if Blotato still has it.",
      isExact: false,
    };
  }
  if (p.status === "in-progress" || p.status === "draft") {
    return {
      reason: "Stuck in draft — never published",
      explain:
        "Submission landed in TikTok's draft inbox but was never published. Either an admin must open the TikTok app and tap Publish on the draft, or the cycle ran with path=draft intentionally. If you don't plan to publish this draft, click Mark Resolved.",
      isExact: false,
    };
  }
  if (!p.tiktok_url && p.status === "published") {
    return {
      reason: "Published but no TikTok URL captured",
      explain:
        "Blotato reports published, but ScrapeCreators couldn't match this post to a live TikTok video by hashtag overlap. Either the post is shadowbanned, the post was deleted, or the analytics matcher needs more data. Try `npm run analytics` to retry, or Mark Resolved if you've manually verified the post is fine.",
      isExact: false,
    };
  }
  return {
    reason: "Status unclear",
    explain: `The current status is "${p.status ?? "(null)"}". Without more context we can't say more. If you've handled this manually, click Mark Resolved.`,
    isExact: false,
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

export function FailedPostsTable({ posts: initial }: { posts: FailedPost[] }) {
  const router = useRouter();
  const [posts, setPosts] = useState<FailedPost[]>(initial);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  async function markResolved(id: string) {
    if (!confirm("Mark this post as resolved?\n\nUse this only if you've actually verified the issue is handled (e.g., the underlying cause is fixed, the post was published manually, etc.). It will disappear from the open list.")) return;
    setResolvingId(id);
    const supabase = createBrowserSupabase();
    const { error } = await supabase
      .from("posts")
      .update({
        failure_resolved: true,
        failure_resolution_note: "Marked resolved by admin",
        failure_resolved_at: new Date().toISOString(),
      })
      .eq("id", id);
    setResolvingId(null);
    if (error) {
      alert(`Could not mark resolved: ${error.message}`);
      return;
    }
    setPosts((prev) => prev.filter((p) => p.id !== id));
    router.refresh();
  }
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
              const { reason, explain, isExact } = classifyReason(p);
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
                    <TableCell className={`text-xs pt-3 ${isExact ? "text-foreground font-medium" : "text-muted-foreground"}`}>
                      <span className="line-clamp-2">{reason}</span>
                    </TableCell>
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

                          {isExact ? (
                            <div className="min-w-0 rounded-lg bg-red-50 border border-red-200 px-3 py-2.5">
                              <p className="text-[11px] font-semibold uppercase tracking-wide text-red-800 mb-1">
                                Exact upstream error (from {p.error_source ?? "blotato"})
                              </p>
                              <p className="text-sm leading-relaxed break-words text-red-900 font-medium">
                                {reason}
                              </p>
                              <p className="text-xs leading-relaxed break-words text-red-800 mt-2 pt-2 border-t border-red-200/70">
                                <strong>How to fix:</strong> {explain}
                              </p>
                            </div>
                          ) : (
                            <div className="min-w-0">
                              <p className="text-muted-foreground uppercase tracking-wide text-xs mb-1">
                                Best-effort interpretation
                              </p>
                              <p className="text-sm leading-relaxed break-words">{explain}</p>
                            </div>
                          )}

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

                          <div className="flex flex-wrap items-center gap-3 pt-3 border-t border-border/40">
                            <Button
                              onClick={() => markResolved(p.id)}
                              disabled={resolvingId === p.id}
                            >
                              <Check className="h-4 w-4 mr-1.5" />
                              {resolvingId === p.id ? "Marking…" : "Mark Resolved"}
                            </Button>
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
