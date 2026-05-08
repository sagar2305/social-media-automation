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

/**
 * Parse a paired-list textarea where each line is either:
 *   "Label | https://example.com"
 *   "https://example.com"   (label omitted — URL doubles as label)
 * Returns an array of {label, url} ready for the resources jsonb columns.
 */
function parseResourceLines(input: string | undefined): Array<{ label: string; url: string }> {
  if (!input) return [];
  const out: Array<{ label: string; url: string }> = [];
  for (const raw of input.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const pipe = line.indexOf("|");
    if (pipe > 0) {
      const label = line.slice(0, pipe).trim();
      const url = line.slice(pipe + 1).trim();
      if (url) out.push({ label: label || url, url });
    } else {
      out.push({ label: line, url: line });
    }
  }
  return out;
}

/** Clamp + normalise a weight number to [0, 1]. */
function weight(input: FormDataEntryValue | null): number {
  const n = Number(input ?? 0);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(1, n));
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

    // Flows — three on/off checkboxes plus weight numbers. We renormalise
    // weights so they sum to 1.0 even if the operator typed values that
    // don't add up; otherwise the cycle's flow distribution math gets
    // weird ('weight=2' giving twice-as-many photoreal posts unintentionally).
    flows_enabled: {
      photorealistic: formData.get("flow_photorealistic_enabled") === "on",
      animated:       formData.get("flow_animated_enabled") === "on",
      emoji_overlay:  formData.get("flow_emoji_overlay_enabled") === "on",
    },
    flow_weights: (() => {
      const raw = {
        photorealistic: weight(formData.get("flow_photorealistic_weight")),
        animated:       weight(formData.get("flow_animated_weight")),
        emoji_overlay:  weight(formData.get("flow_emoji_overlay_weight")),
      };
      const sum = raw.photorealistic + raw.animated + raw.emoji_overlay;
      if (sum <= 0) return { photorealistic: 0.34, animated: 0.33, emoji_overlay: 0.33 };
      return {
        photorealistic: raw.photorealistic / sum,
        animated:       raw.animated / sum,
        emoji_overlay:  raw.emoji_overlay / sum,
      };
    })(),

    // Post Alerts — Slack/Discord webhooks + milestone thresholds.
    slack_webhook:   String(formData.get("slack_webhook") ?? "").trim() || null,
    discord_webhook: String(formData.get("discord_webhook") ?? "").trim() || null,
    milestone_thresholds: csv(String(formData.get("milestone_thresholds") ?? ""))
      .map((s) => parseInt(s.replace(/[^\d]/g, ""), 10))
      .filter((n) => Number.isFinite(n) && n > 0)
      .sort((a, b) => a - b),

    // Resources — newline-separated 'Label | URL' pairs.
    external_resources: parseResourceLines(String(formData.get("external_resources") ?? "")),
    internal_resources: parseResourceLines(String(formData.get("internal_resources") ?? "")),
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

// ─── Danger zone ────────────────────────────────────────────────────

/**
 * Soft-delete: set campaigns.status = 'archived'. The campaign hides
 * from the default /campaigns list and the top-bar filter, but every
 * row in posts/accounts/etc. that references it stays put. Reversible
 * — the operator can flip status back to 'active' from the same form.
 */
export async function archiveCampaign(input: { slug: string }): Promise<Result> {
  const sb = await createClient();
  const { error } = await sb
    .from("campaigns")
    .update({ status: "archived" })
    .eq("slug", input.slug);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/campaigns");
  revalidatePath(`/campaigns/${input.slug}`);
  return { ok: true };
}

/**
 * Hard-delete: removes the campaigns row entirely. FKs are mostly
 * ON DELETE SET NULL (Phase 1) so:
 *   - posts, accounts, cycle_batches, experiments, format_rankings,
 *     autoresearch_runs, share_links → become orphaned
 *     (campaign_id = NULL). Their data is preserved.
 *   - email_reports_log → CASCADE deleted (Phase 16). Send history
 *     for this campaign goes away with the row.
 *
 * The local data files at data/campaigns/<slug>/ stay on disk; that's
 * intentional so the operator can recover them by recreating the
 * campaign with the same slug if they regret the delete.
 *
 * Caller MUST confirm by passing the literal campaign name as
 * typedName — gates against finger-slip on a button.
 */
export async function deleteCampaign(input: {
  slug: string;
  typedName: string;
}): Promise<Result> {
  const sb = await createClient();

  // Re-read the campaign to compare against typedName server-side.
  // Don't trust the client's name passed back — the URL slug is the
  // single source of truth.
  const { data: campaign } = await sb
    .from("campaigns")
    .select("id, name")
    .eq("slug", input.slug)
    .maybeSingle<{ id: string; name: string }>();
  if (!campaign) return { ok: false, error: "Campaign not found" };

  if (input.typedName.trim() !== campaign.name) {
    return {
      ok: false,
      error: `Type the campaign name exactly to confirm: "${campaign.name}"`,
    };
  }

  const { error } = await sb.from("campaigns").delete().eq("id", campaign.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/campaigns");
  return { ok: true };
}
