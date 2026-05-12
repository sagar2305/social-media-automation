"use client";

/**
 * "Run cycle" button for the campaign hero.
 *
 * Single source for triggering a cycle on demand now that the engine is
 * multi-campaign — every job has to be tagged with a campaign_id and
 * the account picker has to be scoped to that campaign's accounts, so
 * the old global "Run a cycle on demand" card on /runs was removed.
 *
 * Compared to a generic trigger, this:
 *   - inserts cycle_jobs.campaign_id pre-set so the cycle is tagged
 *   - filters the account picker to this campaign's accounts only
 *   - defaults the flow set to whatever the campaign has flows_enabled
 *
 * The Mac mini's jobs.poller (every 60s) picks up the row, claims it,
 * and spawns `npm run cycle --campaign=<slug>` with the chosen args.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import {
  Play, X, Loader2, Check, Clock3, AlertCircle,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

interface Props {
  campaignId: string;
  campaignSlug: string;
  campaignName: string;
  enabledFlows: { photorealistic: boolean; animated: boolean; emoji_overlay: boolean };
  campaignAccounts: { handle: string; name: string }[];
}

interface ActiveJob {
  id: string;
  status: "pending" | "claimed" | "completed" | "failed" | "cancelled";
  label: string | null;
  flows: string[];
  account_handles: string[];
  cycle_run_id: string | null;
}

const FLOW_LABEL: Record<string, string> = {
  photorealistic: "Photorealistic",
  animated: "Animated",
  emoji_overlay: "Emoji Overlay",
};

export function RunCycleButton({
  campaignId,
  campaignSlug,
  campaignName,
  enabledFlows,
  campaignAccounts,
}: Props) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<ActiveJob | null>(null);

  // Resolve the campaign's single chosen flow. enabledFlows is jsonb
  // with up to one true; default to photorealistic if the campaign
  // somehow ended up with none enabled (legacy data, no UI path to
  // produce that today).
  const campaignFlow: string =
    (Object.entries(enabledFlows) as Array<[string, boolean]>).find(([, on]) => on)?.[0] ??
    "photorealistic";
  // Locked to the campaign's flow. State is kept as a single-element
  // array because the downstream cycle_jobs.flows column is still a
  // text[] — same shape, just always size 1 now.
  const [flows] = useState<string[]>([campaignFlow]);
  const [path, setPath] = useState<"direct" | "draft">("draft");
  // Account selection was removed: cycles now always run against every
  // active account on the campaign. account_handles is sent empty to
  // cycle_jobs and the engine expands that to the campaign's accounts.
  const [postsPerAccount, setPostsPerAccount] = useState(1);
  const [skipResearch, setSkipResearch] = useState(false);
  // Hours of GAP between consecutive posts when posts_per_account > 1.
  // 0 = no spacing, every post publishes as soon as the cycle finishes
  //     (the legacy default).
  // 1 = first post at completion, second +1h, third +2h, …
  // Maps to cycle_jobs.post_interval_minutes (= intervalHours * 60),
  // forwarded to the cycle as --post-interval=<minutes>, applied per-
  // account in postAllDrafts. cycle_jobs.schedule_offset_hours stays
  // 0 here — that's a separate "shift everything later by N hours"
  // knob we may surface again if mam asks for it.
  const [intervalHours, setIntervalHours] = useState(0);
  const [customIntervalInput, setCustomIntervalInput] = useState("");

  // Poll for an active job for THIS campaign so the button shows progress.
  // Self-healing: if a job is in 'claimed' but its linked cycle_runs row
  // is already in a terminal state (cancelled / failed / completed), the
  // Mac process probably crashed before writing back. Treat the job as
  // cancelled so the UI doesn't stay stuck on "Running…" forever.
  useEffect(() => {
    let cancelled = false;
    const sb = createBrowserSupabase();
    async function tick() {
      const { data: job } = await sb
        .from("cycle_jobs")
        .select("id, status, label, flows, account_handles, cycle_run_id")
        .eq("campaign_id", campaignId)
        .in("status", ["pending", "claimed"])
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle<ActiveJob>();
      if (cancelled) return;

      if (job?.status === "claimed" && job.cycle_run_id) {
        const { data: run } = await sb
          .from("cycle_runs")
          .select("status")
          .eq("id", job.cycle_run_id)
          .maybeSingle<{ status: string }>();
        if (cancelled) return;
        if (run && (run.status === "cancelled" || run.status === "failed" || run.status === "completed")) {
          // Reconcile the stale row in the background — best-effort, no UI
          // wait. Even if the update fails, the local state below already
          // hides the pill so the user sees the right thing immediately.
          await sb.from("cycle_jobs")
            .update({
              status: run.status === "completed" ? "completed" : "cancelled",
              completed_at: new Date().toISOString(),
              error_text: run.status === "completed" ? null : `Auto-reconciled: cycle_run was ${run.status}`,
            })
            .eq("id", job.id)
            .eq("status", "claimed");
          setActiveJob(null);
          return;
        }
      }

      setActiveJob(job ?? null);
    }
    tick();
    const interval = setInterval(tick, 5_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [campaignId]);

  async function handleSubmit() {
    setError(null);
    setBusy(true);
    const sb = createBrowserSupabase();
    const { data: { user } } = await sb.auth.getUser();
    const label = `${campaignName} — manual${flows.length === 1 ? ` ${flows[0]}` : ` ${flows.length} flows`}`;
    const { data, error: err } = await sb
      .from("cycle_jobs")
      .insert({
        label,
        flows,
        path,
        account_handles: [],                     // empty = all active on this campaign (engine expands at run time)
        posts_per_account: postsPerAccount,
        skip_research: skipResearch,
        schedule_offset_hours: 0,                            // uniform delay not exposed here
        post_interval_minutes: intervalHours * 60,           // per-post stagger
        requested_by: user?.id ?? null,
        campaign_id: campaignId,
      })
      .select("id, status, label, flows, account_handles, cycle_run_id")
      .single<ActiveJob>();
    setBusy(false);
    if (err || !data) { setError(err?.message ?? "Insert failed"); return; }
    setActiveJob(data);
    setOpen(false);
    router.refresh();
  }

  // Active-job pill (shown alongside the other hero buttons)
  if (activeJob) {
    return (
      <a
        href={activeJob.cycle_run_id ? `/runs?run=${activeJob.cycle_run_id}` : "/runs"}
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs font-medium text-emerald-900 hover:bg-emerald-100 transition-colors"
        title={activeJob.label ?? "Cycle running"}
      >
        {activeJob.status === "pending" ? (
          <Clock3 className="h-3.5 w-3.5" />
        ) : (
          <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
        )}
        {activeJob.status === "pending" ? "Queued…" : "Running…"}
      </a>
    );
  }

  // Hard guard — engine refuses to run a cycle for a campaign with zero
  // accounts (account_loader.ts no-fallback + main.ts process.exit(2)),
  // so render the button as disabled with a tooltip pointing the
  // operator at the Accounts tab. Mirrors the BatchManager block.
  const noAccounts = campaignAccounts.length === 0;

  return (
    <>
      {noAccounts ? (
        <a
          href={`/campaigns/${campaignSlug}/accounts`}
          title="Attach an account to this campaign first"
          className="inline-flex items-center gap-1.5 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs font-medium text-destructive hover:bg-destructive/10 transition-colors"
        >
          <AlertCircle className="h-3.5 w-3.5" />
          Add an account first
        </a>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-xs font-medium hover:bg-muted transition-colors"
        >
          <Play className="h-3.5 w-3.5" />
          Run cycle
        </button>
      )}

      {open && (
        <div
          className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setOpen(false)}
        >
          <div
            className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <header className="flex items-center justify-between px-5 py-4 border-b border-border">
              <div>
                <h2 className="text-base font-semibold">Run cycle for {campaignName}</h2>
                <p className="text-xs text-muted-foreground mt-0.5">
                  One-time run — won&apos;t repeat. Mac mini picks it up within 60 seconds.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="h-5 w-5" />
              </button>
            </header>

            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive bg-destructive/5 px-3 py-2 text-xs text-destructive">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{error}</span>
                </div>
              )}

              {/* Flow — read-only, locked to the campaign's selected flow.
                  Each campaign has exactly one flow now, picked at
                  creation; cycles always use that one. To change, edit
                  the campaign. */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Flow
                </p>
                <div className="flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                  <span className="text-sm font-medium">{FLOW_LABEL[campaignFlow] ?? campaignFlow}</span>
                  <span className="ml-auto text-[10px] uppercase tracking-widest text-muted-foreground">
                    campaign default
                  </span>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  To change the flow used by this campaign, edit the campaign.
                </p>
              </div>

              {/* Path */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Posting path
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={() => setPath("draft")}
                    className={`px-3 py-2 rounded-md border text-xs font-medium ${
                      path === "draft"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-input hover:bg-muted/60"
                    }`}
                  >
                    UPLOAD (TikTok drafts)
                  </button>
                  <button
                    type="button"
                    onClick={() => setPath("direct")}
                    className={`px-3 py-2 rounded-md border text-xs font-medium ${
                      path === "direct"
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-input hover:bg-muted/60"
                    }`}
                  >
                    DIRECT_POST (publish)
                  </button>
                </div>
              </div>

              {/* Accounts: no picker. The cycle runs against every active
                  account on this campaign — that's resolved by the engine
                  at run time from accounts.campaign_id, so there's nothing
                  to pick here. Manage which accounts are active on the
                  Accounts tab of this campaign. */}
              <p className="text-[11px] text-muted-foreground">
                Runs on{" "}
                <span className="font-semibold text-foreground">
                  all {campaignAccounts.length} active account{campaignAccounts.length === 1 ? "" : "s"}
                </span>{" "}
                on this campaign. Manage accounts on the Accounts tab.
              </p>

              {/* Per-post stagger. With posts_per_account=3 and
                  intervalHours=2: post 1 goes live as soon as the cycle
                  finishes generating (~5–10 min), post 2 two hours
                  after that, post 3 four hours after that. Applies
                  PER-ACCOUNT — each account gets its own staggered
                  schedule in parallel. */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Time between posts
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {[
                    { hours: 0,  label: "Same time" },
                    { hours: 1,  label: "+1 hr" },
                    { hours: 2,  label: "+2 hr" },
                    { hours: 4,  label: "+4 hr" },
                    { hours: 6,  label: "+6 hr" },
                    { hours: 12, label: "+12 hr" },
                    { hours: 24, label: "+24 hr" },
                  ].map((p) => (
                    <button
                      key={p.hours}
                      type="button"
                      onClick={() => { setIntervalHours(p.hours); setCustomIntervalInput(""); }}
                      className={`px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                        intervalHours === p.hours && customIntervalInput === ""
                          ? "border-primary bg-primary/10 text-primary"
                          : "border-input hover:bg-muted/60"
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                  <div className="flex items-center gap-1.5">
                    <Input
                      type="number"
                      min={0}
                      max={168}
                      step={1}
                      value={customIntervalInput}
                      onChange={(e) => {
                        setCustomIntervalInput(e.target.value);
                        const n = parseInt(e.target.value, 10);
                        if (Number.isFinite(n) && n >= 0) setIntervalHours(n);
                      }}
                      placeholder="Custom"
                      className="h-8 w-24 text-xs"
                    />
                    <span className="text-[11px] text-muted-foreground">hr</span>
                  </div>
                </div>
                {/* Live preview — concrete clock times so the operator
                    can verify what the picker actually means. */}
                <RunSchedulePreview
                  intervalHours={intervalHours}
                  postsPerAccount={postsPerAccount}
                />
              </div>

              {/* Misc */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium" htmlFor="ppa">Posts/account</label>
                  <Input
                    id="ppa"
                    type="number"
                    min={1}
                    max={10}
                    value={postsPerAccount}
                    onChange={(e) => setPostsPerAccount(Number(e.target.value) || 1)}
                  />
                </div>
                <label className="flex items-center gap-2 text-xs font-medium pt-5 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={skipResearch}
                    onChange={(e) => setSkipResearch(e.target.checked)}
                    className="h-4 w-4 rounded border-input"
                  />
                  Skip research phase
                </label>
              </div>
            </div>

            <footer className="flex items-center justify-end gap-2 px-5 py-3 border-t border-border">
              <Button variant="outline" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                onClick={handleSubmit}
                disabled={busy}
              >
                {busy ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-1.5" />
                )}
                {intervalHours === 0
                  ? "Queue cycle (runs now, once)"
                  : postsPerAccount > 1
                  ? `Queue cycle (${postsPerAccount} posts, +${intervalHours}hr apart)`
                  : `Queue cycle (runs now, once)`}
              </Button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Live "when will each post go live" preview for the Run Cycle modal.
 * Mirrors the SchedulePreview inside BatchManager, scoped to a single
 * cycle invocation. Uses now() as the base because the cycle starts
 * within ~60s of clicking Queue and generation takes ~5–10 min — close
 * enough for a sanity-check; precise timing comes from Blotato anyway.
 */
function RunSchedulePreview({
  intervalHours,
  postsPerAccount,
}: {
  intervalHours: number;
  postsPerAccount: number;
}) {
  if (postsPerAccount <= 1) {
    return (
      <p className="text-[11px] text-muted-foreground">
        Single post — publishes as soon as the cycle finishes generating (~5–10 min).
      </p>
    );
  }
  if (intervalHours === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        All {postsPerAccount} posts publish together as soon as the cycle finishes.
      </p>
    );
  }
  const base = new Date();
  const slots = Array.from({ length: postsPerAccount }, (_, i) => {
    const t = new Date(base.getTime() + i * intervalHours * 3600 * 1000);
    return t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  });
  return (
    <div className="rounded-md border border-border/40 bg-muted/30 px-3 py-2">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1">
        Per-account schedule
      </p>
      <p className="text-xs font-mono break-words">
        {slots.map((t, i) => (
          <span key={i}>
            {i > 0 && <span className="text-muted-foreground"> → </span>}
            <span className="font-semibold">{t}</span>
          </span>
        ))}
      </p>
      <p className="text-[10px] text-muted-foreground mt-1">
        Each account picked above runs this schedule independently in parallel.
      </p>
    </div>
  );
}
