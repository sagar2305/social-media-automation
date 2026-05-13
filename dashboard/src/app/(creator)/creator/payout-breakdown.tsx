/**
 * Renders a payout's full calculator breakdown in a creator-friendly
 * format. Reads payouts.computed_from.breakdown (already a typed
 * array of BreakdownLine) and renders one row per line, with the
 * total bolded.
 *
 * Show-everything design choice: creators see the same numbers the
 * admin sees (flat fees, CPM lines per post, multipliers, manual
 * adjustments). Hiding any of these would make the total feel like
 * a black box — the whole point of this component is "no surprises".
 */

import type { PayoutComputedFrom, ManualAdjustment } from "@/lib/types";

function fmtUsd(cents: number, currency: string): string {
  const sym = currency === "USD" ? "$" : currency === "INR" ? "₹" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "";
  const sign = cents < 0 ? "-" : "";
  return `${sign}${sym}${(Math.abs(cents) / 100).toFixed(2)}`;
}

const KIND_STYLES: Record<string, string> = {
  base: "text-foreground",
  cpm: "text-foreground",
  milestone: "text-foreground",
  multiplier: "text-emerald-700 dark:text-emerald-400",
  adjustment: "text-amber-700 dark:text-amber-400",
  subtotal: "text-muted-foreground border-t border-border/40 pt-2 mt-1",
  total: "font-bold text-base border-t border-border pt-2 mt-1",
};

interface Props {
  computed: PayoutComputedFrom;
  adjustments?: ManualAdjustment[];
  currency?: string;
}

export function PayoutBreakdown({ computed, adjustments = [], currency = "USD" }: Props) {
  const lines = computed.breakdown ?? [];

  return (
    <div className="space-y-1.5 text-sm">
      <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">
        How this was calculated
      </div>
      {lines.map((line, i) => (
        <div
          key={i}
          className={`flex items-baseline justify-between gap-4 ${KIND_STYLES[line.kind] ?? ""}`}
        >
          <span className="text-xs">{line.label}</span>
          <span className="tabular-nums font-medium text-sm">
            {fmtUsd(line.cents, currency)}
          </span>
        </div>
      ))}

      {/* Manual adjustments live separately on the payout row, not in
          the calculator breakdown — render them inline so the creator
          sees every component of the total in one view. */}
      {adjustments.length > 0 && (
        <div className="pt-2 mt-2 border-t border-border/40 space-y-1">
          {adjustments.map((adj, i) => (
            <div key={i} className="flex items-baseline justify-between gap-4 text-amber-700 dark:text-amber-400">
              <span className="text-xs">
                {adj.label}
                {adj.note && <span className="text-muted-foreground"> · {adj.note}</span>}
              </span>
              <span className="tabular-nums font-medium text-sm">
                {adj.kind === "subtract" ? `-${fmtUsd(Math.abs(adj.cents), currency)}` : fmtUsd(adj.cents, currency)}
              </span>
            </div>
          ))}
        </div>
      )}

      {computed.metric_snapshot_at && (
        <p className="text-[10px] text-muted-foreground/70 pt-2">
          Based on metrics as of {new Date(computed.metric_snapshot_at).toLocaleString("en-US")}
        </p>
      )}
    </div>
  );
}
