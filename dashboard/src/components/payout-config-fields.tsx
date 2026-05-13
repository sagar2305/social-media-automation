"use client";

/**
 * Shared, controlled payout-rate-card editor.
 *
 * This is the visual + state-shape contract for the payout-config UI
 * that appears in TWO places:
 *
 *   1. /campaigns/new (the create form) — the parent owns the draft
 *      state and serializes it into FormData on submit alongside the
 *      rest of the campaign payload.
 *   2. /campaigns/<slug>/edit (the edit page) — a thin wrapper
 *      (`PayoutConfigEditor`) holds the draft, renders this component,
 *      and exposes its own "Save" button that calls
 *      `upsertCampaignPayoutConfig` directly.
 *
 * The component itself is fully controlled: it takes a `value` +
 * `onChange` and never owns state, so each surface can decide when
 * to persist. It also never renders a save button — that's the
 * caller's responsibility (the edit page has one; the create page
 * relies on the outer form's submit).
 *
 * All money lives in the draft as DOLLAR STRINGS (free-text inputs).
 * Conversion to cents happens only at submit time via
 * `draftToUpsertInput` so we don't accidentally store NaN/0 because
 * the user is mid-typing.
 */

import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Plus, X } from "lucide-react";
import type {
  CampaignPayoutConfig, PayoutMode, Multiplier, MilestoneTier,
} from "@/lib/types";

// ─── Shared constants ────────────────────────────────────────────

export const DEFAULT_MULTIPLIERS: Multiplier[] = [
  { id: "usage_60d", label: "Usage rights — 60 days", pct: 15 },
  { id: "usage_perpetual", label: "Usage rights — perpetual", pct: 50 },
  { id: "excl_30d", label: "Exclusivity — 30 days", pct: 12 },
  { id: "excl_90d_cat", label: "Exclusivity — 90 days, category", pct: 25 },
  { id: "rush", label: "Rush turnaround (≤48h)", pct: 25 },
];

const DEFAULT_MILESTONES: MilestoneTier[] = [
  { views: 100_000, bonus_cents: 5_000 },
  { views: 500_000, bonus_cents: 25_000 },
];

export const MODE_DESCRIPTIONS: Record<PayoutMode, string> = {
  none: "Calculator skips this campaign — creators earn nothing here.",
  flat: "Fixed amount per delivered + published post.",
  cpm: "Per 1,000 views, measured after the view-stabilization window.",
  hybrid: "Flat base per post, plus a CPM kicker on views above the per-post threshold.",
  milestone: "Bonus tiers when a post crosses configured view targets.",
};

// ─── Draft shape + helpers ───────────────────────────────────────

/**
 * The form's working state. Money fields are strings because they're
 * tied to free-text inputs; integer count fields stay strings for the
 * same reason. Convert at submit time, not on every keystroke.
 */
export interface PayoutConfigDraft {
  mode: PayoutMode;
  flat: string;              // dollars
  cpm: string;               // dollars
  windowDays: string;        // integer
  hybridThreshold: string;   // integer
  budget: string;            // dollars
  currency: string;
  approvalRequired: boolean;
  multipliers: Multiplier[];
  milestones: MilestoneTier[];
}

export const DEFAULT_PAYOUT_DRAFT: PayoutConfigDraft = {
  mode: "none",
  flat: "",
  cpm: "",
  windowDays: "14",
  hybridThreshold: "10000",
  budget: "",
  currency: "USD",
  approvalRequired: true,
  multipliers: DEFAULT_MULTIPLIERS,
  milestones: DEFAULT_MILESTONES,
};

/**
 * Hydrate the draft from a persisted config row (edit-page path).
 * Falls back to the same defaults a fresh form would use when the
 * loaded row is missing optional fields.
 */
export function draftFromConfig(c: CampaignPayoutConfig | null): PayoutConfigDraft {
  if (!c) return DEFAULT_PAYOUT_DRAFT;
  return {
    mode: c.mode,
    flat: toDollar(c.flat_per_post_cents),
    cpm: toDollar(c.cpm_cents),
    windowDays: String(c.cpm_view_window_days ?? 14),
    hybridThreshold: String(c.hybrid_threshold_views ?? 10000),
    budget: toDollar(c.total_budget_cents),
    currency: c.currency ?? "USD",
    approvalRequired: c.approval_required ?? true,
    multipliers:
      c.multipliers && c.multipliers.length > 0 ? c.multipliers : DEFAULT_MULTIPLIERS,
    milestones:
      c.milestones && c.milestones.length > 0 ? c.milestones : DEFAULT_MILESTONES,
  };
}

/**
 * Shape the draft hands off to `upsertCampaignPayoutConfig`. Caller
 * is responsible for attaching the `campaign_id` (which the create
 * flow only learns after the campaigns insert succeeds).
 */
export interface PayoutUpsertPayload {
  mode: PayoutMode;
  flat_per_post_cents: number | null;
  cpm_cents: number | null;
  cpm_view_window_days: number;
  hybrid_threshold_views: number | null;
  total_budget_cents: number | null;
  currency: string;
  approval_required: boolean;
  multipliers: Multiplier[];
  milestones: MilestoneTier[];
}

export function draftToUpsertPayload(d: PayoutConfigDraft): PayoutUpsertPayload {
  return {
    mode: d.mode,
    flat_per_post_cents: dollarsToCents(d.flat),
    cpm_cents: dollarsToCents(d.cpm),
    cpm_view_window_days: parseInt(d.windowDays, 10) || 14,
    hybrid_threshold_views: parseInt(d.hybridThreshold, 10) || null,
    total_budget_cents: dollarsToCents(d.budget),
    currency: d.currency,
    approval_required: d.approvalRequired,
    multipliers: d.multipliers,
    milestones: d.milestones,
  };
}

export function dollarsToCents(input: string | undefined): number | null {
  if (input === undefined || input === "") return null;
  const n = parseFloat(input);
  if (!Number.isFinite(n)) return null;
  return Math.round(n * 100);
}

export function toDollar(cents: number | null | undefined): string {
  if (cents == null) return "";
  return (cents / 100).toFixed(2);
}

// ─── Component ───────────────────────────────────────────────────

interface Props {
  value: PayoutConfigDraft;
  onChange: (next: PayoutConfigDraft) => void;
  /**
   * Optional CSS class on the wrapping <div>. Lets each surface apply
   * its own spacing — the edit page sits inside a <Card>, the create
   * page sits inside a section with its own padding.
   */
  className?: string;
  /** Force-disable everything (e.g. while parent is submitting). */
  disabled?: boolean;
}

export function PayoutConfigFields({ value, onChange, className, disabled }: Props) {
  const v = value;
  // Tiny ergonomic helper so the JSX below doesn't repeat the spread.
  function patch(p: Partial<PayoutConfigDraft>) { onChange({ ...v, ...p }); }

  // Multipliers ------------------------------------------------------
  function addMultiplier() {
    const id = `custom_${Date.now()}`;
    patch({ multipliers: [...v.multipliers, { id, label: "New multiplier", pct: 10 }] });
  }
  function removeMultiplier(id: string) {
    patch({ multipliers: v.multipliers.filter((x) => x.id !== id) });
  }
  function updateMultiplier(id: string, p: Partial<Multiplier>) {
    patch({
      multipliers: v.multipliers.map((x) => (x.id === id ? { ...x, ...p } : x)),
    });
  }

  // Milestones -------------------------------------------------------
  function addMilestone() {
    patch({ milestones: [...v.milestones, { views: 1_000_000, bonus_cents: 75_000 }] });
  }
  function removeMilestone(idx: number) {
    patch({ milestones: v.milestones.filter((_, i) => i !== idx) });
  }
  function updateMilestone(idx: number, p: Partial<MilestoneTier>) {
    patch({
      milestones: v.milestones.map((x, i) => (i === idx ? { ...x, ...p } : x)),
    });
  }

  return (
    <div className={className ?? "space-y-5"}>
      {/* Mode + currency */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <Field label="Payout model" hint={MODE_DESCRIPTIONS[v.mode]}>
          <Select
            value={v.mode}
            onValueChange={(val) => { if (val) patch({ mode: val as PayoutMode }); }}
            disabled={disabled}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="none">None</SelectItem>
              <SelectItem value="flat">Flat per post</SelectItem>
              <SelectItem value="cpm">CPM</SelectItem>
              <SelectItem value="hybrid">Hybrid (flat + CPM)</SelectItem>
              <SelectItem value="milestone">Milestone tiers</SelectItem>
            </SelectContent>
          </Select>
        </Field>
        <Field label="Currency">
          <Select
            value={v.currency}
            onValueChange={(val) => { if (val) patch({ currency: val }); }}
            disabled={disabled}
          >
            <SelectTrigger><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="USD">USD ($)</SelectItem>
              <SelectItem value="INR">INR (₹)</SelectItem>
              <SelectItem value="EUR">EUR (€)</SelectItem>
              <SelectItem value="GBP">GBP (£)</SelectItem>
            </SelectContent>
          </Select>
        </Field>
      </div>

      {/* Mode-specific fields */}
      {v.mode !== "none" && (
        <div className="rounded-md border border-border/60 px-4 py-3 space-y-4">
          {(v.mode === "flat" || v.mode === "hybrid") && (
            <Field
              label={v.mode === "hybrid" ? "Flat base per post" : "Flat fee per post"}
              hint="The fixed amount paid per delivered + published post"
            >
              <Input
                type="number"
                step="0.01"
                min="0"
                value={v.flat}
                onChange={(e) => patch({ flat: e.target.value })}
                placeholder="50.00"
                disabled={disabled}
              />
            </Field>
          )}

          {(v.mode === "cpm" || v.mode === "hybrid") && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="CPM rate" hint="Dollars per 1,000 views">
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={v.cpm}
                  onChange={(e) => patch({ cpm: e.target.value })}
                  placeholder="5.00"
                  disabled={disabled}
                />
              </Field>
              <Field
                label="View-stabilization window"
                hint="Days after post-date before views count toward CPM. Stops misleading day-1 spikes from being paid."
              >
                <Input
                  type="number"
                  min="0"
                  max="60"
                  value={v.windowDays}
                  onChange={(e) => patch({ windowDays: e.target.value })}
                  disabled={disabled}
                />
              </Field>
            </div>
          )}

          {v.mode === "hybrid" && (
            <Field
              label="Hybrid threshold (views)"
              hint="CPM kicks in only on per-post views ABOVE this number"
            >
              <Input
                type="number"
                min="0"
                value={v.hybridThreshold}
                onChange={(e) => patch({ hybridThreshold: e.target.value })}
                placeholder="10000"
                disabled={disabled}
              />
            </Field>
          )}

          {v.mode === "milestone" && (
            <div className="space-y-2">
              <label className="text-xs font-medium">Milestone tiers</label>
              <p className="text-[11px] text-muted-foreground">
                Each post earns at most ONE tier — the highest it crosses. A 600k-view
                post hitting both 100k and 500k tiers earns the 500k bonus only.
              </p>
              <div className="space-y-2">
                {v.milestones.map((m, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2 items-center">
                    <Input
                      type="number"
                      min="0"
                      value={m.views}
                      onChange={(e) => updateMilestone(idx, { views: parseInt(e.target.value, 10) || 0 })}
                      className="col-span-5 font-mono"
                      placeholder="100000"
                      disabled={disabled}
                    />
                    <span className="col-span-1 text-center text-xs text-muted-foreground">views →</span>
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={(m.bonus_cents / 100).toFixed(2)}
                      onChange={(e) => updateMilestone(idx, { bonus_cents: dollarsToCents(e.target.value) ?? 0 })}
                      className="col-span-5 font-mono"
                      placeholder="50.00"
                      disabled={disabled}
                    />
                    <button
                      type="button"
                      onClick={() => removeMilestone(idx)}
                      className="col-span-1 text-muted-foreground hover:text-destructive disabled:opacity-50"
                      disabled={disabled}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
              <Button variant="outline" type="button" size="sm" onClick={addMilestone} disabled={disabled}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Add tier
              </Button>
            </div>
          )}
        </div>
      )}

      {/* Multipliers (all modes except 'none') */}
      {v.mode !== "none" && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-xs font-medium">Multipliers (rate-card menu)</label>
            <Button variant="outline" type="button" size="sm" onClick={addMultiplier} disabled={disabled}>
              <Plus className="h-3.5 w-3.5 mr-1" /> Add
            </Button>
          </div>
          <p className="text-[11px] text-muted-foreground">
            Each assignment opts in to whichever apply (e.g. some creators sign for usage rights, some don&apos;t).
            Stored on the campaign so the menu is consistent for all creators.
          </p>
          <div className="rounded-md border border-border/60 divide-y divide-border/40">
            {v.multipliers.length === 0 && (
              <p className="px-3 py-3 text-xs text-muted-foreground italic">No multipliers configured.</p>
            )}
            {v.multipliers.map((m) => (
              <div key={m.id} className="grid grid-cols-12 gap-2 items-center px-3 py-2">
                <Input
                  value={m.label}
                  onChange={(e) => updateMultiplier(m.id, { label: e.target.value })}
                  className="col-span-7"
                  placeholder="Usage rights — 60 days"
                  disabled={disabled}
                />
                <div className="col-span-3 flex items-center gap-1">
                  <Input
                    type="number"
                    step="0.5"
                    value={m.pct}
                    onChange={(e) => updateMultiplier(m.id, { pct: parseFloat(e.target.value) || 0 })}
                    className="font-mono"
                    disabled={disabled}
                  />
                  <span className="text-xs text-muted-foreground">%</span>
                </div>
                <code className="col-span-1 text-[10px] text-muted-foreground/70 truncate" title={m.id}>{m.id}</code>
                <button
                  type="button"
                  onClick={() => removeMultiplier(m.id)}
                  className="col-span-1 text-muted-foreground hover:text-destructive justify-self-end disabled:opacity-50"
                  disabled={disabled}
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Budget + approval */}
      {v.mode !== "none" && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Field label="Total budget" hint="Soft cap. Inbox warns when 80% spent. Leave blank = no cap.">
            <Input
              type="number"
              step="0.01"
              min="0"
              value={v.budget}
              onChange={(e) => patch({ budget: e.target.value })}
              placeholder="5000.00"
              disabled={disabled}
            />
          </Field>
          <div className="space-y-1.5">
            <label className="text-xs font-medium">Approval workflow</label>
            <label className="flex items-center gap-2 mt-2">
              <input
                type="checkbox"
                checked={v.approvalRequired}
                onChange={(e) => patch({ approvalRequired: e.target.checked })}
                className="h-3.5 w-3.5"
                disabled={disabled}
              />
              <span className="text-xs">Require manual approval before mark-as-paid</span>
            </label>
            <p className="text-[11px] text-muted-foreground">
              Off = (future) auto-approve trusted creators. Default is on.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <label className="text-xs font-medium">{label}</label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}
