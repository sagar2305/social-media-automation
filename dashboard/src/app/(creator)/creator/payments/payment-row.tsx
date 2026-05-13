"use client";

/**
 * One payout row that expands to show the full breakdown.
 *
 * Click anywhere on the collapsed row to toggle. Once expanded, the
 * <PayoutBreakdown> renders the line items the calculator persisted
 * to payouts.computed_from — same data the admin sees, no edits
 * possible. This is the "transparency" piece: every cent earned
 * traces to a labelled line.
 */

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { PayoutBreakdown } from "../payout-breakdown";
import type { PayoutWithJoins } from "@/lib/types";

function fmtUsd(cents: number, currency: string = "USD"): string {
  const sym = currency === "USD" ? "$" : currency === "INR" ? "₹" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "";
  return `${sym}${(cents / 100).toFixed(2)}`;
}

const STATUS_LABEL: Record<string, { label: string; className: string }> = {
  pending: { label: "Pending review", className: "bg-amber-500/10 text-amber-700 dark:text-amber-400" },
  approved: { label: "Approved · payment incoming", className: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
  processing: { label: "Approved · payment incoming", className: "bg-blue-500/10 text-blue-700 dark:text-blue-400" },
  paid: { label: "Paid", className: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-400" },
  cancelled: { label: "Cancelled", className: "bg-muted text-muted-foreground" },
  failed: { label: "Failed — please contact us", className: "bg-destructive/10 text-destructive" },
};

export function PaymentRow({ payout }: { payout: PayoutWithJoins }) {
  const [open, setOpen] = useState(false);
  const status = STATUS_LABEL[payout.status] ?? { label: payout.status, className: "bg-muted text-muted-foreground" };

  return (
    <div className="px-4 py-3">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between gap-4 text-left"
      >
        <div className="min-w-0">
          <p className="text-sm font-medium">{payout.campaign?.name ?? "Campaign"}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {new Date(payout.created_at).toLocaleDateString("en-US")}
            {payout.paid_at && payout.status === "paid" && (
              <> · paid {new Date(payout.paid_at).toLocaleDateString("en-US")}</>
            )}
            {payout.processor_ref && (
              <> · ref <code className="font-mono text-[10px]">{payout.processor_ref}</code></>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-medium ${status.className}`}>
            {status.label}
          </span>
          <p className="text-sm font-semibold tabular-nums w-20 text-right">
            {fmtUsd(payout.amount_cents, payout.currency)}
          </p>
          <ChevronDown
            className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`}
          />
        </div>
      </button>

      {open && (
        <div className="mt-3 pt-3 border-t border-border/40 pl-1">
          <PayoutBreakdown
            computed={payout.computed_from}
            adjustments={payout.manual_adjustments}
            currency={payout.currency}
          />
        </div>
      )}
    </div>
  );
}
