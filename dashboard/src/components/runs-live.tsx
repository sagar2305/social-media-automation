"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Activity,
  CheckCircle2,
  XCircle,
  CircleDot,
  ChevronRight,
  RefreshCw,
  StopCircle,
  Trash2,
  Clock,
} from "lucide-react";

interface CycleRun {
  id: string;
  caller: string;
  flows: string[];
  accounts: string[];
  path: string;
  status: "running" | "completed" | "failed" | "cancelled";
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

/**
 * Upcoming batch row — surfaces a scheduled-but-not-yet-fired batch
 * in the Live Runs UI. Closes the gap where a freshly created batch
 * was invisible until the next 5-min scheduler tick spawned it,
 * confusing the operator into thinking nothing happened.
 */
interface UpcomingBatch {
  id: string;
  label: string;
  run_time: string;            // "HH:MM"
  flows: string[];              // ['photorealistic', ...]
  account_handles: string[];
  enabled: boolean;
  last_run_date: string | null;
  campaign_id: string | null;
  campaign_name: string | null;
  campaign_slug: string | null;
}

const POLL_MS_LIVE = 4000;
const POLL_MS_IDLE = 20000;

export function RunsLive() {
  const router = useRouter();
  const [runs, setRuns] = useState<CycleRun[]>([]);
  const [events, setEvents] = useState<CycleEvent[]>([]);
  const [upcoming, setUpcoming] = useState<UpcomingBatch[]>([]);
  const [tz, setTz] = useState<string>("UTC");
  const [now, setNow] = useState<number>(() => Date.now());
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  const live = runs.some((r) => r.status === "running");
  const pollMs = live ? POLL_MS_LIVE : POLL_MS_IDLE;

  async function cancelRun(runId: string) {
    if (!confirm("Cancel this running cycle?\n\nThe Mac process may take up to 30 seconds to notice and exit. Already-submitted posts to Blotato cannot be unposted — only future phases will be skipped.")) return;
    setBusyId(runId);
    const supabase = createBrowserSupabase();
    const cancelledAt = new Date().toISOString();

    // Cancel the cycle_run itself. RLS / network blips / status-changed-
    // out-from-under-us all surface as `error` on the response — if we
    // don't check it, the UI flips to "cancelled" while the Mac process
    // keeps running and the operator never knows. The whole point of
    // Cancel is to actually halt the run, so a silent failure here is
    // worse than a noisy one.
    const { error: runErr } = await supabase
      .from("cycle_runs")
      .update({ status: "cancelled", ended_at: cancelledAt, error_text: "Cancelled by admin" })
      .eq("id", runId)
      .eq("status", "running");
    if (runErr) {
      setBusyId(null);
      alert(`Cancel failed: ${runErr.message}\n\nThe cycle is still running. Try again, or check the Mac mini logs.`);
      return;
    }

    // Close the parent cycle_jobs row so the "Running…" pill in the
    // campaign hero stops showing. Without this, the job sits in
    // 'claimed' forever (the Mac poller may have crashed mid-run, or
    // the user cancelled before the poller got a chance to write back).
    // Bounded to status='claimed' so we never overwrite a job that
    // legitimately completed in the meantime. We don't fail the cancel
    // if THIS update errors — the run itself is already marked
    // cancelled above, which is the user-visible contract; this is
    // best-effort cleanup of the pill. Log it so the operator sees the
    // mismatch in their console but doesn't get a blocking alert.
    const { error: jobErr } = await supabase
      .from("cycle_jobs")
      .update({
        status: "cancelled",
        completed_at: cancelledAt,
        error_text: "Cancelled by admin (cycle_run cancelled)",
      })
      .eq("cycle_run_id", runId)
      .eq("status", "claimed");
    if (jobErr) {
      console.warn(`[runs-live] cycle_run cancelled but cycle_jobs cleanup failed: ${jobErr.message}`);
    }

    setBusyId(null);
    setRuns((prev) => prev.map((r) => (r.id === runId ? { ...r, status: "cancelled" } : r)));
    router.refresh();
  }

  async function deleteRun(runId: string) {
    if (!confirm("Delete this run from history?\n\nRemoves the run + all its events. Cannot be undone.")) return;
    setBusyId(runId);
    const supabase = createBrowserSupabase();
    // Delete events FIRST so that if cycle_runs delete fails we don't
    // end up with orphan events pointing at a still-existing parent
    // (the schema may or may not have ON DELETE CASCADE — relying on
    // explicit order keeps us safe either way).
    const { error: evErr } = await supabase.from("cycle_events").delete().eq("cycle_run_id", runId);
    if (evErr) {
      setBusyId(null);
      alert(`Delete failed (events): ${evErr.message}\n\nThe run was NOT deleted. Refresh and try again.`);
      return;
    }
    const { error: runErr } = await supabase.from("cycle_runs").delete().eq("id", runId);
    if (runErr) {
      setBusyId(null);
      alert(`Delete failed (run): ${runErr.message}\n\nEvents were deleted but the run row remains — refresh and retry to clean it up.`);
      return;
    }
    setBusyId(null);
    setRuns((prev) => prev.filter((r) => r.id !== runId));
    if (selectedId === runId) setSelectedId(null);
    router.refresh();
  }

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserSupabase();

    async function tick() {
      // Fetch runs, upcoming batches, and schedule timezone in parallel.
      // Upcoming = every enabled batch on every campaign so the operator
      // sees what WILL fire today alongside what's running. Without this
      // the 5-min scheduler-tick latency made fresh batches feel
      // invisible (you'd save a batch, the scheduler wouldn't fire for
      // up to 5 min, and Live Runs showed nothing until it spawned).
      const [runsRes, batchesRes, tzRes] = await Promise.all([
        supabase
          .from("cycle_runs")
          .select("*")
          .order("started_at", { ascending: false })
          .limit(20),
        supabase
          .from("cycle_batches")
          .select("id, label, run_time, flows, account_handles, enabled, last_run_date, campaign_id, campaigns:campaign_id(slug, name)")
          .eq("enabled", true)
          .order("run_time", { ascending: true }),
        supabase
          .from("schedule_settings")
          .select("timezone")
          .eq("id", 1)
          .maybeSingle<{ timezone: string }>(),
      ]);
      if (cancelled) return;
      const fetchedRuns = (runsRes.data as CycleRun[] | null) ?? [];
      setRuns(fetchedRuns);
      // PostgREST returns the embedded `campaigns` as an array even for
      // a !inner / 1:1 join, so accept both shapes and normalise.
      type RawBatch = {
        id: string; label: string; run_time: string; flows: string[];
        account_handles: string[]; enabled: boolean; last_run_date: string | null;
        campaign_id: string | null;
        campaigns: { slug: string; name: string } | { slug: string; name: string }[] | null;
      };
      const fetchedUpcoming = ((batchesRes.data ?? []) as unknown as RawBatch[]).map((b) => {
        const campRaw = b.campaigns;
        const camp = Array.isArray(campRaw) ? (campRaw[0] ?? null) : campRaw;
        return {
          id: b.id,
          label: b.label,
          run_time: b.run_time,
          flows: b.flows,
          account_handles: b.account_handles,
          enabled: b.enabled,
          last_run_date: b.last_run_date,
          campaign_id: b.campaign_id,
          campaign_name: camp?.name ?? null,
          campaign_slug: camp?.slug ?? null,
        };
      });
      setUpcoming(fetchedUpcoming);
      if (tzRes.data?.timezone) setTz(tzRes.data.timezone);
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

  // 1-Hz "now" tick so the countdown labels ("in 2m 14s") feel live.
  // Cheap — it's just setState with the same number; React bails out
  // when the value hasn't changed.
  useEffect(() => {
    const i = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(i);
  }, []);

  // Compute the upcoming-today list. A batch is "upcoming today" when:
  //   - it's enabled
  //   - it hasn't already run today (last_run_date != today in tz)
  //   - it has account_handles set (legacy empty-rows are blocked
  //     anyway and we don't want to show them as "will fire")
  //
  // Batches whose run_time is past + outside the 60-min catch-up window
  // are surfaced as "Skipped today" so the operator knows why a
  // scheduled run never started — that's the "sometime not run" case.
  const upcomingToday = useMemo(() => {
    const { date: today, minutes: nowMin } = nowInTz(now, tz);
    return upcoming
      .filter((b) => b.enabled && b.account_handles.length > 0 && b.last_run_date !== today)
      .map((b) => {
        const target = parseHHMM(b.run_time);
        let phase: "soon" | "due" | "skipped";
        if (nowMin < target) phase = "soon";
        else if (nowMin <= target + 60) phase = "due"; // within catch-up window
        else phase = "skipped";
        return { ...b, phase, target };
      });
  }, [upcoming, tz, now]);

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
          {/* Upcoming-today panel — shows scheduled batches BEFORE they
              fire. This is the missing piece that made fresh batches
              feel invisible during the 5-min scheduler-tick lag. The
              instant a batch is saved on the Schedule tab it appears
              here, then transitions into the runs list as "RUNNING"
              the moment the tick spawns it. */}
          {upcomingToday.length > 0 && (
            <Card className="border border-border/50">
              <CardContent className="pt-4 pb-3 space-y-2">
                <div className="flex items-center gap-2 text-[11px] uppercase tracking-widest text-muted-foreground font-semibold">
                  <Clock className="h-3 w-3" />
                  Upcoming today ({tz})
                </div>
                <div className="space-y-1.5">
                  {upcomingToday.map((b) => (
                    <UpcomingRow key={b.id} batch={b} now={now} tz={tz} />
                  ))}
                </div>
                <p className="text-[10px] text-muted-foreground/80 pt-1 border-t border-border/40">
                  The scheduler ticks every 5 min. Batches fire on the next tick at or after their run time.
                </p>
              </CardContent>
            </Card>
          )}

          {runs.length === 0 && upcomingToday.length === 0 && !loading && (
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

                {/* Action buttons — Cancel for running, Delete for terminal */}
                <div className="flex items-center gap-2 pt-2 border-t border-border/40">
                  {selectedRun.status === "running" && (
                    <Button
                      variant="outline"
                      onClick={() => cancelRun(selectedRun.id)}
                      disabled={busyId === selectedRun.id}
                    >
                      <StopCircle className="h-4 w-4 mr-1.5 text-destructive" />
                      {busyId === selectedRun.id ? "Cancelling…" : "Cancel running cycle"}
                    </Button>
                  )}
                  {selectedRun.status !== "running" && (
                    <Button
                      variant="outline"
                      onClick={() => deleteRun(selectedRun.id)}
                      disabled={busyId === selectedRun.id}
                    >
                      <Trash2 className="h-4 w-4 mr-1.5 text-destructive" />
                      {busyId === selectedRun.id ? "Deleting…" : "Delete from history"}
                    </Button>
                  )}
                  {selectedRun.status === "running" && (
                    <p className="text-[11px] text-muted-foreground">
                      Marks the cycle cancelled in the DB. The Mac process may take up to ~30s to notice and exit between phases.
                    </p>
                  )}
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
          {e.kind === "image_prompt" ? (
            <PromptEventRow event={e} />
          ) : (
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
          )}
        </div>
      ))}
    </div>
  );
}

/**
 * Special row for kind='image_prompt' — collapsible so a 500-char
 * Gemini prompt doesn't blow out the timeline. Click "Show prompt"
 * to expand; click "Copy" to drop the full text on the clipboard.
 * One row per slide so the operator can scan flow → slide_role →
 * the exact text that produced each image, in chronological order.
 */
function PromptEventRow({ event }: { event: CycleEvent }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const promptText = event.message ?? "";
  const previewLength = 120;
  const truncated = promptText.length > previewLength;
  const preview = truncated ? `${promptText.slice(0, previewLength)}…` : promptText;

  async function copyPrompt() {
    try {
      await navigator.clipboard.writeText(promptText);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard may be blocked in some browsers; ignore.
    }
  }

  return (
    <div className="rounded-md border border-amber-500/30 bg-amber-50/40 dark:bg-amber-500/[0.04] px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-widest text-amber-700 dark:text-amber-400">
            Gemini prompt
          </p>
          <p className="text-sm font-medium mt-0.5">{event.label}</p>
          {event.flow && (
            <p className="text-[11px] text-muted-foreground mt-0.5 font-mono">{event.flow}</p>
          )}
        </div>
        <span className="text-[11px] text-muted-foreground tabular-nums shrink-0">
          {formatTimeOnly(event.occurred_at)}
        </span>
      </div>
      {promptText && (
        <div className="mt-2">
          {!open ? (
            <p className="text-xs text-muted-foreground break-words font-mono leading-relaxed">
              {preview}
            </p>
          ) : (
            <pre className="text-xs text-foreground bg-background border border-border rounded p-2 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono leading-relaxed">
              {promptText}
            </pre>
          )}
          <div className="flex items-center gap-3 mt-1.5">
            {truncated && (
              <button
                type="button"
                onClick={() => setOpen((v) => !v)}
                className="text-[11px] font-medium text-amber-700 dark:text-amber-400 hover:underline"
              >
                {open ? "Hide prompt" : `Show full prompt (${promptText.length} chars)`}
              </button>
            )}
            <button
              type="button"
              onClick={copyPrompt}
              className="text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              {copied ? "Copied ✓" : "Copy"}
            </button>
          </div>
        </div>
      )}
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
    case "image_prompt":
      return "bg-amber-500";
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

// ─── Upcoming-today helpers ──────────────────────────────────────────

/**
 * Returns YYYY-MM-DD + minutes-since-midnight for `ms` interpreted in
 * the given IANA timezone. Mirrors the engine-side helper in
 * scheduler_tick.ts so the dashboard's "due/skipped/soon" labels match
 * the actual firing logic exactly.
 */
function nowInTz(ms: number, tz: string): { date: string; minutes: number } {
  try {
    const fmt = new Intl.DateTimeFormat("en-CA", {
      timeZone: tz,
      year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit",
      hour12: false,
    });
    const parts = Object.fromEntries(fmt.formatToParts(new Date(ms)).map((p) => [p.type, p.value]));
    return {
      date: `${parts.year}-${parts.month}-${parts.day}`,
      minutes: parseInt(parts.hour as string, 10) * 60 + parseInt(parts.minute as string, 10),
    };
  } catch {
    const d = new Date(ms);
    return {
      date: d.toISOString().slice(0, 10),
      minutes: d.getUTCHours() * 60 + d.getUTCMinutes(),
    };
  }
}

function parseHHMM(hhmm: string): number {
  const [hh, mm] = hhmm.split(":").map((n) => parseInt(n, 10));
  return (hh || 0) * 60 + (mm || 0);
}

function UpcomingRow({
  batch,
  now,
  tz,
}: {
  batch: UpcomingBatch & { phase: "soon" | "due" | "skipped"; target: number };
  now: number;
  tz: string;
}) {
  const { minutes: nowMin } = nowInTz(now, tz);
  const diffMin = batch.target - nowMin;

  // Human label per phase
  let label: string;
  let toneClass: string;
  if (batch.phase === "soon") {
    if (diffMin >= 60) {
      label = `in ${Math.floor(diffMin / 60)}h ${diffMin % 60}m`;
    } else if (diffMin >= 1) {
      label = `in ${diffMin}m`;
    } else {
      // < 1 min — fire imminent. Show seconds for the last 60s.
      const { minutes: nowMinExact } = nowInTz(now, tz);
      const secsToTarget = Math.max(0, (batch.target - nowMinExact) * 60 - new Date(now).getSeconds());
      label = secsToTarget > 0 ? `in ${secsToTarget}s` : "any moment";
    }
    toneClass = "text-muted-foreground";
  } else if (batch.phase === "due") {
    label = `due now (will fire next tick)`;
    toneClass = "text-emerald-600 font-medium";
  } else {
    label = `skipped — past catch-up window, will retry tomorrow`;
    toneClass = "text-amber-600";
  }

  const flowsLabel = batch.flows.map((f) => f === "photorealistic" ? "F1" : f === "animated" ? "F2" : "F3").join("+");

  return (
    <div className="flex items-center justify-between gap-2 py-1.5 px-2 rounded-md hover:bg-muted/40">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-xs">
          <span className="font-mono font-semibold tabular-nums">{batch.run_time}</span>
          <span className="font-medium truncate">{batch.label}</span>
          {batch.campaign_name && (
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
              · {batch.campaign_name}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground mt-0.5">
          <span>{flowsLabel}</span>
          <span>·</span>
          <span>{batch.account_handles.length} acct{batch.account_handles.length !== 1 ? "s" : ""}</span>
        </div>
      </div>
      <span className={`text-[11px] tabular-nums ${toneClass}`}>{label}</span>
    </div>
  );
}
