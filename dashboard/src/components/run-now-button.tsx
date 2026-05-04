"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Play, X, Clock3, CheckCircle2, AlertCircle } from "lucide-react";
import type { ManagedAccount } from "@/components/account-manager";

const FLOW_OPTIONS = [
  { value: "photorealistic", label: "Flow 1 — Photorealistic" },
  { value: "animated",       label: "Flow 2 — Animated" },
  { value: "emoji_overlay",  label: "Flow 3 — Emoji Overlay" },
];

interface CycleJob {
  id: string;
  status: "pending" | "claimed" | "completed" | "failed" | "cancelled";
  label: string | null;
  flows: string[];
  account_handles: string[];
  path: "direct" | "draft";
  posts_per_account: number;
  requested_at: string;
  claimed_at: string | null;
  completed_at: string | null;
  cycle_run_id: string | null;
  error_text: string | null;
}

export function RunNowButton({
  accounts,
  isAdmin,
}: {
  accounts: ManagedAccount[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeJob, setActiveJob] = useState<CycleJob | null>(null);

  // Form state
  const [label, setLabel] = useState("");
  const [flows, setFlows] = useState<string[]>(["photorealistic"]);
  const [path, setPath] = useState<"direct" | "draft">("draft");
  const [accountHandles, setAccountHandles] = useState<string[]>([]);
  const [postsPerAccount, setPostsPerAccount] = useState(1);
  const [skipResearch, setSkipResearch] = useState(false);

  // Poll for the most recent active job (pending/claimed) so the button can
  // show "Running…" state across page reloads.
  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserSupabase();

    async function tick() {
      const { data } = await supabase
        .from("cycle_jobs")
        .select("*")
        .in("status", ["pending", "claimed"])
        .order("requested_at", { ascending: false })
        .limit(1)
        .maybeSingle<CycleJob>();
      if (cancelled) return;
      setActiveJob(data ?? null);
    }
    tick();
    const interval = setInterval(tick, 5000);
    return () => { cancelled = true; clearInterval(interval); };
  }, []);

  function toggleFlow(f: string) {
    const set = new Set(flows);
    if (set.has(f)) set.delete(f); else set.add(f);
    setFlows(Array.from(set));
  }
  function toggleAccount(h: string) {
    const set = new Set(accountHandles);
    if (set.has(h)) set.delete(h); else set.add(h);
    setAccountHandles(Array.from(set));
  }

  async function handleSubmit() {
    setError(null);
    if (flows.length === 0) { setError("Pick at least one flow."); return; }
    setBusy(true);
    const supabase = createBrowserSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    const { data, error: err } = await supabase
      .from("cycle_jobs")
      .insert({
        label: label.trim() || null,
        flows,
        path,
        account_handles: accountHandles,
        posts_per_account: postsPerAccount,
        skip_research: skipResearch,
        requested_by: user?.id ?? null,
      })
      .select()
      .single<CycleJob>();
    setBusy(false);
    if (err || !data) { setError(err?.message ?? "Insert failed"); return; }
    setActiveJob(data);
    setOpen(false);
    router.refresh();
  }

  async function handleCancel() {
    if (!activeJob) return;
    if (!confirm("Cancel this pending job?\n\n(Already-claimed jobs can't be cancelled — the cycle is in progress.)")) return;
    setBusy(true);
    const supabase = createBrowserSupabase();
    await supabase
      .from("cycle_jobs")
      .update({ status: "cancelled", completed_at: new Date().toISOString() })
      .eq("id", activeJob.id)
      .eq("status", "pending"); // only cancel if still pending
    setBusy(false);
    setActiveJob(null);
    router.refresh();
  }

  if (!isAdmin) {
    return (
      <Card className="border-dashed border-border/50">
        <CardContent className="py-3 text-xs text-muted-foreground">
          Admin role required to trigger manual runs.
        </CardContent>
      </Card>
    );
  }

  // Show active job status banner if one is in flight
  if (activeJob) {
    return (
      <Card className="border-emerald-200 bg-emerald-50">
        <CardContent className="py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            {activeJob.status === "pending" ? (
              <Clock3 className="h-5 w-5 text-emerald-600 shrink-0" />
            ) : (
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse shrink-0" />
            )}
            <div className="min-w-0">
              <p className="text-sm font-semibold text-emerald-900">
                {activeJob.status === "pending"
                  ? "Queued — waiting for Mac to pick up (≤60s)"
                  : "Running on the Mac…"}
              </p>
              <p className="text-xs text-emerald-700 truncate">
                {activeJob.label || activeJob.flows.join(" + ")} ·{" "}
                {activeJob.account_handles.length === 0
                  ? "all active accounts"
                  : `${activeJob.account_handles.length} accounts`}
                {" · "}
                {activeJob.posts_per_account > 1 && `${activeJob.posts_per_account} posts/acc · `}
                path={activeJob.path}
              </p>
            </div>
          </div>
          <div className="flex gap-2 shrink-0">
            {activeJob.cycle_run_id && (
              <a
                href={`/runs?run=${activeJob.cycle_run_id}`}
                className="text-xs font-medium text-emerald-800 underline hover:no-underline"
              >
                View live →
              </a>
            )}
            {activeJob.status === "pending" && (
              <Button variant="outline" onClick={handleCancel} disabled={busy}>
                Cancel
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!open) {
    return (
      <Card className="shadow-sm border-0 ring-0">
        <CardContent className="py-4 flex items-center justify-between gap-4">
          <div>
            <p className="text-sm font-semibold">Run a cycle on demand</p>
            <p className="text-xs text-muted-foreground">
              Trigger any flow to any subset of accounts right now. Mac picks it up within 60s.
            </p>
          </div>
          <Button onClick={() => setOpen(true)}>
            <Play className="h-4 w-4 mr-1.5" />
            Run Cycle Now
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="shadow-sm border-0 ring-0">
      <CardContent className="pt-5 space-y-5">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold">Trigger a manual cycle</p>
          <button onClick={() => setOpen(false)} disabled={busy}>
            <X className="h-4 w-4 text-muted-foreground" />
          </button>
        </div>

        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive flex items-center gap-2">
            <AlertCircle className="h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <Field label="Label (optional)" hint="Shows on the runs page so you remember why you triggered it">
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. demo for mam" />
        </Field>

        <div>
          <FieldLabel label="Flows" hint="Pick one or more — runs sequentially within the cycle" />
          <div className="flex flex-wrap gap-2 mt-1.5">
            {FLOW_OPTIONS.map((opt) => {
              const active = flows.includes(opt.value);
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => toggleFlow(opt.value)}
                  className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border/50 hover:bg-muted"
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        </div>

        <div>
          <FieldLabel label="Accounts" hint="Empty = all active accounts" />
          <div className="flex flex-wrap gap-2 mt-1.5">
            {accounts.length === 0 && (
              <p className="text-xs text-muted-foreground">No active accounts. Add some in the Accounts page.</p>
            )}
            {accounts.map((a) => {
              const active = accountHandles.includes(a.handle);
              return (
                <button
                  key={a.handle}
                  type="button"
                  onClick={() => toggleAccount(a.handle)}
                  className={`px-3 py-1.5 rounded-lg border text-sm transition-colors ${
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-background border-border/50 hover:bg-muted"
                  }`}
                >
                  @{a.handle}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Posts per account">
            <Input
              type="number"
              min={1}
              max={20}
              value={postsPerAccount}
              onChange={(e) => setPostsPerAccount(parseInt(e.target.value) || 1)}
            />
          </Field>
          <Field label="Posting path">
            <select
              value={path}
              onChange={(e) => setPath(e.target.value as "direct" | "draft")}
              className="flex h-9 w-full rounded-lg border border-border/50 bg-background px-3 py-1 text-sm"
            >
              <option value="draft">UPLOAD — TikTok drafts</option>
              <option value="direct">DIRECT_POST — publish now</option>
            </select>
          </Field>
          <Field label="Skip research">
            <button
              type="button"
              onClick={() => setSkipResearch(!skipResearch)}
              className={`h-9 w-full rounded-lg border text-sm transition-colors ${
                skipResearch
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-background border-border/50"
              }`}
            >
              {skipResearch ? "ON (skip Virlo)" : "OFF (pull trends)"}
            </button>
          </Field>
        </div>

        <div className="flex justify-end gap-2 pt-2 border-t border-border/50">
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={busy}>
            <Play className="h-4 w-4 mr-1.5" />
            {busy ? "Submitting…" : "Submit job"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <FieldLabel label={label} hint={hint} />
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

function FieldLabel({ label, hint }: { label: string; hint?: string }) {
  return (
    <div>
      <label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground block">
        {label}
      </label>
      {hint && <p className="text-[11px] text-muted-foreground mt-0.5">{hint}</p>}
    </div>
  );
}
