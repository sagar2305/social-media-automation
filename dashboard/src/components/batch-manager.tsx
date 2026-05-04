"use client";

import { useState } from "react";
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
} from "lucide-react";
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
  enabled: boolean;
  last_run_date: string | null;
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
  enabled: boolean;
}

export function BatchManager({
  initial,
  accounts,
  isAdmin,
}: {
  initial: CycleBatch[];
  accounts: ManagedAccount[];
  isAdmin: boolean;
}) {
  const router = useRouter();
  const [batches, setBatches] = useState<CycleBatch[]>(initial);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState<BatchDraft>(BLANK_DRAFT);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startCreate() {
    setDraft({ ...BLANK_DRAFT });
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
    if (!draft.label.trim()) { setError("Label is required."); return; }
    if (draft.flows.length === 0) { setError("Pick at least one flow."); return; }
    if (draft.posts_per_account < 1) { setError("Posts per account must be ≥ 1."); return; }

    setBusy(true);
    const supabase = createBrowserSupabase();

    if (creating) {
      const order_index = batches.length > 0 ? Math.max(...batches.map((b) => b.order_index)) + 1 : 1;
      const { data, error: err } = await supabase
        .from("cycle_batches")
        .insert({ ...draft, order_index })
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
            <Button onClick={startCreate}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add Batch
            </Button>
          )}
        </div>

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
            accounts={accounts}
            onSave={handleSave}
            onCancel={cancelForm}
            busy={busy}
            isCreate={creating}
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
              {isAdmin && <TableHead className="text-right">Actions</TableHead>}
            </TableRow>
          </TableHeader>
          <TableBody>
            {batches.length === 0 && (
              <TableRow>
                <TableCell colSpan={isAdmin ? 9 : 8} className="text-center text-muted-foreground py-6">
                  No batches configured. Click <strong>Add Batch</strong> to schedule the first one.
                </TableCell>
              </TableRow>
            )}
            {batches.map((b, i) => (
              <TableRow key={b.id} className={b.enabled ? "" : "opacity-60"}>
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
                {isAdmin && (
                  <TableCell className="text-right">
                    <div className="inline-flex gap-1">
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
                    </div>
                  </TableCell>
                )}
              </TableRow>
            ))}
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
  accounts,
  onSave,
  onCancel,
  busy,
  isCreate,
}: {
  draft: BatchDraft;
  setDraft: (d: BatchDraft) => void;
  accounts: ManagedAccount[];
  onSave: () => void;
  onCancel: () => void;
  busy: boolean;
  isCreate: boolean;
}) {
  function toggleFlow(flow: string) {
    const set = new Set(draft.flows);
    if (set.has(flow)) set.delete(flow); else set.add(flow);
    setDraft({ ...draft, flows: Array.from(set) });
  }
  function toggleAccount(handle: string) {
    const set = new Set(draft.account_handles);
    if (set.has(handle)) set.delete(handle); else set.add(handle);
    setDraft({ ...draft, account_handles: Array.from(set) });
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

        <div>
          <FieldLabel label="Flows" hint="Pick one or more. Multiple flows in one batch run sequentially." />
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

        <div>
          <FieldLabel label="Accounts" hint="Empty = all active accounts. Pick a subset to limit this batch." />
          <div className="flex flex-wrap gap-2 mt-1.5">
            {accounts.length === 0 && (
              <p className="text-xs text-muted-foreground">No active accounts. Add some in the Accounts page.</p>
            )}
            {accounts.map((a) => {
              const active = draft.account_handles.includes(a.handle);
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
          <p className="text-[11px] text-muted-foreground mt-2">
            {draft.account_handles.length === 0
              ? "→ Will post to ALL active accounts."
              : `→ Will post to ${draft.account_handles.length} selected account${draft.account_handles.length !== 1 ? "s" : ""}.`}
          </p>
        </div>

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
          <Button onClick={onSave} disabled={busy}>
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
