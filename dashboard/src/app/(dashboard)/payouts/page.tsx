/**
 * /payouts — global creator-payouts inbox.
 *
 * Three tab views:
 *   - Pending approval  (calculator output; operator decides)
 *   - Approved          (frozen amounts awaiting external payment)
 *   - Paid              (history)
 *
 * Each row links to the creator's profile. The row itself shows
 * enough at-a-glance to approve in bulk — creator name, campaign,
 * amount, when computed.
 *
 * The big surface is in the per-row drawer (the "computed_from"
 * breakdown), implemented client-side via PayoutsList below.
 */

import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { PayoutsList } from "./payouts-list";
import { Button } from "@/components/ui/button";
import { Download } from "lucide-react";
import type { PayoutWithJoins } from "@/lib/types";

export const dynamic = "force-dynamic";

async function loadPayouts(): Promise<PayoutWithJoins[]> {
  const sb = await createClient();
  const { data, error } = await sb
    .from("payouts")
    .select(
      // Embedded relationships fetch creator + campaign basics in
      // one round-trip — Postgrest expands them into nested objects.
      "*, creator:creator_id(id, legal_name, display_name, email, preferred_processor, manual_payout_notes, payment_upi_id, payment_screenshot_path, payment_screenshot_uploaded_at), campaign:campaign_id(id, slug, name)"
    )
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("[payouts] load failed:", error.message);
    return [];
  }

  // PostgREST embeds can come back as objects OR single-element
  // arrays depending on relationship cardinality. Normalise.
  return ((data ?? []) as unknown as Array<PayoutWithJoins & {
    creator: PayoutWithJoins["creator"] | PayoutWithJoins["creator"][];
    campaign: PayoutWithJoins["campaign"] | PayoutWithJoins["campaign"][];
  }>).map((row) => ({
    ...row,
    creator: Array.isArray(row.creator) ? row.creator[0] : row.creator,
    campaign: Array.isArray(row.campaign) ? row.campaign[0] : row.campaign,
  })) as PayoutWithJoins[];
}

export default async function PayoutsPage() {
  const payouts = await loadPayouts();

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Payouts</h1>
          <p className="text-muted-foreground mt-1">
            Calculator output for every creator on every campaign. Review the
            breakdown, approve to freeze the amount, then mark as paid once
            you&apos;ve sent the transfer externally.
          </p>
        </div>
        <Link href="/api/payouts/export" target="_blank">
          <Button variant="outline">
            <Download className="h-4 w-4 mr-1.5" />
            Export CSV
          </Button>
        </Link>
      </div>
      <PayoutsList initial={payouts} />
    </div>
  );
}
