"use server";

/**
 * Server actions for the campaign edit page.
 *
 * Phase 17 scope: the most-edited fields (basics + content gen hints +
 * goals + AI brain toggle + email digest config + status). The full
 * 11-section edit form from the original plan is left out of this
 * commit because most operators will never touch flows weights or
 * milestone thresholds inline; those defaults are fine. We can grow
 * the form later without breaking what's already deployed.
 */

import { createClient } from "@/lib/supabase";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

type Result = { ok: true } | { ok: false; error: string };

function csv(input: string | undefined): string[] {
  if (!input) return [];
  return input
    .split(/[\n,]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function csvHashtags(input: string | undefined): string[] {
  return csv(input).map((s) => (s.startsWith("#") ? s : `#${s}`));
}

export async function updateCampaignAction(formData: FormData): Promise<Result> {
  const slug = String(formData.get("slug") ?? "").trim();
  if (!slug) return { ok: false, error: "Missing campaign slug" };

  const sb = await createClient();

  // Confirm campaign exists; we use the slug to look up id (the slug is
  // immutable after creation in this minimal edit page).
  const { data: existing } = await sb
    .from("campaigns")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (!existing) return { ok: false, error: "Campaign not found" };

  const update: Record<string, unknown> = {
    name: String(formData.get("name") ?? "").trim(),
    description: String(formData.get("description") ?? "").trim() || null,
    status: String(formData.get("status") ?? "active"),
    start_date: String(formData.get("start_date") ?? "").trim() || null,
    end_date: String(formData.get("end_date") ?? "").trim() || null,
    visual_style_prompt: String(formData.get("visual_style_prompt") ?? "").trim() || null,
    tone_of_voice: String(formData.get("tone_of_voice") ?? "").trim() || null,
    owner_email: String(formData.get("owner_email") ?? "").trim() || null,
    target_posts_per_week: Number(formData.get("target_posts_per_week") ?? 3) || 3,
    branded_hashtags: csvHashtags(String(formData.get("branded_hashtags") ?? "")),
    tracked_hashtags: csvHashtags(String(formData.get("tracked_hashtags") ?? "")),

    // AI Brain
    autoresearch_enabled: formData.get("autoresearch_enabled") === "on",
    autoresearch_cadence: String(formData.get("autoresearch_cadence") ?? "daily"),

    // Email reports
    email_recipients: csv(String(formData.get("email_recipients") ?? "")),
    email_frequency: String(formData.get("email_frequency") ?? "weekly"),
  };

  if (!update.name) return { ok: false, error: "Campaign name is required" };

  const { error } = await sb
    .from("campaigns")
    .update(update)
    .eq("id", existing.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath(`/campaigns/${slug}`);
  revalidatePath(`/campaigns`);
  return { ok: true };
}

/**
 * Convenience wrapper used by the form's action attribute when JS is
 * disabled. Throws on failure so the form shows a server error; redirects
 * to the campaign page on success.
 */
export async function updateCampaignAndRedirect(formData: FormData): Promise<void> {
  const result = await updateCampaignAction(formData);
  if (!result.ok) throw new Error(result.error);
  const slug = String(formData.get("slug") ?? "").trim();
  redirect(`/campaigns/${slug}`);
}
