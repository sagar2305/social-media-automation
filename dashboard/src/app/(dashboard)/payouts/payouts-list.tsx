"use client";

/**
 * Client-side payouts inbox. Three tabs (Pending / Approved / Paid).
 * Each row expands to show the calculator's full breakdown table —
 * the "visible math" pattern from the 2026 industry research.
 *
 * Approve / Mark-as-Paid / Cancel buttons hit the server actions
 * which write balanced ledger transactions. No money actually moves
 * here — operator sends transfers externally and reports back via
 * the Mark-as-Paid button.
 */

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  CheckCircle2,
  Clock3,
  CircleDot,
  XCircle,
  ChevronDown,
  ChevronRight,
  AlertCircle,
  Loader2,
  Plus,
  X,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import type { PayoutWithJoins, PayoutStatus, ManualAdjustment } from "@/lib/types";
import {
  approvePayout, markPayoutPaid, cancelPayout, setPayoutAdjustments,
} from "./actions";
import { PayCreatorPanel } from "./pay-creator-panel";

type Tab = "pending" | "approved" | "paid";

export function PayoutsList({ initial }: { initial: PayoutWithJoins[] }) {
  const router = useRouter();
  const [tab, setTab] = useState<Tab>("pending");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  const grouped = useMemo(() => {
    return {
      pending: initial.filter((p) => p.status === "pending"),
      approved: initial.filter((p) => p.status === "approved" || p.status === "processing"),
      paid: initial.filter((p) => p.status === "paid" || p.status === "failed" || p.status === "cancelled"),
    };
  }, [initial]);

  const total = (rows: PayoutWithJoins[]) =>
    rows.reduce((sum, r) => sum + r.amount_cents, 0);

  async function handleApprove(id: string) {
    setBusyId(id);
    setError(null);
    const r = await approvePayout({ id });
    setBusyId(null);
    if (!r.ok) { setError(r.error); return; }
    startTransition(() => router.refresh());
  }

  async function handleMarkPaid(id: string) {
    const ref = window.prompt(
      "Reference for the external transfer (optional — UPI ref, Wire ID, transaction note):",
      ""
    );
    if (ref === null) return;          // cancelled prompt
    setBusyId(id);
    setError(null);
    const r = await markPayoutPaid({ id, reference: ref || undefined });
    setBusyId(null);
    if (!r.ok) { setError(r.error); return; }
    startTransition(() => router.refresh());
  }

  async function handleCancel(id: string) {
    if (!window.confirm("Cancel this pending payout? It won't be paid.")) return;
    setBusyId(id);
    setError(null);
    const r = await cancelPayout({ id });
    setBusyId(null);
    if (!r.ok) { setError(r.error); return; }
    startTransition(() => router.refresh());
  }

  const activeRows = grouped[tab];

  return (
    <div className="space-y-4">
      {/* Tabs + totals */}
      <div className="flex items-center gap-1 border-b border-border/60">
        <TabButton
          label={`Pending approval (${grouped.pending.length})`}
          subtitle={fmtUsd(total(grouped.pending))}
          active={tab === "pending"}
          onClick={() => { setTab("pending"); setExpandedId(null); }}
        />
        <TabButton
          label={`Awaiting payment (${grouped.approved.length})`}
          subtitle={fmtUsd(total(grouped.approved))}
          active={tab === "approved"}
          onClick={() => { setTab("approved"); setExpandedId(null); }}
        />
        <TabButton
          label={`History (${grouped.paid.length})`}
          subtitle={fmtUsd(total(grouped.paid))}
          active={tab === "paid"}
          onClick={() => { setTab("paid"); setExpandedId(null); }}
        />
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
        </div>
      )}

      {/* Empty state */}
      {activeRows.length === 0 && (
        <Card className="border-dashed border border-border/60">
          <CardContent className="py-10 text-center text-sm text-muted-foreground">
            {tab === "pending" && "No pending payouts. They appear here automatically as the calculator runs after each analytics refresh."}
            {tab === "approved" && "Nothing approved + awaiting external payment right now."}
            {tab === "paid" && "No history yet."}
          </CardContent>
        </Card>
      )}

      {/* Rows */}
      <div className="space-y-2">
        {activeRows.map((p) => {
          const isOpen = expandedId === p.id;
          const isBusy = busyId === p.id;
          return (
            <Card key={p.id} className="overflow-hidden">
              <button
                type="button"
                onClick={() => setExpandedId(isOpen ? null : p.id)}
                className="w-full flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40 transition-colors text-left"
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <StatusBadge status={p.status} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">
                      {p.creator?.display_name || p.creator?.legal_name || "(unknown creator)"}
                      <span className="ml-2 text-xs font-normal text-muted-foreground">
                        · {p.campaign?.name ?? "(unknown campaign)"}
                      </span>
                    </p>
                    <p className="text-[11px] text-muted-foreground mt-0.5">
                      {p.computed_from?.contributing_post_ids?.length ?? 0} post(s) ·{" "}
                      <span className="uppercase">{p.computed_from?.rule ?? p.status}</span> rule ·{" "}
                      computed {fmtRelative(p.computed_from?.metric_snapshot_at ?? p.created_at)}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="font-semibold tabular-nums text-sm">
                    {fmtUsdWithCurrency(p.amount_cents, p.currency)}
                  </span>
                  {isOpen ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </div>
              </button>

              {isOpen && (
                <div className="border-t border-border/50 bg-muted/20">
                  <BreakdownTable payout={p} />
                  {p.status === "pending" && (
                    <ManualAdjustmentsEditor payout={p} onError={setError} onBusy={setBusyId} />
                  )}

                  {/* Pay-this-creator panel — shows UPI ID, screenshot,
                      and admin notes. Only relevant once approved (when
                      the admin is about to mark paid) but it's also
                      useful on pending so the admin can sanity-check
                      the creator filled it in before approving. */}
                  {p.creator && (p.status === "approved" || p.status === "processing" || p.status === "pending") && (
                    <PayCreatorPanel creator={p.creator} />
                  )}

                  <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-border/50 bg-background">
                    <div className="flex items-center gap-2">
                      <Link
                        href={`/creators/${p.creator?.id ?? ""}`}
                        className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                      >
                        View creator
                      </Link>
                      {p.status === "pending" && (
                        <>
                          <Button variant="outline" size="sm" disabled={isBusy} onClick={() => handleCancel(p.id)}>
                            Cancel
                          </Button>
                          <Button size="sm" disabled={isBusy || p.amount_cents === 0} onClick={() => handleApprove(p.id)}>
                            {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                            Approve & freeze
                          </Button>
                        </>
                      )}
                      {(p.status === "approved" || p.status === "processing") && (
                        <Button size="sm" disabled={isBusy} onClick={() => handleMarkPaid(p.id)}>
                          {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" /> : <CheckCircle2 className="h-3.5 w-3.5 mr-1.5" />}
                          Mark as paid
                        </Button>
                      )}
                    </div>
                  </div>
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}

function TabButton({
  label,
  subtitle,
  active,
  onClick,
}: {
  label: string;
  subtitle: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-4 py-2.5 -mb-px border-b-2 transition-colors ${
        active ? "border-primary" : "border-transparent hover:border-border"
      }`}
    >
      <p className={`text-sm font-medium ${active ? "text-foreground" : "text-muted-foreground"}`}>{label}</p>
      <p className="text-[10px] text-muted-foreground mt-0.5 tabular-nums">{subtitle}</p>
    </button>
  );
}

function StatusBadge({ status }: { status: PayoutStatus }) {
  const map: Record<PayoutStatus, { Icon: React.ComponentType<{ className?: string }>; cls: string; label: string }> = {
    pending:    { Icon: Clock3,      cls: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-400",     label: "Pending" },
    approved:   { Icon: CircleDot,   cls: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-400",         label: "Approved" },
    processing: { Icon: Loader2,     cls: "bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-400",         label: "Processing" },
    paid:       { Icon: CheckCircle2, cls: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-400", label: "Paid" },
    failed:     { Icon: XCircle,     cls: "bg-destructive/15 text-destructive",                                       label: "Failed" },
    cancelled:  { Icon: XCircle,     cls: "bg-muted text-muted-foreground",                                            label: "Cancelled" },
  };
  const { Icon, cls, label } = map[status];
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

function BreakdownTable({ payout: p }: { payout: PayoutWithJoins }) {
  const lines = p.computed_from?.breakdown ?? [];
  if (lines.length === 0) {
    return (
      <div className="px-4 py-3 text-xs text-muted-foreground italic">
        No breakdown recorded for this payout (older calculator output).
      </div>
    );
  }
  return (
    <div className="px-4 py-3">
      <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground mb-2">
        Breakdown — {p.computed_from?.rule ?? "?"} rule
      </p>
      <table className="w-full text-xs">
        <tbody>
          {lines.map((line, i) => {
            const isSubtotal = line.kind === "subtotal";
            const isTotal = line.kind === "total";
            const isNeg = line.cents < 0;
            return (
              <tr
                key={i}
                className={`${isSubtotal ? "border-t border-border/60" : ""} ${isTotal ? "border-t-2 border-border font-semibold" : ""}`}
              >
                <td className={`py-1 pr-3 ${isSubtotal || isTotal ? "uppercase tracking-wide text-[10px]" : ""}`}>
                  <span className={isTotal ? "text-foreground" : "text-foreground/80"}>{line.label}</span>
                </td>
                <td className={`py-1 text-right tabular-nums ${isNeg ? "text-destructive" : isTotal ? "text-foreground" : "text-foreground/80"}`}>
                  {fmtUsdWithCurrency(line.cents, p.currency)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {p.computed_from?.metric_snapshot_at && (
        <p className="text-[10px] text-muted-foreground/80 mt-2">
          Snapshot: {new Date(p.computed_from.metric_snapshot_at).toLocaleString()}
        </p>
      )}
    </div>
  );
}

function fmtUsd(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

function fmtUsdWithCurrency(cents: number, currency: string): string {
  const sym = currency === "USD" ? "$" : currency === "INR" ? "₹" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "";
  const sign = cents < 0 ? "-" : "";
  return `${sign}${sym}${(Math.abs(cents) / 100).toFixed(2)}${sym ? "" : " " + currency}`;
}

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "just now";
  const min = Math.floor(ms / 60_000);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day}d ago`;
  return new Date(iso).toLocaleDateString();
}

/**
 * Pending-payout-only adjustments editor. Lets the operator type
 * free-form add/subtract line items (quality bonus, late penalty,
 * dispute settlement, etc.) that fold into the calculator output.
 *
 * Persists immediately on every change via setPayoutAdjustments —
 * no save button to forget. The next analytics-refresh runner tick
 * preserves these adjustments because the calculator reads them
 * back from the existing pending row.
 */
function ManualAdjustmentsEditor({
  payout,
  onError,
  onBusy,
}: {
  payout: PayoutWithJoins;
  onError: (msg: string | null) => void;
  onBusy: (id: string | null) => void;
}) {
  const router = useRouter();
  const [adjustments, setAdjustments] = useState<ManualAdjustment[]>(payout.manual_adjustments ?? []);
  const [, startTransition] = useTransition();

  async function persist(next: ManualAdjustment[]) {
    setAdjustments(next);
    onBusy(payout.id);
    onError(null);
    const r = await setPayoutAdjustments({ id: payout.id, adjustments: next });
    onBusy(null);
    if (!r.ok) { onError(r.error); return; }
    startTransition(() => router.refresh());
  }

  function addLine() {
    void persist([...adjustments, { label: "Adjustment", cents: 0, kind: "add", note: null }]);
  }
  function removeLine(idx: number) {
    void persist(adjustments.filter((_, i) => i !== idx));
  }
  function updateLine(idx: number, patch: Partial<ManualAdjustment>) {
    void persist(adjustments.map((a, i) => (i === idx ? { ...a, ...patch } : a)));
  }

  return (
    <div className="px-4 py-3 border-t border-border/50">
      <div className="flex items-center justify-between mb-2">
        <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">
          Manual adjustments
        </p>
        <button
          type="button"
          onClick={addLine}
          className="text-[11px] text-primary hover:underline inline-flex items-center gap-1"
        >
          <Plus className="h-3 w-3" /> Add line
        </button>
      </div>

      {adjustments.length === 0 ? (
        <p className="text-[11px] text-muted-foreground italic">
          None yet. Add a line to apply a quality bonus, late penalty, or any one-off adjustment.
        </p>
      ) : (
        <div className="space-y-1.5">
          {adjustments.map((a, idx) => (
            <div key={idx} className="grid grid-cols-12 gap-2 items-center">
              <Input
                value={a.label}
                onChange={(e) => updateLine(idx, { label: e.target.value })}
                placeholder="Quality bonus"
                className="col-span-4 text-xs"
              />
              <select
                value={a.kind}
                onChange={(e) => updateLine(idx, { kind: e.target.value as ManualAdjustment["kind"] })}
                className="col-span-2 text-xs h-9 rounded-md border border-input bg-background px-2"
              >
                <option value="add">+ add</option>
                <option value="subtract">− subtract</option>
              </select>
              <div className="col-span-3 flex items-center gap-1">
                <span className="text-xs text-muted-foreground">$</span>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  value={(a.cents / 100).toFixed(2)}
                  onChange={(e) => updateLine(idx, { cents: Math.round((parseFloat(e.target.value) || 0) * 100) })}
                  className="font-mono text-xs"
                />
              </div>
              <Input
                value={a.note ?? ""}
                onChange={(e) => updateLine(idx, { note: e.target.value || null })}
                placeholder="(note)"
                className="col-span-2 text-xs"
              />
              <button
                type="button"
                onClick={() => removeLine(idx)}
                className="col-span-1 text-muted-foreground hover:text-destructive justify-self-end"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
      <p className="text-[10px] text-muted-foreground mt-2">
        Adjustments stay attached when the calculator recomputes — the operator owns this column.
      </p>
    </div>
  );
}
