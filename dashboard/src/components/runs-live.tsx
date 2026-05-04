"use client";

import { useEffect, useMemo, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Card, CardContent } from "@/components/ui/card";
import {
  Activity,
  CheckCircle2,
  XCircle,
  CircleDot,
  ChevronRight,
  RefreshCw,
} from "lucide-react";

interface CycleRun {
  id: string;
  caller: string;
  flows: string[];
  accounts: string[];
  path: string;
  status: "running" | "completed" | "failed";
  started_at: string;
  ended_at: string | null;
  current_phase: string | null;
  posts_total: number;
  posts_done: number;
  posts_failed: number;
  error_text: string | null;
}

interface CycleEvent {
  id: number;
  cycle_run_id: string;
  occurred_at: string;
  kind: string;
  label: string;
  message: string | null;
  account: string | null;
  flow: string | null;
}

const POLL_MS_LIVE = 4000;
const POLL_MS_IDLE = 20000;

export function RunsLive() {
  const [runs, setRuns] = useState<CycleRun[]>([]);
  const [events, setEvents] = useState<CycleEvent[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const live = runs.some((r) => r.status === "running");
  const pollMs = live ? POLL_MS_LIVE : POLL_MS_IDLE;

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserSupabase();

    async function tick() {
      const [runsRes] = await Promise.all([
        supabase
          .from("cycle_runs")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(20),
      ]);
      if (cancelled) return;
      const fetchedRuns = (runsRes.data as CycleRun[] | null) ?? [];
      setRuns(fetchedRuns);
      const focusId = selectedId ?? fetchedRuns[0]?.id ?? null;
      if (focusId !== selectedId) setSelectedId(focusId);
      if (focusId) {
        const evRes = await supabase
          .from("cycle_events")
          .select("*")
          .eq("cycle_run_id", focusId)
          .order("occurred_at", { ascending: true });
        if (cancelled) return;
        setEvents((evRes.data as CycleEvent[] | null) ?? []);
      } else {
        setEvents([]);
      }
      setLoading(false);
    }

    tick();
    const interval = setInterval(tick, pollMs);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [selectedId, pollMs]);

  const selectedRun = useMemo(
    () => runs.find((r) => r.id === selectedId) ?? runs[0] ?? null,
    [runs, selectedId],
  );

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            Live Runs
            {live && (
              <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-600">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                LIVE
              </span>
            )}
          </h1>
          <p className="text-muted-foreground mt-1">
            Real-time progress of every cycle. Auto-refreshing every {pollMs / 1000}s.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className={`h-3.5 w-3.5 ${live ? "animate-spin" : ""}`} />
          {loading ? "Loading…" : `${runs.length} recent runs`}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Runs list */}
        <div className="lg:col-span-1 space-y-3">
          {runs.length === 0 && !loading && (
            <Card className="border-dashed border border-border/50">
              <CardContent className="py-8 text-center text-muted-foreground text-sm">
                No runs yet. Trigger a cycle and it&apos;ll show up here live.
              </CardContent>
            </Card>
          )}
          {runs.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={`w-full text-left transition-colors rounded-xl ${
                selectedRun?.id === r.id ? "ring-2 ring-primary" : ""
              }`}
            >
              <Card className="border-0 ring-0 shadow-sm hover:bg-muted/30">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-2">
                        <StatusIcon status={r.status} />
                        <span className="text-xs font-semibold uppercase tracking-wide">
                          {r.status}
                        </span>
                      </div>
                      <p className="text-sm font-medium mt-1.5">
                        {r.flows.join(" + ")}
                      </p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {r.accounts.length} account{r.accounts.length !== 1 ? "s" : ""} ·{" "}
                        {r.posts_done}/{r.posts_total} posts
                        {r.posts_failed > 0 && ` · ${r.posts_failed} failed`}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-muted-foreground">
                    <span>{formatStartedAt(r.started_at)}</span>
                    <span>{formatDuration(r.started_at, r.ended_at)}</span>
                  </div>
                  {r.status === "running" && (
                    <ProgressBar done={r.posts_done} total={Math.max(r.posts_total, 1)} />
                  )}
                </CardContent>
              </Card>
            </button>
          ))}
        </div>

        {/* Timeline detail */}
        <div className="lg:col-span-2">
          {selectedRun ? (
            <Card className="border-0 ring-0 shadow-sm">
              <CardContent className="pt-6 space-y-4">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <StatusBadge status={selectedRun.status} />
                      <span className="text-xs text-muted-foreground">
                        caller={selectedRun.caller} · path={selectedRun.path}
                      </span>
                    </div>
                    <p className="mt-2 text-lg font-semibold truncate">
                      {selectedRun.flows.join(" + ")}
                    </p>
                    <p className="text-sm text-muted-foreground truncate">
                      {selectedRun.accounts.join(", ")}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="text-2xl font-bold tabular-nums">
                      {selectedRun.posts_done}/{selectedRun.posts_total}
                    </p>
                    <p className="text-[11px] text-muted-foreground uppercase tracking-wide">
                      posts
                    </p>
                  </div>
                </div>

                {selectedRun.current_phase && selectedRun.status === "running" && (
                  <div className="rounded-lg bg-emerald-50 border border-emerald-200 px-3 py-2 text-sm flex items-center gap-2">
                    <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="font-medium">Currently:</span>
                    <span>{selectedRun.current_phase}</span>
                  </div>
                )}

                {selectedRun.error_text && (
                  <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive">
                    <p className="font-medium mb-0.5">Cycle failed</p>
                    <p className="text-xs font-mono">{selectedRun.error_text}</p>
                  </div>
                )}

                <Timeline events={events} />
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed border border-border/50">
              <CardContent className="py-16 text-center text-muted-foreground text-sm">
                Select a run on the left to see its timeline.
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Timeline({ events }: { events: CycleEvent[] }) {
  if (events.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-6 text-center">
        No events yet for this run.
      </p>
    );
  }
  return (
    <div className="border-l border-border/60 ml-2 pl-5 space-y-3">
      {events.map((e) => (
        <div key={e.id} className="relative">
          <span
            className={`absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full ring-4 ring-background ${kindColor(e.kind)}`}
          />
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{e.label}</p>
              {e.message && (
                <p className="text-xs text-muted-foreground mt-0.5 break-words">
                  {e.message}
                </p>
              )}
              {(e.account || e.flow) && (
                <p className="text-[11px] text-muted-foreground mt-1 font-mono">
                  {[e.flow, e.account && `@${e.account}`].filter(Boolean).join(" · ")}
                </p>
              )}
            </div>
            <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
              {formatTimeOnly(e.occurred_at)}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function StatusIcon({ status }: { status: CycleRun["status"] }) {
  if (status === "running") {
    return <CircleDot className="h-4 w-4 text-emerald-600 animate-pulse" />;
  }
  if (status === "completed") {
    return <CheckCircle2 className="h-4 w-4 text-emerald-600" />;
  }
  return <XCircle className="h-4 w-4 text-destructive" />;
}

function StatusBadge({ status }: { status: CycleRun["status"] }) {
  const cls =
    status === "running"
      ? "bg-emerald-100 text-emerald-800 border-emerald-200"
      : status === "completed"
        ? "bg-muted text-foreground border-border"
        : "bg-destructive/10 text-destructive border-destructive/30";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wide ${cls}`}>
      {status === "running" && <Activity className="h-3 w-3" />}
      {status}
    </span>
  );
}

function ProgressBar({ done, total }: { done: number; total: number }) {
  const pct = Math.min(100, Math.round((done / total) * 100));
  return (
    <div className="mt-2 h-1.5 w-full rounded-full bg-muted overflow-hidden">
      <div className="h-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
    </div>
  );
}

function kindColor(kind: string): string {
  switch (kind) {
    case "cycle_start":
    case "cycle_done":
      return "bg-emerald-500";
    case "phase_start":
    case "phase_done":
      return "bg-primary";
    case "post_submitted":
      return "bg-emerald-500";
    case "post_generated":
      return "bg-blue-500";
    case "post_failed":
    case "error":
      return "bg-destructive";
    case "flow_start":
      return "bg-violet-500";
    default:
      return "bg-muted-foreground";
  }
}

function formatTimeOnly(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  } catch {
    return iso;
  }
}

function formatStartedAt(iso: string): string {
  try {
    const d = new Date(iso);
    const today = new Date();
    if (d.toDateString() === today.toDateString()) {
      return `Today, ${d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`;
    }
    return d.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return iso;
  }
}

function formatDuration(start: string, end: string | null): string {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : Date.now();
  const sec = Math.max(0, Math.round((endMs - startMs) / 1000));
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  return remSec > 0 ? `${min}m ${remSec}s` : `${min}m`;
}
