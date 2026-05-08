"use server";

/**
 * Server actions for /campaigns/[slug]/accounts.
 *
 * Account ↔ Campaign rule (locked in Phase 1): each account belongs to
 * exactly ONE campaign at a time. Moving an account between campaigns
 * is a single UPDATE; the existing posts the account already published
 * keep their original campaign_id (they don't migrate with the
 * account). That mirrors Trackr's model.
 */

import { createClient } from "@/lib/supabase";
import { revalidatePath } from "next/cache";

interface CampaignRow { id: string }

async function getCampaignBySlug(slug: string): Promise<CampaignRow | null> {
  const sb = await createClient();
  const { data } = await sb
    .from("campaigns")
    .select("id")
    .eq("slug", slug)
    .maybeSingle<CampaignRow>();
  return data ?? null;
}

function normaliseHandle(h: string): string {
  return h.trim().replace(/^@/, "").toLowerCase();
}

/** Attach an existing (unassigned or other-campaign) account to this campaign. */
export async function assignAccountToCampaign(input: {
  slug: string;
  accountId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const c = await getCampaignBySlug(input.slug);
  if (!c) return { ok: false, error: "Campaign not found" };

  const sb = await createClient();
  const { error } = await sb
    .from("accounts")
    .update({ campaign_id: c.id })
    .eq("id", input.accountId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/campaigns/${input.slug}`);
  revalidatePath(`/campaigns/${input.slug}/accounts`);
  return { ok: true };
}

/** Create a brand-new account already attached to this campaign. */
export async function createAccountForCampaign(input: {
  slug: string;
  name: string;
  handle: string;
  blotato_id: string | null;   // accounts.id is also Blotato id in current schema
  target_posts_per_week: number | null;
  notes: string | null;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const handle = normaliseHandle(input.handle);
  if (!handle) return { ok: false, error: "Handle is required" };
  if (!input.name.trim()) return { ok: false, error: "Display name is required" };

  const c = await getCampaignBySlug(input.slug);
  if (!c) return { ok: false, error: "Campaign not found" };

  const sb = await createClient();

  // accounts.handle is the natural key against TikTok — we never want
  // two rows pointing at the same username. Three branches:
  //   1. Already on this campaign → error (nothing to do)
  //   2. Unassigned (campaign_id IS NULL) → attach to this campaign,
  //      auto-reactivate if it was paused. User typing "Create new" for
  //      a handle that just happens to be sitting unassigned probably
  //      just wants it added; making them go to the Existing tab to do
  //      the same thing is busywork.
  //   3. On a different campaign → error with that campaign's name so
  //      they know where to find it for the Move flow.
  const { data: existing } = await sb
    .from("accounts")
    .select("id, campaign_id, active, campaigns:campaign_id(slug, name)")
    .eq("handle", handle)
    .maybeSingle<{
      id: string;
      campaign_id: string | null;
      active: boolean;
      campaigns: { slug: string; name: string } | null;
    }>();

  if (existing) {
    if (existing.campaign_id === c.id) {
      return { ok: false, error: `@${handle} is already on this campaign` };
    }
    if (existing.campaign_id === null) {
      // Unassigned — quietly attach + reactivate.
      const { error: attachErr } = await sb
        .from("accounts")
        .update({
          campaign_id: c.id,
          active: true,
          // Refresh metadata if the user typed new values; preserve old
          // ones when they left fields blank.
          ...(input.name?.trim() ? { name: input.name.trim().startsWith("@") ? input.name.trim() : `@${input.name.trim()}` } : {}),
          ...(input.notes?.trim() ? { notes: input.notes.trim() } : {}),
          ...(input.target_posts_per_week !== null ? { target_posts_per_week: input.target_posts_per_week } : {}),
        })
        .eq("id", existing.id);
      if (attachErr) return { ok: false, error: attachErr.message };

      revalidatePath(`/campaigns/${input.slug}`);
      revalidatePath(`/campaigns/${input.slug}/accounts`);
      return { ok: true, id: existing.id };
    }
    const otherName = existing.campaigns?.name ?? "another campaign";
    return {
      ok: false,
      error: `@${handle} is already on ${otherName} — use the 'Move from another campaign' tab instead.`,
    };
  }

  // accounts.id is text and currently doubles as the Blotato account ID.
  // If the user didn't provide one, generate a placeholder so the row is
  // valid; they can fix it later by editing.
  const id = input.blotato_id?.trim() || `pending-${handle}-${Date.now()}`;

  const { error } = await sb.from("accounts").insert({
    id,
    name: input.name.trim().startsWith("@") ? input.name.trim() : `@${input.name.trim()}`,
    handle,
    active: true,
    notes: input.notes?.trim() || null,
    campaign_id: c.id,
    target_posts_per_week: input.target_posts_per_week,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/campaigns/${input.slug}`);
  revalidatePath(`/campaigns/${input.slug}/accounts`);
  return { ok: true, id };
}

/** Detach an account from this campaign (sets campaign_id = NULL). */
export async function removeAccountFromCampaign(input: {
  slug: string;
  accountId: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = await createClient();
  const { error } = await sb
    .from("accounts")
    .update({ campaign_id: null })
    .eq("id", input.accountId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/campaigns/${input.slug}`);
  revalidatePath(`/campaigns/${input.slug}/accounts`);
  return { ok: true };
}

/** Toggle the active flag — paused accounts stay attached to the campaign
 *  but the cycle skips them. */
export async function setAccountActive(input: {
  slug: string;
  accountId: string;
  active: boolean;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  const sb = await createClient();
  const { error } = await sb
    .from("accounts")
    .update({ active: input.active })
    .eq("id", input.accountId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/campaigns/${input.slug}`);
  revalidatePath(`/campaigns/${input.slug}/accounts`);
  return { ok: true };
}

/** Update per-account target_posts_per_week. NULL = inherit campaign default. */
export async function setAccountTarget(input: {
  slug: string;
  accountId: string;
  target: number | null;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  if (input.target !== null && (input.target < 0 || input.target > 50)) {
    return { ok: false, error: "Target must be 0–50 posts/week" };
  }
  const sb = await createClient();
  const { error } = await sb
    .from("accounts")
    .update({ target_posts_per_week: input.target })
    .eq("id", input.accountId);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/campaigns/${input.slug}`);
  revalidatePath(`/campaigns/${input.slug}/accounts`);
  return { ok: true };
}
