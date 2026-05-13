/**
 * /creator/payments — full payout history.
 *
 * Three columns: campaign, amount, status badge. Status is the only
 * thing the creator really cares about: where in the pipeline
 * (calculated → approved → paid) is each chunk of money.
 *
 * No internal ledger txn ids, no idempotency keys, no breakdown
 * meta — just the flow they need to chase up if something stalls.
 */

import { requireCreator } from "@/lib/auth";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { PaymentRow } from "./payment-row";
import type { PayoutWithJoins } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CreatorPayments() {
  const { creator } = await requireCreator();
  const sb = await createClient();

  const { data } = await sb
    .from("payouts")
    .select("*, campaign:campaign_id(id, slug, name)")
    .eq("creator_id", creator.id)
    .order("created_at", { ascending: false })
    .returns<PayoutWithJoins[]>();

  const payouts: PayoutWithJoins[] = (data ?? []).map((p) => ({
    ...p,
    campaign: Array.isArray(p.campaign) ? p.campaign[0] : p.campaign,
  })) as PayoutWithJoins[];

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-medium text-emerald-700/80 dark:text-emerald-400/80 uppercase tracking-widest">
          Transparency
        </p>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-1">Payments</h1>
        <p className="text-muted-foreground mt-2 text-sm max-w-prose">
          Each row is one payment chunk. <strong className="text-foreground">Tap any row to see exactly how
          the amount was calculated</strong> — every cent traces to a labelled line.
        </p>
      </div>

      {payouts.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-border/60 bg-muted/20 px-6 py-12 text-center">
          <p className="text-sm font-medium">No payments yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            Once your posts qualify, the calculator creates the first row here
            automatically. Approval and payment status live updates here too.
          </p>
        </div>
      ) : (
        <div className="rounded-2xl border border-border bg-card overflow-hidden">
          <div className="divide-y divide-border/40">
            {payouts.map((p) => (
              <PaymentRow key={p.id} payout={p} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
