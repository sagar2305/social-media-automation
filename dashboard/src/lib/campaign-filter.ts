/**
 * Active-campaign filter resolution (server side).
 *
 * The dashboard header has a Campaign dropdown that lets the user scope
 * global pages (Home, Posts, Accounts) to a single campaign. The
 * selection persists in the `active_campaign` cookie. Server components
 * read it through this helper to avoid each page re-implementing the
 * lookup.
 *
 * Cookie value:
 *   - empty / unset → "All campaigns" (no filter)
 *   - non-empty     → campaign slug to filter on
 *
 * Returns:
 *   - null  if no campaign is selected, OR if the slug doesn't match an
 *           existing campaign (graceful — pages still render full data)
 *   - { id, slug, name }  for the matching campaign
 */

import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase";

export const ACTIVE_CAMPAIGN_COOKIE = "active_campaign";

export interface ActiveCampaign {
  id: string;
  slug: string;
  name: string;
}

export async function getActiveCampaignFilter(): Promise<ActiveCampaign | null> {
  const store = await cookies();
  const slug = store.get(ACTIVE_CAMPAIGN_COOKIE)?.value?.trim();
  if (!slug) return null;

  // No module-level memoization on purpose. In Next.js's server
  // runtime, module state outlives a single request (one Node
  // process serves many requests) — caching the lookup here was
  // both subtly wrong (cross-user leakage in shared deployments)
  // and was shadowing the layout-cache invalidation that the
  // setActiveCampaign server action relies on.
  const sb = await createClient();
  const { data } = await sb
    .from("campaigns")
    .select("id, slug, name")
    .eq("slug", slug)
    .maybeSingle<ActiveCampaign>();

  return data ?? null;
}
