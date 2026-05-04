"use client";

import { Fragment, useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Card, CardContent } from "@/components/ui/card";
import {
  FlaskConical,
  Sparkles,
  CheckCircle2,
  XCircle,
  CircleDot,
  ChevronRight,
  ChevronDown,
  RefreshCw,
  TrendingUp,
  Hash,
  Brain,
} from "lucide-react";

export interface TopHook { rank: number; hook: string; avg_views: number; avg_save_rate: number; posts: number; last_used: string | null }
export interface TopHashtag { tag: string; tier: string; line: string }
export interface TrendingTopic { topic: string }

export interface AutoresearchRun {
  id: string;
  occurred_at: string;
  variable: string | null;
  variant_a: string | null;
  variant_b: string | null;
  account: string | null;
  flow: string | null;
  hypothesis: string | null;
  source: "gemini" | "fallback" | "manual";
  cycle_job_a: string | null;
  cycle_job_b: string | null;
  outcome: "pending" | "recorded" | "winner_a" | "winner_b" | "inconclusive" | "cancelled" | null;
  notes: string | null;
  // Snapshot fields (populated by autoresearch.ts; older rows may have null)
  posts_measured: number | null;
  top_hooks: TopHook[] | null;
  top_hashtags: TopHashtag[] | null;
  trending_now: TrendingTopic[] | null;
  winners_declared: number | null;
  losers_dropped: number | null;
  phase_durations_ms: Record<string, number> | null;
}

const POLL_MS = 15_000;

export function AutoresearchPanel({
  initial,
  isAdmin,
}: {
  initial: AutoresearchRun[];
  isAdmin: boolean;
}) {
  const [runs, setRuns] = useState<AutoresearchRun[]>(initial);
  const [selectedId, setSelectedId] = useState<string | null>(initial[0]?.id ?? null);

  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserSupabase();
    async function tick() {
      const { data } = await supabase
        .from("autoresearch_runs")
        .select("*")
        .order("occurred_at", { ascending: false })
        .limit(30);
      if (cancelled) return;
      setRuns((data as AutoresearchRun[] | null) ?? []);
    }
    const interval = setInterval(tick, POLL_MS);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  const active = runs.find((r) => r.outcome === "recorded" || r.outcome === "pending") ?? null;
  const selected = runs.find((r) => r.id === selectedId) ?? runs[0] ?? null;

  const summary = summarize(runs);

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight flex items-center gap-3">
            <FlaskConical className="h-7 w-7 text-violet-500" />
            Autoresearch
          </h1>
          <p className="text-muted-foreground mt-1 max-w-2xl">
            Daily AI brain. Every morning at 08:30 it measures yesterday&apos;s posts, declares winners,
            refreshes Virlo trends and the hashtag bank, and asks Gemini what to test next. The decision
            updates the playbook used by tonight&apos;s scheduled batches — autoresearch never posts on its own.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <RefreshCw className="h-3.5 w-3.5" />
          {runs.length} decisions · refreshes every {POLL_MS / 1000}s
        </div>
      </div>

      {/* Summary KPIs */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <KPI label="Total decisions" value={summary.total.toString()} />
        <KPI label="Active (today)" value={summary.pending.toString()} accent="emerald" />
        <KPI label="Resolved (winner)" value={summary.winners.toString()} accent="primary" />
        <KPI label="Inconclusive / cancelled" value={summary.dead.toString()} />
      </div>

      {/* Active experiment banner */}
      {active && (
        <Card className="border-emerald-200 bg-emerald-50">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <Sparkles className="h-5 w-5 text-emerald-600 shrink-0 mt-0.5" />
              <div className="min-w-0">
                <p className="text-sm font-semibold text-emerald-900">
                  Today&apos;s recommendation — focus on {active.variable} for @{active.account}
                </p>
                <p className="text-sm text-emerald-800 mt-1">
                  Lean toward <strong>{active.variant_a}</strong> vs <strong>{active.variant_b}</strong>
                </p>
                {active.hypothesis && (
                  <p className="text-xs text-emerald-700 mt-2 italic">
                    “{active.hypothesis}”
                  </p>
                )}
                <p className="text-[11px] text-emerald-700 mt-2">
                  Recorded by {active.source} · {formatRelative(active.occurred_at)} · scheduled batches will reflect this when they fire
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Brain log — per-day learnings, click to expand */}
      <BrainLog runs={runs} />

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Decisions list */}
        <div className="lg:col-span-1 space-y-3">
          {runs.length === 0 && (
            <Card className="border-dashed border border-border/50">
              <CardContent className="py-8 text-center text-muted-foreground text-sm">
                No autoresearch decisions yet. The daily 08:30 launchd job will create the first one.
              </CardContent>
            </Card>
          )}
          {runs.map((r) => (
            <button
              key={r.id}
              onClick={() => setSelectedId(r.id)}
              className={`w-full text-left rounded-xl ${
                selected?.id === r.id ? "ring-2 ring-primary" : ""
              }`}
            >
              <Card className="border-0 ring-0 shadow-sm hover:bg-muted/30">
                <CardContent className="pt-4 pb-4">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <OutcomeIcon outcome={r.outcome} />
                        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                          {r.outcome ?? "pending"}
                        </span>
                        {r.source !== "gemini" && (
                          <span className="text-[10px] rounded-full bg-amber-100 text-amber-800 px-1.5 py-0.5 uppercase">
                            {r.source}
                          </span>
                        )}
                      </div>
                      <p className="text-sm font-medium mt-1.5 truncate">
                        {r.variable} · @{r.account}
                      </p>
                      <p className="text-xs text-muted-foreground truncate">
                        {r.variant_a} vs {r.variant_b}
                      </p>
                      <p className="text-[11px] text-muted-foreground mt-1">
                        {formatRelative(r.occurred_at)}
                      </p>
                    </div>
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  </div>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>

        {/* Detail */}
        <div className="lg:col-span-2">
          {selected ? (
            <Card className="border-0 ring-0 shadow-sm">
              <CardContent className="pt-6 space-y-5">
                <div>
                  <p className="text-[11px] uppercase tracking-widest text-muted-foreground">
                    Variable
                  </p>
                  <p className="text-2xl font-semibold mt-0.5">{selected.variable}</p>
                  <p className="text-sm text-muted-foreground">
                    on @{selected.account} · flow: {selected.flow}
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <Variant label="Variant A" value={selected.variant_a} jobId={selected.cycle_job_a} />
                  <Variant label="Variant B" value={selected.variant_b} jobId={selected.cycle_job_b} />
                </div>

                {selected.hypothesis && (
                  <div className="rounded-lg bg-muted/40 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-widest text-muted-foreground mb-1">
                      Hypothesis
                    </p>
                    <p className="text-sm italic">“{selected.hypothesis}”</p>
                  </div>
                )}

                {selected.notes && (
                  <div className="rounded-lg bg-amber-50 border border-amber-200 px-4 py-3">
                    <p className="text-[11px] uppercase tracking-widest text-amber-800 mb-1">
                      Notes
                    </p>
                    <p className="text-sm">{selected.notes}</p>
                  </div>
                )}

                <div className="text-[11px] text-muted-foreground space-y-0.5">
                  <p>Decided by: <span className="font-mono">{selected.source}</span></p>
                  <p>At: <span className="font-mono">{new Date(selected.occurred_at).toLocaleString()}</span></p>
                  <p>Outcome: <span className="font-mono">{selected.outcome ?? "pending"}</span></p>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card className="border-dashed border border-border/50">
              <CardContent className="py-16 text-center text-muted-foreground text-sm">
                Pick a decision on the left.
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      {!isAdmin && (
        <p className="text-xs text-muted-foreground">Read-only view. Admins can override or skip experiments (coming soon).</p>
      )}
    </div>
  );
}

function summarize(runs: AutoresearchRun[]) {
  let pending = 0, winners = 0, dead = 0;
  for (const r of runs) {
    if (r.outcome === "pending" || r.outcome === "recorded" || !r.outcome) pending++;
    else if (r.outcome === "winner_a" || r.outcome === "winner_b") winners++;
    else dead++;
  }
  return { total: runs.length, pending, winners, dead };
}

function KPI({ label, value, accent }: { label: string; value: string; accent?: "emerald" | "primary" }) {
  const tone =
    accent === "emerald" ? "bg-emerald-50 text-emerald-900 border-emerald-200"
    : accent === "primary" ? "bg-primary/5 text-foreground border-primary/20"
    : "bg-muted/40 border-border/50";
  return (
    <Card className={`border ${tone}`}>
      <CardContent className="py-3">
        <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</p>
        <p className="text-2xl font-bold tabular-nums mt-1">{value}</p>
      </CardContent>
    </Card>
  );
}

function Variant({ label, value, jobId }: { label: string; value: string | null; jobId: string | null }) {
  return (
    <div className="rounded-lg border border-border/50 px-4 py-3">
      <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-base font-semibold mt-0.5">{value ?? "—"}</p>
      {jobId && (
        <p className="text-[10px] font-mono text-muted-foreground truncate mt-1">
          job {jobId.slice(0, 8)}
        </p>
      )}
    </div>
  );
}

function OutcomeIcon({ outcome }: { outcome: AutoresearchRun["outcome"] }) {
  if (outcome === "pending" || !outcome) return <CircleDot className="h-3.5 w-3.5 text-emerald-500" />;
  if (outcome === "winner_a" || outcome === "winner_b") return <CheckCircle2 className="h-3.5 w-3.5 text-primary" />;
  return <XCircle className="h-3.5 w-3.5 text-muted-foreground" />;
}

function formatRelative(iso: string): string {
  try {
    const ms = Date.now() - new Date(iso).getTime();
    if (ms < 60_000) return "just now";
    if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
    if (ms < 86_400_000) return `${Math.floor(ms / 3_600_000)}h ago`;
    return new Date(iso).toLocaleDateString();
  } catch {
    return iso;
  }
}

function fmtDay(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric" });
  } catch { return iso; }
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch { return iso; }
}

// ─── Brain log ───────────────────────────────────────────────
// Each row = one day's autoresearch run. Click to expand and see what
// the brain measured, what won, what trends were found, what hashtags
// were leading, and what experiment Gemini designed for that day.
function BrainLog({ runs }: { runs: AutoresearchRun[] }) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (runs.length === 0) return null;

  const toggle = (id: string) => setExpandedId((cur) => (cur === id ? null : id));

  return (
    <Card className="shadow-sm border-0 ring-0">
      <CardContent className="pt-6">
        <div className="flex items-center justify-between mb-1">
          <p className="text-lg font-semibold flex items-center gap-2">
            <Brain className="h-5 w-5 text-violet-500" />
            Daily Brain Log
          </p>
          <span className="text-[11px] text-muted-foreground">
            {runs.length} day{runs.length === 1 ? "" : "s"} of learnings
          </span>
        </div>
        <p className="text-xs text-muted-foreground mb-4">
          Each line is one day&apos;s research run. Click to see what the brain measured, what hooks won,
          what trends were rising, and what experiment it designed for that day.
        </p>

        <div className="divide-y divide-border/40">
          {runs.map((r) => {
            const isOpen = expandedId === r.id;
            return (
              <Fragment key={r.id}>
                <button
                  onClick={() => toggle(r.id)}
                  className="w-full text-left flex items-center gap-3 py-3 hover:bg-muted/30 -mx-2 px-2 rounded-lg transition-colors"
                  aria-expanded={isOpen}
                >
                  {isOpen ? (
                    <ChevronDown className="h-4 w-4 text-muted-foreground shrink-0" />
                  ) : (
                    <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                  )}
                  <div className="min-w-0 flex-1 grid grid-cols-1 sm:grid-cols-[160px_1fr] gap-1 sm:gap-4 items-center">
                    <div className="text-sm font-mono text-muted-foreground tabular-nums">
                      {fmtDay(r.occurred_at)}
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm truncate">
                        {r.posts_measured !== null && r.posts_measured > 0 && (
                          <span className="text-muted-foreground">measured <strong className="text-foreground">{r.posts_measured}</strong> posts · </span>
                        )}
                        {r.top_hooks && r.top_hooks.length > 0 && (
                          <span className="text-muted-foreground">leader: <strong className="text-foreground">{r.top_hooks[0].hook}</strong> · </span>
                        )}
                        next test:{" "}
                        <strong>{r.variable ?? "—"}</strong>
                        {r.account && <span className="text-muted-foreground"> on @{r.account}</span>}
                      </p>
                    </div>
                  </div>
                  <span className="text-[11px] text-muted-foreground shrink-0">{fmtTime(r.occurred_at)}</span>
                </button>

                {isOpen && (
                  <div className="bg-muted/20 -mx-2 px-4 py-5 rounded-lg my-1">
                    <BrainLogDetail run={r} />
                  </div>
                )}
              </Fragment>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

function BrainLogDetail({ run }: { run: AutoresearchRun }) {
  return (
    <div className="space-y-5 max-w-4xl">
      {/* Headline numbers */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
        <DetailKpi label="Posts measured" value={run.posts_measured?.toLocaleString() ?? "—"} />
        <DetailKpi label="Winners declared" value={run.winners_declared?.toString() ?? "—"} />
        <DetailKpi label="Losers dropped" value={run.losers_dropped?.toString() ?? "—"} />
        <DetailKpi
          label="Decided by"
          value={run.source}
          tone={run.source === "fallback" ? "amber" : "default"}
        />
      </div>

      {/* What's working */}
      {run.top_hooks && run.top_hooks.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" />
            Top hooks (what&apos;s working today)
          </p>
          <div className="bg-background border border-border/40 rounded-lg overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/40">
                <tr>
                  <th className="text-left font-medium px-3 py-2">#</th>
                  <th className="text-left font-medium px-3 py-2">Hook style</th>
                  <th className="text-right font-medium px-3 py-2">Avg views</th>
                  <th className="text-right font-medium px-3 py-2">Save rate</th>
                  <th className="text-right font-medium px-3 py-2">Posts</th>
                </tr>
              </thead>
              <tbody>
                {run.top_hooks.map((h) => (
                  <tr key={h.hook} className="border-t border-border/30">
                    <td className="px-3 py-1.5 tabular-nums">{h.rank}</td>
                    <td className="px-3 py-1.5 font-medium">{h.hook}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{Math.round(h.avg_views).toLocaleString()}</td>
                    <td className="px-3 py-1.5 text-right tabular-nums">{h.avg_save_rate.toFixed(2)}%</td>
                    <td className="px-3 py-1.5 text-right tabular-nums text-muted-foreground">{h.posts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Trending */}
      {run.trending_now && run.trending_now.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5" />
            Trends pulled today
          </p>
          <div className="flex flex-wrap gap-1.5">
            {run.trending_now.slice(0, 12).map((t, i) => (
              <span
                key={i}
                className="text-xs bg-background border border-border/40 rounded-full px-3 py-1 break-words"
              >
                {t.topic}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Hashtags */}
      {run.top_hashtags && run.top_hashtags.length > 0 && (
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
            <Hash className="h-3.5 w-3.5" />
            Top hashtags by tier
          </p>
          <div className="flex flex-wrap gap-1.5">
            {run.top_hashtags.slice(0, 20).map((h, i) => (
              <code
                key={i}
                title={`${h.tier}${h.line ? ` · ${h.line}` : ""}`}
                className="text-[11px] font-mono bg-background border border-border/40 rounded px-1.5 py-0.5"
              >
                {h.tag}
              </code>
            ))}
          </div>
        </div>
      )}

      {/* Decision */}
      <div className="bg-background border border-border/40 rounded-lg p-4">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
          Experiment designed for today
        </p>
        <p className="text-sm">
          Test <strong>{run.variable ?? "—"}</strong>: <strong>{run.variant_a}</strong> vs{" "}
          <strong>{run.variant_b}</strong>
          {run.account && <span className="text-muted-foreground"> on @{run.account}</span>}
        </p>
        {run.hypothesis && (
          <p className="text-sm italic text-muted-foreground mt-2">“{run.hypothesis}”</p>
        )}
      </div>

      {/* Phase timing */}
      {run.phase_durations_ms && Object.keys(run.phase_durations_ms).length > 0 && (
        <div className="text-[11px] text-muted-foreground border-t border-border/30 pt-3">
          Phase durations:{" "}
          {Object.entries(run.phase_durations_ms).map(([phase, ms], i, arr) => (
            <span key={phase}>
              <span className="font-mono">{phase}</span> {(ms / 1000).toFixed(1)}s
              {i < arr.length - 1 && " · "}
            </span>
          ))}
        </div>
      )}

      {run.notes && (
        <div className="text-[11px] text-muted-foreground border-t border-border/30 pt-3">
          <span className="uppercase tracking-widest text-[10px]">Notes:</span> {run.notes}
        </div>
      )}
    </div>
  );
}

function DetailKpi({ label, value, tone }: { label: string; value: string; tone?: "default" | "amber" }) {
  const cls = tone === "amber" ? "bg-amber-50 border-amber-200" : "bg-background border-border/40";
  return (
    <div className={`rounded-lg border ${cls} px-3 py-2`}>
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className="text-sm font-semibold mt-0.5 tabular-nums">{value}</p>
    </div>
  );
}
