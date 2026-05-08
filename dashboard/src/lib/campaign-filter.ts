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

let cached: { slug: string; campaign: ActiveCampaign | null } | null = null;

export async function getActiveCampaignFilter(): Promise<ActiveCampaign | null> {
  const store = await cookies();
  const slug = store.get(ACTIVE_CAMPAIGN_COOKIE)?.value?.trim();
  if (!slug) return null;

  // Per-request memoization — the same request might call this from
  // multiple components (page + layout + nav).
  if (cached?.slug === slug) return cached.campaign;

  const sb = await createClient();
  const { data } = await sb
    .from("campaigns")
    .select("id, slug, name")
    .eq("slug", slug)
    .maybeSingle<ActiveCampaign>();

  cached = { slug, campaign: data ?? null };
  return data ?? null;
}
