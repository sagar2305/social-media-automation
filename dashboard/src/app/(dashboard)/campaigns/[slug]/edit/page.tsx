/**
 * /campaigns/[slug]/edit — wrapper for the EditCampaignForm.
 *
 * Loads the campaign + its payout config server-side, hands them to
 * the client surfaces. Auth is enforced by the (dashboard) layout.
 *
 * This page is OUTSIDE the layout's tab strip — editing is a focused
 * task and the tabs would just clutter the form.
 */

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase";
import type { Campaign, CampaignPayoutConfig } from "@/lib/types";
import { EditCampaignForm } from "./edit-form";
import { PayoutConfigEditor } from "./payout-config";

export const revalidate = 0;

export default async function EditCampaignPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const sb = await createClient();
  const { data: campaign } = await sb
    .from("campaigns")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<Campaign>();
  if (!campaign) notFound();

  // The payout config row may not exist yet for a fresh campaign —
  // PayoutConfigEditor takes null as "no rate card yet, default to mode='none'".
  const { data: payoutConfig } = await sb
    .from("campaign_payout_configs")
    .select("*")
    .eq("campaign_id", campaign.id)
    .maybeSingle<CampaignPayoutConfig>();

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <EditCampaignForm campaign={campaign} />
      <PayoutConfigEditor campaignId={campaign.id} initial={payoutConfig ?? null} />
    </div>
  );
}
