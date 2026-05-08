"use client";

/**
 * "Run cycle" button for the campaign hero.
 *
 * The /runs page already has a full RunNowButton card with every flow +
 * account toggle, but the campaign hero needs a compact one that:
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

const FLOW_OPTIONS: Array<{ value: keyof Props["enabledFlows"]; label: string }> = [
  { value: "photorealistic", label: "Flow 1 — Photorealistic" },
  { value: "animated",       label: "Flow 2 — Animated" },
  { value: "emoji_overlay",  label: "Flow 3 — Emoji Overlay" },
];

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

  // Form state — defaults derived from the campaign config.
  const defaultFlows = (Object.entries(enabledFlows) as Array<[keyof Props["enabledFlows"], boolean]>)
    .filter(([, enabled]) => enabled)
    .map(([k]) => k as string);
  const [flows, setFlows] = useState<string[]>(defaultFlows.length > 0 ? defaultFlows : ["photorealistic"]);
  const [path, setPath] = useState<"direct" | "draft">("draft");
  const [accountHandles, setAccountHandles] = useState<string[]>([]);
  const [postsPerAccount, setPostsPerAccount] = useState(1);
  const [skipResearch, setSkipResearch] = useState(false);

  // Poll for an active job for THIS campaign so the button shows progress.
  useEffect(() => {
    let cancelled = false;
    const sb = createBrowserSupabase();
    async function tick() {
      const { data } = await sb
        .from("cycle_jobs")
        .select("id, status, label, flows, account_handles, cycle_run_id")
        .eq("campaign_id", campaignId)
        .in("status", ["pending", "claimed"])
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle<ActiveJob>();
      if (cancelled) return;
      setActiveJob(data ?? null);
    }
    tick();
    const interval = setInterval(tick, 5_000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [campaignId]);

  function toggleFlow(f: string) {
    setFlows((prev) => prev.includes(f) ? prev.filter((x) => x !== f) : [...prev, f]);
  }
  function toggleAccount(h: string) {
    setAccountHandles((prev) => prev.includes(h) ? prev.filter((x) => x !== h) : [...prev, h]);
  }

  async function handleSubmit() {
    setError(null);
    if (flows.length === 0) { setError("Pick at least one flow."); return; }
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
        account_handles: accountHandles,         // empty = all on this campaign
        posts_per_account: postsPerAccount,
        skip_research: skipResearch,
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

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        <Play className="h-3.5 w-3.5" />
        Run cycle
      </button>

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
                  Mac mini picks it up within 60 seconds.
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

              {/* Flows */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Flows
                </p>
                <div className="space-y-1">
                  {FLOW_OPTIONS.map((f) => {
                    const isCampaignEnabled = enabledFlows[f.value];
                    return (
                      <label
                        key={f.value}
                        className={`flex items-center gap-2 px-2.5 py-2 rounded-md cursor-pointer ${
                          flows.includes(f.value)
                            ? "bg-primary/10"
                            : "hover:bg-muted/60"
                        } ${!isCampaignEnabled ? "opacity-60" : ""}`}
                      >
                        <input
                          type="checkbox"
                          checked={flows.includes(f.value)}
                          onChange={() => toggleFlow(f.value)}
                          className="h-4 w-4 rounded border-input"
                        />
                        <span className="text-sm">{f.label}</span>
                        {!isCampaignEnabled && (
                          <span className="ml-auto text-[10px] text-muted-foreground">
                            disabled in campaign config
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
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

              {/* Accounts */}
              <div className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  Accounts
                  <span className="ml-2 text-[10px] text-muted-foreground normal-case font-normal tracking-normal">
                    leave empty to use every active account on this campaign
                  </span>
                </p>
                {campaignAccounts.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">
                    No accounts on this campaign yet.
                  </p>
                ) : (
                  <div className="grid grid-cols-2 gap-1">
                    {campaignAccounts.map((a) => (
                      <label
                        key={a.handle}
                        className={`flex items-center gap-2 px-2.5 py-1.5 rounded-md cursor-pointer ${
                          accountHandles.includes(a.handle)
                            ? "bg-primary/10"
                            : "hover:bg-muted/60"
                        }`}
                      >
                        <input
                          type="checkbox"
                          checked={accountHandles.includes(a.handle)}
                          onChange={() => toggleAccount(a.handle)}
                          className="h-4 w-4 rounded border-input"
                        />
                        <span className="text-xs">@{a.handle}</span>
                      </label>
                    ))}
                  </div>
                )}
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
              <Button onClick={handleSubmit} disabled={busy}>
                {busy ? (
                  <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                ) : (
                  <Check className="h-4 w-4 mr-1.5" />
                )}
                Queue cycle
              </Button>
            </footer>
          </div>
        </div>
      )}
    </>
  );
}
