"use client";

/**
 * Account manager for /campaigns/[slug]/accounts.
 *
 * Renders the on-campaign accounts table with inline edit (target,
 * active toggle, remove) and the "+ Add account" modal that handles
 * three modes: existing-unassigned, create-new, move-from-another.
 *
 * Data comes from the server component (initial render); mutations
 * call server actions and trigger router.refresh() to re-fetch.
 */

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import {
  Plus, Trash2, X, Loader2, AlertTriangle, ExternalLink, Power, Eye,
} from "lucide-react";
import {
  assignAccountToCampaign,
  createAccountForCampaign,
  removeAccountFromCampaign,
  setAccountActive,
  setAccountTarget,
} from "./actions";

// ─── Types from the server page ─────────────────────────────────────

export interface ManagedRow {
  id: string;
  name: string;
  handle: string;
  active: boolean;
  notes: string | null;
  blotato_id: string;       // = accounts.id (also serves as Blotato id)
  target_posts_per_week: number | null;
  effective_target: number; // resolved per-account override OR campaign default
  posts: number;
  views: number;
  saves: number;
  avg_save_rate: number;
  last_posted: string | null;
}

export interface UnassignedAccount {
  id: string;
  name: string;
  handle: string;
}

export interface OtherCampaignAccount {
  id: string;
  name: string;
  handle: string;
  campaign_name: string;
}

interface Props {
  slug: string;
  campaignName: string;
  campaignDefaultTarget: number;
  rows: ManagedRow[];
  unassigned: UnassignedAccount[];
  otherCampaignAccounts: OtherCampaignAccount[];
  /**
   * How many paused accounts are currently hidden by the page's active-only
   * filter. The page owns the filter (?inactive=1); we just need the count
   * so the header and empty state can mention them. 0 means either the
   * campaign has no paused accounts OR the user already flipped the toggle.
   */
  pausedHidden: number;
}

export function AccountManager({
  slug,
  campaignName,
  campaignDefaultTarget,
  rows,
  unassigned,
  otherCampaignAccounts,
  pausedHidden,
}: Props) {
  const router = useRouter();
  const [showAdd, setShowAdd] = useState(false);
  const [, startTransition] = useTransition();
  const [busyRow, setBusyRow] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function refresh() {
    startTransition(() => router.refresh());
  }

  async function onRemove(accountId: string, handle: string) {
    if (!confirm(`Remove @${handle} from this campaign?\n\nIts existing posts stay attached to the campaign they were posted under. The account becomes unassigned and can be added to another campaign.`)) return;
    setBusyRow(accountId);
    setError(null);
    const result = await removeAccountFromCampaign({ slug, accountId });
    setBusyRow(null);
    if (!result.ok) setError(result.error);
    else refresh();
  }

  async function onToggleActive(accountId: string, active: boolean) {
    setBusyRow(accountId);
    setError(null);
    const result = await setAccountActive({ slug, accountId, active });
    setBusyRow(null);
    if (!result.ok) setError(result.error);
    else refresh();
  }

  async function onTargetChange(accountId: string, raw: string) {
    setBusyRow(accountId);
    setError(null);
    const target = raw.trim() === "" ? null : Number(raw);
    if (target !== null && Number.isNaN(target)) {
      setError("Target must be a number");
      setBusyRow(null);
      return;
    }
    const result = await setAccountTarget({ slug, accountId, target });
    setBusyRow(null);
    if (!result.ok) setError(result.error);
    else refresh();
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">
            {rows.length} active account{rows.length === 1 ? "" : "s"}
            {pausedHidden > 0 && (
              <> · {pausedHidden} paused (hidden)</>
            )}{" "}
            · campaign default: {campaignDefaultTarget}/week
          </p>
        </div>
        <Button type="button" onClick={() => setShowAdd(true)}>
          <Plus className="h-4 w-4 mr-1.5" />
          Add account
        </Button>
      </div>

      {error && (
        <Card className="border-destructive bg-destructive/5">
          <CardContent className="py-3 flex items-center gap-2 justify-between">
            <span className="text-sm text-destructive">{error}</span>
            <button
              type="button"
              onClick={() => setError(null)}
              className="text-destructive/70 hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </button>
          </CardContent>
        </Card>
      )}

      {/* Table */}
      {rows.length === 0 ? (
        // Two empty states: (a) genuinely no accounts on this campaign,
        // (b) all accounts on this campaign are paused so the active-only
        // filter hides them. Without (b), the user sees "No accounts
        // assigned yet" on a campaign that does have an account — just a
        // paused one — and assumes their data is missing.
        pausedHidden > 0 ? (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center">
              <p className="text-base font-medium mb-1">
                No active accounts — {pausedHidden} paused
              </p>
              <p className="text-sm text-muted-foreground mb-6">
                This campaign has {pausedHidden} account{pausedHidden === 1 ? "" : "s"} attached
                but {pausedHidden === 1 ? "it is" : "they are"} currently paused.
                Show paused to view or reactivate {pausedHidden === 1 ? "it" : "them"},
                or add a new active account.
              </p>
              <div className="flex items-center justify-center gap-2">
                <Link
                  href={`/campaigns/${slug}/accounts?inactive=1`}
                  className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-4 py-2 text-sm font-medium hover:bg-muted transition-colors"
                >
                  <Eye className="h-4 w-4" />
                  Show paused
                </Link>
                <Button type="button" onClick={() => setShowAdd(true)}>
                  <Plus className="h-4 w-4 mr-1.5" />
                  Add account
                </Button>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card className="border-dashed">
            <CardContent className="py-16 text-center">
              <p className="text-base font-medium mb-1">No accounts assigned yet</p>
              <p className="text-sm text-muted-foreground mb-6">
                Add an account to start posting for this campaign.
              </p>
              <Button type="button" onClick={() => setShowAdd(true)}>
                <Plus className="h-4 w-4 mr-1.5" />
                Add account
              </Button>
            </CardContent>
          </Card>
        )
      ) : (
        <Card>
          <CardContent className="p-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Handle</TableHead>
                  <TableHead>Blotato ID</TableHead>
                  <TableHead className="w-[120px]">Target /wk</TableHead>
                  <TableHead className="w-[90px]">Active</TableHead>
                  <TableHead>Last posted</TableHead>
                  <TableHead className="text-right">Posts</TableHead>
                  <TableHead className="text-right">Views</TableHead>
                  <TableHead className="text-right">Save %</TableHead>
                  <TableHead className="w-[70px]"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const isBusy = busyRow === row.id;
                  return (
                    <TableRow key={row.id}>
                      <TableCell>
                        <div className="font-medium">@{row.handle}</div>
                        <div className="text-xs text-muted-foreground">{row.name}</div>
                      </TableCell>
                      <TableCell className="text-xs font-mono text-muted-foreground">
                        {row.blotato_id.slice(0, 16)}
                        {row.blotato_id.length > 16 ? "…" : ""}
                      </TableCell>
                      <TableCell>
                        <TargetInput
                          value={row.target_posts_per_week}
                          fallback={campaignDefaultTarget}
                          onCommit={(v) => onTargetChange(row.id, v)}
                          disabled={isBusy}
                        />
                      </TableCell>
                      <TableCell>
                        <button
                          type="button"
                          onClick={() => onToggleActive(row.id, !row.active)}
                          disabled={isBusy}
                          className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors ${
                            row.active
                              ? "bg-[#16a34a]/10 text-[#16a34a] hover:bg-[#16a34a]/20"
                              : "bg-muted text-muted-foreground hover:bg-muted/80"
                          }`}
                        >
                          <Power className="h-3 w-3" />
                          {row.active ? "Active" : "Paused"}
                        </button>
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">
                        {row.last_posted ?? "—"}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.posts}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.views.toLocaleString()}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {row.avg_save_rate.toFixed(2)}%
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-1 justify-end">
                          <a
                            href={`https://www.tiktok.com/@${row.handle}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-muted-foreground hover:text-primary p-1"
                            title="Open on TikTok"
                          >
                            <ExternalLink className="h-3.5 w-3.5" />
                          </a>
                          <button
                            type="button"
                            onClick={() => onRemove(row.id, row.handle)}
                            disabled={isBusy}
                            className="text-muted-foreground hover:text-destructive p-1"
                            title="Remove from campaign"
                          >
                            {isBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <Trash2 className="h-3.5 w-3.5" />
                            )}
                          </button>
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {showAdd && (
        <AddAccountModal
          slug={slug}
          campaignName={campaignName}
          campaignDefaultTarget={campaignDefaultTarget}
          unassigned={unassigned}
          otherCampaigns={otherCampaignAccounts}
          onClose={() => setShowAdd(false)}
          onAdded={() => {
            setShowAdd(false);
            refresh();
          }}
          onError={(msg) => setError(msg)}
        />
      )}
    </div>
  );
}

function TargetInput({
  value,
  fallback,
  onCommit,
  disabled,
}: {
  value: number | null;
  fallback: number;
  onCommit: (v: string) => void;
  disabled: boolean;
}) {
  const [local, setLocal] = useState(value === null ? "" : String(value));
  const [focused, setFocused] = useState(false);
  // Keep local in sync if prop changes from outside (e.g., revalidate)
  useEffect(() => {
    setLocal(value === null ? "" : String(value));
  }, [value]);
  return (
    <Input
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        if (local !== (value === null ? "" : String(value))) onCommit(local);
      }}
      placeholder={!focused && value === null ? `${fallback} (default)` : ""}
      disabled={disabled}
      className="h-8 w-20 text-xs"
    />
  );
}

// ─── Add Account modal ──────────────────────────────────────────────

function AddAccountModal({
  slug,
  campaignName,
  campaignDefaultTarget,
  unassigned,
  otherCampaigns,
  onClose,
  onAdded,
  onError,
}: {
  slug: string;
  campaignName: string;
  campaignDefaultTarget: number;
  unassigned: UnassignedAccount[];
  otherCampaigns: OtherCampaignAccount[];
  onClose: () => void;
  onAdded: () => void;
  onError: (msg: string) => void;
}) {
  const [tab, setTab] = useState<"existing" | "new" | "move">("existing");
  const [submitting, setSubmitting] = useState(false);

  // Lock body scroll + Escape close
  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 bg-background/60 backdrop-blur-sm flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-background border border-border rounded-xl shadow-2xl w-full max-w-xl max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold">Add account to {campaignName}</h2>
          <button
            type="button"
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        {/* Tabs */}
        <div className="px-5 pt-4">
          <div className="inline-flex items-center rounded-lg bg-muted p-0.5">
            {([
              { key: "existing", label: `Existing (${unassigned.length})` },
              { key: "new", label: "Create new" },
              { key: "move", label: `Move (${otherCampaigns.length})` },
            ] as const).map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  tab === t.key
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === "existing" && (
            <ExistingTab
              unassigned={unassigned}
              submitting={submitting}
              onPick={async (id) => {
                setSubmitting(true);
                const r = await assignAccountToCampaign({ slug, accountId: id });
                setSubmitting(false);
                if (!r.ok) onError(r.error);
                else onAdded();
              }}
            />
          )}
          {tab === "new" && (
            <NewTab
              defaultTarget={campaignDefaultTarget}
              submitting={submitting}
              onSubmit={async (input) => {
                setSubmitting(true);
                const r = await createAccountForCampaign({ slug, ...input });
                setSubmitting(false);
                if (!r.ok) onError(r.error);
                else onAdded();
              }}
            />
          )}
          {tab === "move" && (
            <MoveTab
              other={otherCampaigns}
              submitting={submitting}
              onMove={async (id, fromCampaign) => {
                if (!confirm(
                  `Move this account from ${fromCampaign} to ${campaignName}?\n\n` +
                  `The account will be removed from ${fromCampaign} but its existing posts there are NOT moved — they stay tagged with ${fromCampaign}.`,
                )) return;
                setSubmitting(true);
                const r = await assignAccountToCampaign({ slug, accountId: id });
                setSubmitting(false);
                if (!r.ok) onError(r.error);
                else onAdded();
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

function ExistingTab({
  unassigned,
  submitting,
  onPick,
}: {
  unassigned: UnassignedAccount[];
  submitting: boolean;
  onPick: (id: string) => void;
}) {
  if (unassigned.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-md">
        No unassigned accounts. Use <strong>Create new</strong> or{" "}
        <strong>Move</strong> from another campaign instead.
      </p>
    );
  }
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground mb-3">
        Pick an account that isn&apos;t on any campaign yet.
      </p>
      {unassigned.map((a) => (
        <button
          key={a.id}
          type="button"
          disabled={submitting}
          onClick={() => onPick(a.id)}
          className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-md hover:bg-muted/60 transition-colors text-left disabled:opacity-60"
        >
          <div className="min-w-0">
            <div className="text-sm font-medium">@{a.handle}</div>
            <div className="text-xs text-muted-foreground">{a.name}</div>
          </div>
          <Plus className="h-4 w-4 text-muted-foreground" />
        </button>
      ))}
    </div>
  );
}

function NewTab({
  defaultTarget,
  submitting,
  onSubmit,
}: {
  defaultTarget: number;
  submitting: boolean;
  onSubmit: (input: {
    name: string;
    handle: string;
    blotato_id: string | null;
    target_posts_per_week: number | null;
    notes: string | null;
  }) => void;
}) {
  const [name, setName] = useState("");
  const [handle, setHandle] = useState("");
  const [blotatoId, setBlotatoId] = useState("");
  const [target, setTarget] = useState("");
  const [notes, setNotes] = useState("");

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          name: name.trim(),
          handle: handle.trim(),
          blotato_id: blotatoId.trim() || null,
          target_posts_per_week: target.trim() === "" ? null : Number(target),
          notes: notes.trim() || null,
        });
      }}
      className="space-y-4"
    >
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium" htmlFor="new-handle">
            TikTok handle <span className="text-destructive">*</span>
          </label>
          <Input
            id="new-handle"
            value={handle}
            onChange={(e) => setHandle(e.target.value)}
            placeholder="yournotetaker"
            required
          />
          <p className="text-[10px] text-muted-foreground">No @ — just the username.</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium" htmlFor="new-name">
            Display name <span className="text-destructive">*</span>
          </label>
          <Input
            id="new-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="@yournotetaker"
            required
          />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium" htmlFor="new-blotato">
            Blotato account ID
          </label>
          <Input
            id="new-blotato"
            value={blotatoId}
            onChange={(e) => setBlotatoId(e.target.value)}
            placeholder="cmmxd7lo605mnle0y2xe2o1x6"
          />
          <p className="text-[10px] text-muted-foreground">
            Optional — leave blank to fill later. Required before the cycle can post for this account.
          </p>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium" htmlFor="new-target">
            Target posts/week
          </label>
          <Input
            id="new-target"
            value={target}
            onChange={(e) => setTarget(e.target.value)}
            placeholder={`${defaultTarget} (campaign default)`}
            type="number"
            min={0}
            max={50}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <label className="text-xs font-medium" htmlFor="new-notes">Notes</label>
        <textarea
          id="new-notes"
          rows={2}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          className="flex w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring resize-none"
          placeholder="Anything worth knowing about this account…"
        />
      </div>

      <Button type="submit" disabled={submitting} className="w-full">
        {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
        {submitting ? "Creating…" : "Create + add to campaign"}
      </Button>
    </form>
  );
}

function MoveTab({
  other,
  submitting,
  onMove,
}: {
  other: OtherCampaignAccount[];
  submitting: boolean;
  onMove: (id: string, fromCampaign: string) => void;
}) {
  const grouped = useMemo(() => {
    const m = new Map<string, OtherCampaignAccount[]>();
    for (const a of other) {
      const list = m.get(a.campaign_name) ?? [];
      list.push(a);
      m.set(a.campaign_name, list);
    }
    return Array.from(m.entries());
  }, [other]);

  if (other.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-8 text-center border border-dashed rounded-md">
        No accounts on other campaigns.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-start gap-2 px-3 py-2.5 rounded-md bg-amber-100 text-amber-900 text-xs">
        <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
        <span>
          Moving an account removes it from its current campaign. Posts already
          published under the old campaign stay tagged with that campaign — they
          do not migrate with the account.
        </span>
      </div>

      {grouped.map(([campaignName, accounts]) => (
        <div key={campaignName} className="space-y-1">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            From {campaignName}
          </p>
          {accounts.map((a) => (
            <button
              key={a.id}
              type="button"
              disabled={submitting}
              onClick={() => onMove(a.id, a.campaign_name)}
              className="w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-md hover:bg-muted/60 transition-colors text-left disabled:opacity-60"
            >
              <div className="min-w-0">
                <div className="text-sm font-medium">@{a.handle}</div>
                <div className="text-xs text-muted-foreground">{a.name}</div>
              </div>
              <span className="text-xs text-muted-foreground">Move →</span>
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}
