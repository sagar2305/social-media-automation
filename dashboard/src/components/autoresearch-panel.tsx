"use client";

import { useEffect, useState } from "react";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Card, CardContent } from "@/components/ui/card";
import {
  FlaskConical,
  Sparkles,
  CheckCircle2,
  XCircle,
  CircleDot,
  ChevronRight,
  RefreshCw,
} from "lucide-react";

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
  outcome: "pending" | "winner_a" | "winner_b" | "inconclusive" | "cancelled" | null;
  notes: string | null;
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

  const active = runs.find((r) => r.outcome === "pending") ?? null;
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
            Daily AI-driven experiment design. Gemini reads the experiment history every morning and
            picks the next test. Cycles run automatically — no Claude Code, no human in the loop.
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
        <KPI label="Pending experiments" value={summary.pending.toString()} accent="emerald" />
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
                  Active experiment — testing {active.variable} on @{active.account}
                </p>
                <p className="text-sm text-emerald-800 mt-1">
                  <strong>{active.variant_a}</strong> vs <strong>{active.variant_b}</strong>
                </p>
                {active.hypothesis && (
                  <p className="text-xs text-emerald-700 mt-2 italic">
                    “{active.hypothesis}”
                  </p>
                )}
                <p className="text-[11px] text-emerald-700 mt-2">
                  Decided by {active.source} · {formatRelative(active.occurred_at)}
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

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
    if (r.outcome === "pending" || !r.outcome) pending++;
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
