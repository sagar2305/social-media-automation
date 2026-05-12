"use client";

import { Fragment, useState } from "react";
import { useRouter } from "next/navigation";
import { createBrowserSupabase } from "@/lib/supabase-browser";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Plus,
  Trash2,
  Power,
  X,
  Pencil,
  ArrowUp,
  ArrowDown,
  Layers,
  Info,
  AlertTriangle,
} from "lucide-react";
import Link from "next/link";
import type { ManagedAccount } from "@/components/account-manager";

export interface CycleBatch {
  id: string;
  label: string;
  order_index: number;
  run_time: string;
  flows: string[];
  path: "direct" | "draft";
  account_handles: string[];
  posts_per_account: number;
  skip_research: boolean;
  schedule_offset_hours: number;
  /**
   * Gap (in minutes) between consecutive posts within this batch run.
   * 0 = all posts go at the same scheduled time (legacy behaviour);
   * 120 = post N goes 2 hours after post N-1; etc. Applied
   * post-by-post in main.ts → postAllDrafts before each Blotato submit.
   */
  post_interval_minutes: number;
  enabled: boolean;
  last_run_date: string | null;
  /** Phase 17 multi-campaign — every batch belongs to exactly one
   *  campaign. Older rows from the pre-multi-campaign era can be null;
   *  the engine refuses to fire those, and the global /settings/schedule
   *  surface flags them as orphans for cleanup. */
  campaign_id: string | null;
}

const FLOW_OPTIONS = [
  { value: "photorealistic", label: "Flow 1 — Photorealistic" },
  { value: "animated",       label: "Flow 2 — Animated" },
  { value: "emoji_overlay",  label: "Flow 3 — Emoji Overlay" },
];

const PATH_OPTIONS = [
  { value: "direct" as const, label: "DIRECT_POST (publish now)" },
  { value: "draft" as const,  label: "UPLOAD (save as TikTok draft)" },
];

const BLANK_DRAFT: BatchDraft = {
  label: "",
  run_time: "19:00",
  flows: ["photorealistic"],
  path: "draft",
  account_handles: [],
  posts_per_account: 1,
  skip_research: false,
  schedule_offset_hours: 0,
  post_interval_minutes: 0,
  enabled: true,
};

interface BatchDraft {
  label: string;
  run_time: string;
  flows: string[];
  path: "direct" | "draft";
  account_handles: string[];
  posts_per_account: number;
  skip_research: boolean;
  schedule_offset_hours: number;
  post_interval_minutes: number;
  enabled: boolean;
}

export function BatchManager({
  initial,
  accounts,
  isAdmin,
  campaignId,
  campaignSlug,
  campaignFlow,
}: {
  initial: CycleBatch[];
  accounts: ManagedAccount[];
  isAdmin: boolean;
  /**
   * When set (campaign-scoped Schedule tab), every newly created batch
   * has its campaign_id pre-populated. Existing batches are not
   * mutated. The global /settings/schedule call leaves this undefined
   * which preserves prior behavior.
   */
  campaignId?: string | null;
  /**
   * Campaign slug — used to link the operator straight to the Accounts
   * tab when batch creation is blocked because the campaign has zero
   * accounts attached. Optional so the global /settings/schedule call
   * (no campaign scope) keeps working.
   */
  campaignSlug?: string;
  /**
   * The campaign's selected flow (single-flow per campaign). Locks
   * batch flow selection — every new batch automatically uses this
   * flow, the operator can't pick something different. Undefined for
   * the legacy global /settings/schedule call (which can still touch
   * orphaned batches across campaigns).
   */
  campaignFlow?: "photorealistic" | "animated" | "emoji_overlay";
}) {
  // Hard guard: a batch can't post if the campaign has zero accounts,
  // and the engine refuses to run such a cycle (account_loader + main.ts
  // both fail loudly). Mirror that contract in the UI by blocking
  // creation entirely when no accounts exist on this campaign.
  // campaignId is set on the campaign-scoped Schedule tab; the global
  // /settings/schedule call leaves it undefined and we don't apply the
  // block there (legacy global mode allows global-scope batches).
  const accountsBlocked = campaignId != null && accounts.length === 0;
  const router = useRouter();
  const [batches, setBatches] = useState<CycleBatch[]>(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<BatchDraft>(BLANK_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [infoOpenId, setInfoOpenId] = useState<string | null>(null);

  // Seed a fresh draft. When the host page provides campaignFlow,
  // every new batch's flow array starts (and stays) locked to that
  // single campaign-default flow.
  function freshDraft(): BatchDraft {
    return campaignFlow
      ? { ...BLANK_DRAFT, flows: [campaignFlow] }
      : { ...BLANK_DRAFT };
  }

  function startCreate() {
    setDraft(freshDraft());
    setEditingId(null);
    setCreating(true);
    setError(null);
  }

  function startEdit(b: CycleBatch) {
    setDraft({
      label: b.label,
      run_time: b.run_time,
      flows: b.flows,
      path: b.path,
      account_handles: b.account_handles,
      posts_per_account: b.posts_per_account,
      skip_research: b.skip_research,
      schedule_offset_hours: b.schedule_offset_hours,
      post_interval_minutes: b.post_interval_minutes ?? 0,
      enabled: b.enabled,
    });
    setEditingId(b.id);
    setCreating(false);
    setError(null);
  }

  function cancelForm() {
    setEditingId(null);
    setCreating(false);
    setError(null);
  }

  async function handleSave() {
    setError(null);
    // Belt-and-suspenders for the disabled-button: refuse the save
    // server-side too, in case anyone manually re-enables the button
    // via devtools or hits the form via an old tab.
    if (creating && accountsBlocked) {
      setError("This campaign has no accounts attached — add an account before creating a batch.");
      return;
    }
    if (!draft.label.trim()) { setError("Label is required."); return; }
    if (draft.flows.length === 0) { setError("Pick at least one flow."); return; }
    if (draft.posts_per_account < 1) { setError("Posts per account must be ≥ 1."); return; }
    // We no longer require explicit account selection. account_handles is
    // saved empty, which the scheduler interprets as "every active account
    // on this campaign". Now that accounts are campaign-scoped (no global
    // pool), that fan-out is exactly what the operator wants by default —
    // the legacy Phase-17b guard against accidental cross-campaign blast
    // is moot.

    setBusy(true);
    const supabase = createBrowserSupabase();

    if (creating) {
      const order_index = batches.length > 0 ? Math.max(...batches.map((b) => b.order_index)) + 1 : 1;
      const insertPayload = campaignId
        ? { ...draft, order_index, campaign_id: campaignId }
        : { ...draft, order_index };
      const { data, error: err } = await supabase
        .from("cycle_batches")
        .insert(insertPayload)
        .select()
        .single<CycleBatch>();
      if (err || !data) { setBusy(false); setError(err?.message ?? "Insert failed"); return; }
      setBatches((prev) => [...prev, data].sort((a, b) => a.order_index - b.order_index));
    } else if (editingId) {
      const { data, error: err } = await supabase
        .from("cycle_batches")
        .update({ ...draft, updated_at: new Date().toISOString() })
        .eq("id", editingId)
        .select()
        .single<CycleBatch>();
      if (err || !data) { setBusy(false); setError(err?.message ?? "Update failed"); return; }
      setBatches((prev) => prev.map((b) => (b.id === editingId ? data : b)));
    }

    setBusy(false);
    cancelForm();
    router.refresh();
  }

  async function handleToggle(b: CycleBatch) {
    setBusy(true);
    const supabase = createBrowserSupabase();
    await supabase
      .from("cycle_batches")
      .update({ enabled: !b.enabled, updated_at: new Date().toISOString() })
      .eq("id", b.id);
    setBatches((prev) => prev.map((x) => (x.id === b.id ? { ...x, enabled: !b.enabled } : x)));
    setBusy(false);
    router.refresh();
  }

  async function handleDelete(b: CycleBatch) {
    if (!confirm(`Delete batch "${b.label}"?\n\nThis won't affect already-posted content.`)) return;
    setBusy(true);
    const supabase = createBrowserSupabase();
    const { error: err } = await supabase.from("cycle_batches").delete().eq("id", b.id);
    setBusy(false);
    if (err) { setError(err.message); return; }
    setBatches((prev) => prev.filter((x) => x.id !== b.id));
    router.refresh();
  }

  async function handleReorder(b: CycleBatch, dir: "up" | "down") {
    const idx = batches.findIndex((x) => x.id === b.id);
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= batches.length) return;
    const other = batches[swapIdx];
    setBusy(true);
    const supabase = createBrowserSupabase();
    await Promise.all([
      supabase.from("cycle_batches").update({ order_index: other.order_index }).eq("id", b.id),
      supabase.from("cycle_batches").update({ order_index: b.order_index }).eq("id", other.id),
    ]);
    const next = [...batches];
    next[idx] = { ...other, order_index: b.order_index };
    next[swapIdx] = { ...b, order_index: other.order_index };
    next.sort((a, b) => a.order_index - b.order_index);
    setBatches(next);
    setBusy(false);
    router.refresh();
  }

  const formOpen = creating || editingId !== null;

  return (
    <Card className="shadow-sm border-0 ring-0">
      <CardContent className="pt-6 space-y-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-lg font-semibold flex items-center gap-2">
              <Layers className="h-5 w-5 text-muted-foreground" />
              Cycle Batches
            </p>
            <p className="text-xs text-muted-foreground mt-0.5 max-w-2xl">
              Each batch is one execution of the cycle at a specific time. Configure how many posts go to which accounts, which flow to use, and whether to publish or save as draft. The scheduler tick runs each batch when its time arrives.
            </p>
          </div>
          {isAdmin && !formOpen && (
            accountsBlocked ? (
              <Button
                disabled
                title="Attach an account to this campaign first"
                className="opacity-60 cursor-not-allowed"
              >
                <Plus className="h-4 w-4 mr-1.5" />
                Add Batch
              </Button>
            ) : (
              <Button onClick={startCreate}>
                <Plus className="h-4 w-4 mr-1.5" />
                Add Batch
              </Button>
            )
          )}
        </div>

        {accountsBlocked && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/40 px-4 py-3 text-sm text-destructive flex items-start gap-3">
            <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-semibold">Cannot create a batch yet.</p>
              <p className="mt-0.5 text-destructive/90">
                This campaign has no accounts attached. A scheduled batch posts
                only to its own campaign&apos;s accounts, so creation is
                blocked until at least one account is added.
              </p>
              {campaignSlug && (
                <Link
                  href={`/campaigns/${campaignSlug}/accounts`}
                  className="inline-block mt-2 font-medium underline-offset-4 hover:underline"
                >
                  Add an account →
                </Link>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 px-3 py-2 text-sm text-destructive flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        {formOpen && isAdmin && (
          <BatchForm
            draft={draft}
            setDraft={setDraft}
            campaignAccountCount={accounts.length}
            onSave={handleSave}
            onCancel={cancelForm}
            busy={busy}
            isCreate={creating}
            campaignFlow={campaignFlow}
          />
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-16">Order</TableHead>
              <TableHead>Time</TableHead>
              <TableHead>Label</TableHead>
              <TableHead>Flows</TableHead>
              <TableHead>Accounts</TableHead>
              <TableHead className="text-right">Posts/acc</TableHead>
              <TableHead>Path</TableHead>
              <TableHead className="text-right">Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.length === 0 && (
              <TableRow>
                <TableCell colSpan={9} className="text-center text-muted-foreground py-6">
                  No batches configured. Click <strong>Add Batch</strong> to schedule the first one.
                </TableCell>
              </TableRow>
            )}
            {batches.map((b, i) => {
              const isInfoOpen = infoOpenId === b.id;
              return (
              <Fragment key={b.id}>
              <TableRow className={b.enabled ? "" : "opacity-60"}>
                <TableCell className="tabular-nums text-xs text-muted-foreground">
                  {b.order_index}
                </TableCell>
                <TableCell className="font-mono font-medium">{b.run_time}</TableCell>
                <TableCell>
                  <p className="font-medium">{b.label}</p>
                  {b.last_run_date && (
                    <p className="text-[11px] text-muted-foreground">last ran {b.last_run_date}</p>
                  )}
                </TableCell>
                <TableCell className="text-xs">
                  {b.flows.map((f) => labelForFlow(f)).join(" + ")}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {b.account_handles.length === 0
                    ? <span className="italic">all active</span>
                    : b.account_handles.map((h) => `@${h}`).join(", ")
                  }
                </TableCell>
                <TableCell className="tabular-nums text-right">{b.posts_per_account}</TableCell>
                <TableCell className="text-xs">
                  <span className={`inline-flex rounded-full px-2 py-0.5 ${
                    b.path === "direct"
                      ? "bg-emerald-100 text-emerald-800"
                      : "bg-muted text-foreground"
                  }`}>
                    {b.path === "direct" ? "PUBLISH" : "DRAFT"}
                  </span>
                  {b.schedule_offset_hours > 0 && (
                    <span className="ml-1 text-[10px] text-muted-foreground">+{b.schedule_offset_hours}h</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  {b.enabled ? (
                    <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-600">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      ON
                    </span>
                  ) : (
                    <span className="text-xs font-medium text-muted-foreground">OFF</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <div className="inline-flex gap-1">
                    <Button
                      variant="outline"
                      onClick={() => setInfoOpenId(isInfoOpen ? null : b.id)}
                      title={isInfoOpen ? "Hide details" : "What does this batch do?"}
                    >
                      <Info className={`h-3.5 w-3.5 ${isInfoOpen ? "text-primary" : ""}`} />
                    </Button>
                    {isAdmin && (
                      <>
                        <Button variant="outline" disabled={busy || i === 0} onClick={() => handleReorder(b, "up")} title="Move up">
                          <ArrowUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="outline" disabled={busy || i === batches.length - 1} onClick={() => handleReorder(b, "down")} title="Move down">
                          <ArrowDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="outline" disabled={busy} onClick={() => handleToggle(b)} title={b.enabled ? "Disable" : "Enable"}>
                          <Power className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="outline" disabled={busy} onClick={() => startEdit(b)} title="Edit">
                          <Pencil className="h-3.5 w-3.5" />
                        </Button>
                        <Button variant="outline" disabled={busy} onClick={() => handleDelete(b)} title="Delete">
                          <Trash2 className="h-3.5 w-3.5 text-destructive" />
                        </Button>
                      </>
                    )}
                  </div>
                </TableCell>
              </TableRow>

              {isInfoOpen && (
                <TableRow className="bg-muted/30 hover:bg-muted/30">
                  {/* The wrapper div uses sticky+left:0 to anchor the
                      panel to the left edge of the visible viewport
                      regardless of the table's horizontal scroll, plus
                      a calc-based max-width so the panel never grows
                      beyond the dashboard content area and pushes the
                      table even wider. Without this, the colSpan cell
                      auto-expands to fit the panel's natural width and
                      the info text overflowed/overlapped its neighbours. */}
                  <TableCell colSpan={9} className="p-0">
                    <div className="sticky left-0 w-full">
                      <div className="px-4 py-4 max-w-[min(64rem,calc(100vw-2rem))]">
                        <BatchInfoPanel batch={b} />
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

        {!isAdmin && (
          <p className="text-xs text-muted-foreground">Read-only: only admins can edit batches.</p>
        )}
      </CardContent>
    </Card>
  );
}

function BatchForm({
  draft,
  setDraft,
  campaignAccountCount,
  onSave,
  onCancel,
  busy,
  isCreate,
  campaignFlow,
}: {
  draft: BatchDraft;
  setDraft: (d: BatchDraft) => void;
  /** Number of accounts on the campaign; used only for the schedule preview's
   *  total-posts estimate. The batch itself doesn't store this — it gets
   *  resolved at fire time by the scheduler. */
  campaignAccountCount: number;
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  isCreate: boolean;
  campaignFlow?: "photorealistic" | "animated" | "emoji_overlay";
}) {
  function toggleFlow(flow: string) {
    const set = new Set(draft.flows);
    if (set.has(flow)) set.delete(flow); else set.add(flow);
    setDraft({ ...draft, flows: Array.from(set) });
  }

  return (
    <Card className="bg-muted/30 border-border/50">
      <CardContent className="pt-5 space-y-5">
        <p className="text-sm font-semibold">{isCreate ? "Add new batch" : "Edit batch"}</p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Label" hint="Display name in the batch list">
            <Input value={draft.label} onChange={(e) => setDraft({ ...draft, label: e.target.value })} placeholder="Evening — Photorealistic" />
          </Field>
          <Field label="Run time (24h)" hint="In the timezone set above">
            <Input type="time" value={draft.run_time} onChange={(e) => setDraft({ ...draft, run_time: e.target.value })} />
          </Field>
        </div>

        {/* Flow — locked to the campaign's selected flow when this
            manager is mounted in campaign scope. Falls back to the
            multi-flow picker only in the legacy global /settings/schedule
            view where there's no single campaign to defer to. */}
        {campaignFlow ? (
          <div>
            <FieldLabel
              label="Flow"
              hint="Locked to this campaign's flow. To change, edit the campaign."
            />
            <div className="mt-1.5 inline-flex items-center gap-2 rounded-md border border-border/60 bg-background px-3 py-1.5">
              <span className="text-sm font-medium">{describeFlow(campaignFlow)}</span>
              <span className="text-[10px] uppercase tracking-widest text-muted-foreground">
                campaign default
              </span>
            </div>
          </div>
        ) : (
          <div>
            <FieldLabel label="Flows" hint="No campaign scope — pick one or more for this orphaned batch." />
            <div className="flex flex-wrap gap-2 mt-1.5">
              {FLOW_OPTIONS.map((opt) => {
                const active = draft.flows.includes(opt.value);
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
        )}

        {/* Accounts: no picker. Batches inherit the campaign's accounts
            implicitly — account_handles stays empty, and the scheduler
            expands that to "every active account on this campaign" at
            fire time. Add/remove accounts from the campaign's Accounts
            tab if you want to scope which handles the batch hits. */}
        <p className="text-[11px] text-muted-foreground -mt-2">
          This batch will post to every active account on this campaign at fire time.
          Manage accounts on the Accounts tab.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Field label="Posts per account" hint="Generate N posts per account in this batch">
            <Input
              type="number"
              min={1}
              max={20}
              value={draft.posts_per_account}
              onChange={(e) => setDraft({ ...draft, posts_per_account: parseInt(e.target.value) || 1 })}
            />
          </Field>
          <Field label="Posting path" hint="DIRECT publishes immediately; DRAFT saves to TikTok drafts">
            <select
              value={draft.path}
              onChange={(e) => setDraft({ ...draft, path: e.target.value as "direct" | "draft" })}
              className="flex h-9 w-full rounded-lg border border-border/50 bg-background px-3 py-1 text-sm"
            >
              {PATH_OPTIONS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Schedule offset (hours)" hint="Publish N hours later (Blotato-side). 0 = now.">
            <Input
              type="number"
              min={0}
              max={48}
              value={draft.schedule_offset_hours}
              onChange={(e) => setDraft({ ...draft, schedule_offset_hours: parseInt(e.target.value) || 0 })}
            />
          </Field>
        </div>

        {/* Spacing between posts in this batch. Different from
            schedule_offset_hours: that shifts ALL posts uniformly,
            this staggers them. Both compose — offset 2h + interval
            1h on a 3-post batch → posts at +2h, +3h, +4h. */}
        <Field
          label="Spacing between posts"
          hint="Gap between each post within this batch. 0 = all posts go at the same time."
        >
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {[
                { mins: 0,    label: "Same time" },
                { mins: 30,   label: "+30 min" },
                { mins: 60,   label: "+1 hr" },
                { mins: 120,  label: "+2 hr" },
                { mins: 180,  label: "+3 hr" },
                { mins: 240,  label: "+4 hr" },
                { mins: 360,  label: "+6 hr" },
              ].map((p) => (
                <button
                  key={p.mins}
                  type="button"
                  onClick={() => setDraft({ ...draft, post_interval_minutes: p.mins })}
                  className={`px-3 py-1.5 rounded-md border text-xs font-medium transition-colors ${
                    draft.post_interval_minutes === p.mins
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
                  max={1440}
                  step={5}
                  value={draft.post_interval_minutes}
                  onChange={(e) =>
                    setDraft({ ...draft, post_interval_minutes: Math.max(0, parseInt(e.target.value) || 0) })
                  }
                  className="h-8 w-24 text-xs"
                />
                <span className="text-[11px] text-muted-foreground">min</span>
              </div>
            </div>
            <SchedulePreview
              runTime={draft.run_time}
              offsetHours={draft.schedule_offset_hours}
              intervalMinutes={draft.post_interval_minutes}
              postsPerAccount={draft.posts_per_account}
              accountCount={Math.max(1, campaignAccountCount)}
            />
          </div>
        </Field>

        <div className="flex items-center gap-6 border-t border-border/50 pt-4">
          <Toggle
            label="Skip research"
            description="Don't pull fresh Virlo trends in this batch"
            checked={draft.skip_research}
            onChange={(v) => setDraft({ ...draft, skip_research: v })}
          />
          <Toggle
            label="Enabled"
            description="Off = batch is paused (won't fire until re-enabled)"
            checked={draft.enabled}
            onChange={(v) => setDraft({ ...draft, enabled: v })}
          />
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button variant="outline" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button
            onClick={onSave}
            disabled={
              busy ||
              !draft.label.trim() ||
              draft.flows.length === 0
            }
            title={
              draft.flows.length === 0
                ? "Pick at least one flow first"
                : !draft.label.trim()
                ? "Label is required"
                : undefined
            }
          >
            {busy ? "Saving…" : isCreate ? "Add Batch" : "Save Changes"}
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

function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => onChange(!checked)}
        className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full transition-colors ${
          checked ? "bg-primary" : "bg-muted-foreground/30"
        }`}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow-sm transition-transform mt-0.5 ${
            checked ? "translate-x-4 ml-0.5" : "translate-x-0.5"
          }`}
        />
      </button>
      <div>
        <p className="text-sm font-medium">{label}</p>
        <p className="text-[11px] text-muted-foreground">{description}</p>
      </div>
    </div>
  );
}

function labelForFlow(flow: string): string {
  if (flow === "photorealistic") return "Flow 1";
  if (flow === "animated") return "Flow 2";
  if (flow === "emoji_overlay") return "Flow 3";
  return flow;
}

function describeFlow(flow: string): string {
  if (flow === "photorealistic") return "cinematic photo-style slides (Flow 1)";
  if (flow === "animated") return "animated style — Pixar 3D, Anime, etc. (Flow 2)";
  if (flow === "emoji_overlay") return "illustrated character + emoji reactions (Flow 3)";
  return flow;
}

function describePath(path: "direct" | "draft", offsetHours: number): string {
  if (path === "draft") {
    return "save as a TikTok draft (you must open the TikTok app and tap Publish to make it live)";
  }
  if (offsetHours === 0) {
    return "publish immediately to TikTok";
  }
  return `submit now and let Blotato publish it ${offsetHours}h later`;
}

function describeAccountSet(handles: string[]): string {
  if (handles.length === 0) return "every account currently marked active in /accounts";
  if (handles.length === 1) return `only @${handles[0]}`;
  return handles.map((h) => `@${h}`).join(", ");
}

function describeNextRun(runTime: string, lastRunDate: string | null): string {
  const today = new Date().toISOString().slice(0, 10);
  if (lastRunDate === today) {
    return `Already ran today (${lastRunDate}). Next fire: tomorrow ${runTime}.`;
  }
  return `Will fire today at ${runTime} if it hasn't already.`;
}

function BatchInfoPanel({ batch: b }: { batch: CycleBatch }) {
  const flowsList = b.flows.map((f) => describeFlow(f)).join(" + ");
  const totalPosts = Math.max(b.account_handles.length, 1) * b.posts_per_account * b.flows.length;
  const accountSummary = describeAccountSet(b.account_handles);
  const pathSummary = describePath(b.path, b.schedule_offset_hours);
  const nextRun = describeNextRun(b.run_time, b.last_run_date);

  // Each section is rendered as a labelled row in a single column. The
  // earlier two-column md:grid-cols-2 layout collided when text in one
  // column overflowed into the next — table-cell auto-sizing made the
  // gap unreliable. A single vertical column wraps cleanly at any
  // viewport width and reads top-to-bottom.
  return (
    <div className="text-sm w-full min-w-0 break-words space-y-4">
      <Section label="What this batch does">
        At <strong className="font-mono">{b.run_time}</strong>{" "}
        (in the timezone set above), runs <strong>{flowsList}</strong> for{" "}
        <strong>{accountSummary}</strong>, generating{" "}
        <strong>{b.posts_per_account} post{b.posts_per_account === 1 ? "" : "s"} per account per flow</strong>
        {b.account_handles.length === 0 ? "" : ` (roughly ${totalPosts} post${totalPosts === 1 ? "" : "s"} total per fire)`}
        . Posts will <strong>{pathSummary}</strong>.
      </Section>

      <Section label="Schedule" muted>{nextRun}</Section>

      <Section label="Status" muted>
        {b.enabled
          ? "Active — the scheduler will pick this up at the next 5-min tick."
          : "Paused — won't fire until you toggle it back on."}
      </Section>

      <Section label="Research" muted>
        {b.skip_research
          ? "Skips fresh Virlo trend pull (saves credits). Reuses whatever the previous batch already pulled today."
          : "Pulls fresh Virlo trends before generating content."}
      </Section>

      <Section label="Order" muted>
        Position #{b.order_index} in the batch list. Use ↑/↓ to change. Lower numbers fire first when multiple batches are due simultaneously.
      </Section>

      <div className="border-t border-border/40 pt-3">
        <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
          Equivalent CLI command
        </p>
        <code className="block bg-background border border-border/40 rounded p-2 text-[11px] font-mono break-all whitespace-pre-wrap">
          {buildCliPreview(b)}
        </code>
        <p className="text-[11px] text-muted-foreground mt-1">
          This is exactly what the scheduler runs on the Mac when this batch fires.
        </p>
      </div>

      {b.last_run_date && (
        <p className="text-[11px] text-muted-foreground border-t border-border/40 pt-3">
          Last run: <span className="font-mono">{b.last_run_date}</span>. The Mac records this date so the same batch won&apos;t double-fire on the same day.
        </p>
      )}
    </div>
  );
}

/**
 * One labelled paragraph in the BatchInfoPanel. Stacks label-above-text
 * with consistent spacing so all sections line up vertically. `muted`
 * dims the body text for the secondary metadata sections (Schedule,
 * Status, Research, Order); the primary "What this batch does" line
 * uses default foreground colour.
 */
function Section({
  label,
  children,
  muted,
}: {
  label: string;
  children: React.ReactNode;
  muted?: boolean;
}) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground mb-1">
        {label}
      </p>
      <p className={`leading-relaxed break-words ${muted ? "text-muted-foreground" : ""}`}>
        {children}
      </p>
    </div>
  );
}

/**
 * Live "when will each post go live" preview. Computes the same per-
 * post schedule the runner will produce, so the operator can verify
 * the spacing before saving. Pure formatting — no side effects.
 *
 *   posts_per_account × account_count × accounts shown … but the user
 *   is staggering per-cycle-run, so we display PER-ACCOUNT timing
 *   (each account gets the same staggered schedule independently).
 */
function SchedulePreview({
  runTime,
  offsetHours,
  intervalMinutes,
  postsPerAccount,
  accountCount,
}: {
  runTime: string;          // "HH:MM"
  offsetHours: number;
  intervalMinutes: number;
  postsPerAccount: number;
  accountCount: number;
}) {
  if (intervalMinutes === 0 && offsetHours === 0) {
    return (
      <p className="text-[11px] text-muted-foreground">
        All {postsPerAccount} post{postsPerAccount === 1 ? "" : "s"} per account go live at {runTime}.
      </p>
    );
  }

  // Build a base date at today + runTime, then add offset + interval
  // per post. Display-only — no time zone math, the runner handles
  // that with the schedule.timezone column.
  const [hh, mm] = runTime.split(":").map((s) => parseInt(s, 10) || 0);
  const base = new Date();
  base.setHours(hh, mm, 0, 0);
  base.setTime(base.getTime() + offsetHours * 3600 * 1000);

  const slots = Array.from({ length: Math.max(1, postsPerAccount) }, (_, i) => {
    const t = new Date(base.getTime() + i * intervalMinutes * 60 * 1000);
    return t.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
  });

  return (
    <div className="rounded-md border border-border/40 bg-muted/30 px-3 py-2 text-xs">
      <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mb-1">
        Per-account schedule
      </p>
      <p className="font-mono break-words">
        {slots.map((t, i) => (
          <span key={i}>
            {i > 0 && <span className="text-muted-foreground"> → </span>}
            <span className="font-semibold">{t}</span>
          </span>
        ))}
      </p>
      {accountCount > 1 && (
        <p className="text-[10px] text-muted-foreground mt-1">
          Each of {accountCount} account{accountCount === 1 ? "" : "s"} gets this same staggered schedule independently.
        </p>
      )}
    </div>
  );
}

function buildCliPreview(b: CycleBatch): string {
  const flowsArg = b.flows.map(f => f === "photorealistic" ? "1" : f === "animated" ? "2" : "3").join(",");
  const parts = [
    "npm run cycle --",
    `--flow=${flowsArg}`,
    `--path=${b.path}`,
  ];
  if (b.account_handles.length > 0) parts.push(`--account=${b.account_handles.join(",")}`);
  if (b.posts_per_account > 1) parts.push(`--posts-per-flow=${b.posts_per_account}`);
  if (b.skip_research) parts.push("--skip-research");
  if (b.schedule_offset_hours > 0) parts.push(`--delay=${b.schedule_offset_hours * 60}`);
  if (b.post_interval_minutes > 0) parts.push(`--post-interval=${b.post_interval_minutes}`);
  return parts.join(" ");
}
