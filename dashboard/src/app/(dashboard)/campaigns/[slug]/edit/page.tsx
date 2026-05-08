/**
 * /campaigns/[slug]/edit — wrapper for the EditCampaignForm.
 *
 * Loads the campaign server-side, hands it to the client form. Auth is
 * enforced by the (dashboard) layout, so non-authed users hitting this
 * URL will be redirected to /login by the time they reach this point.
 *
 * This page is OUTSIDE the layout's tab strip — editing is a focused
 * task and the tabs would just clutter the form. The hero header is
 * also dropped on purpose; the form's own header carries the back-arrow
 * and Save/Cancel actions.
 */

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase";
import type { Campaign } from "@/lib/types";
import { EditCampaignForm } from "./edit-form";

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

  return (
    <div className="max-w-3xl mx-auto">
      <EditCampaignForm campaign={campaign} />
    </div>
  );
}
