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
import { assertRole } from "@/lib/auth";

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
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
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

    // Flows — single-select radio. Exactly one is true; weights mirror
    // the same one-hot so any code that still reads flow_weights stays
    // consistent.
    flows_enabled: (() => {
      const raw = String(formData.get("primary_flow") ?? "photorealistic");
      const v = raw === "animated" || raw === "emoji_overlay" ? raw : "photorealistic";
      return {
        photorealistic: v === "photorealistic",
        animated: v === "animated",
        emoji_overlay: v === "emoji_overlay",
      };
    })(),
    flow_weights: (() => {
      const raw = String(formData.get("primary_flow") ?? "photorealistic");
      const v = raw === "animated" || raw === "emoji_overlay" ? raw : "photorealistic";
      return {
        photorealistic: v === "photorealistic" ? 1 : 0,
        animated: v === "animated" ? 1 : 0,
        emoji_overlay: v === "emoji_overlay" ? 1 : 0,
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
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
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
  const auth = await assertRole("admin");
  if (!auth.ok) return auth;
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

// ─── Style training (Phase 17c) ─────────────────────────────────────
//
// Operator uploads up to 25 reference images per campaign. A one-time
// Gemini Vision call distills them into a text style description that's
// injected into every future content/image prompt. No images are sent
// to Gemini at cycle time — the distilled text IS the brain's stored
// learning.

const MAX_TRAINING_IMAGES = 25;

/**
 * Upload one new training image to Supabase Storage and append its
 * public URL to campaigns.training_image_urls. Per-call to keep each
 * upload progress-trackable in the UI; the form fires this once per
 * dropped file.
 *
 * Storage layout: campaign-assets/<slug>/training/<unix-ms>-<random>.<ext>
 *
 * Caller MUST trigger distillCampaignStyle() once after the operator
 * is done uploading — distilling is a separate slow Gemini call that
 * we don't want to fire on every individual upload.
 */
export async function addCampaignTrainingImage(input: {
  slug: string;
  formData: FormData;
}): Promise<{ ok: true; url: string } | { ok: false; error: string }> {
  const file = input.formData.get("file") as File | null;
  if (!file || file.size === 0) return { ok: false, error: "No file provided" };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: "File must be ≤ 10 MB (Supabase bucket limit)" };

  const sb = await createClient();
  const { data: campaign } = await sb
    .from("campaigns")
    .select("id, training_image_urls")
    .eq("slug", input.slug)
    .maybeSingle<{ id: string; training_image_urls: string[] }>();
  if (!campaign) return { ok: false, error: "Campaign not found" };

  const existing = campaign.training_image_urls ?? [];
  if (existing.length >= MAX_TRAINING_IMAGES) {
    return { ok: false, error: `Already at the ${MAX_TRAINING_IMAGES}-image limit. Delete one first.` };
  }

  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${input.slug}/training/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
  const { error: uploadErr } = await sb.storage
    .from("campaign-assets")
    .upload(path, file, { upsert: false, contentType: file.type || "image/png", cacheControl: "31536000" });
  if (uploadErr) return { ok: false, error: uploadErr.message };

  const { data: pub } = sb.storage.from("campaign-assets").getPublicUrl(path);
  const newList = [...existing, pub.publicUrl];

  const { error: updateErr } = await sb
    .from("campaigns")
    .update({ training_image_urls: newList })
    .eq("id", campaign.id);
  if (updateErr) return { ok: false, error: updateErr.message };

  revalidatePath(`/campaigns/${input.slug}/edit`);
  return { ok: true, url: pub.publicUrl };
}

/**
 * Remove one training image from the campaign. Deletes the storage
 * object too so we don't leave orphans behind. Idempotent — passing
 * a URL that's no longer in the array is a no-op.
 */
export async function removeCampaignTrainingImage(input: {
  slug: string;
  url: string;
}): Promise<Result> {
  const sb = await createClient();
  const { data: campaign } = await sb
    .from("campaigns")
    .select("id, training_image_urls")
    .eq("slug", input.slug)
    .maybeSingle<{ id: string; training_image_urls: string[] }>();
  if (!campaign) return { ok: false, error: "Campaign not found" };

  const newList = (campaign.training_image_urls ?? []).filter((u) => u !== input.url);

  const { error: updateErr } = await sb
    .from("campaigns")
    .update({ training_image_urls: newList })
    .eq("id", campaign.id);
  if (updateErr) return { ok: false, error: updateErr.message };

  // Best-effort: also delete the storage object. Extract the path
  // after `/object/public/campaign-assets/` from the public URL.
  const m = input.url.match(/\/object\/public\/campaign-assets\/(.+)$/);
  if (m && m[1]) {
    await sb.storage.from("campaign-assets").remove([decodeURIComponent(m[1])]);
  }

  revalidatePath(`/campaigns/${input.slug}/edit`);
  return { ok: true };
}

/**
 * The "training" step. Sends ALL of the campaign's training images to
 * Gemini 2.5 Flash with a structured vision prompt asking for a
 * detailed style description. Saves the result to
 * campaigns.style_distillation + style_distilled_at.
 *
 * One Gemini call, regardless of image count. Future cycles read the
 * distilled text via getCampaign() — no per-cycle image cost.
 *
 * Returns the distilled text on success so the UI can show it
 * immediately without a re-fetch.
 */
export async function distillCampaignStyle(input: {
  slug: string;
}): Promise<{ ok: true; distillation: string } | { ok: false; error: string }> {
  const sb = await createClient();
  const { data: campaign } = await sb
    .from("campaigns")
    .select("id, name, description, training_image_urls")
    .eq("slug", input.slug)
    .maybeSingle<{ id: string; name: string; description: string | null; training_image_urls: string[] }>();
  if (!campaign) return { ok: false, error: "Campaign not found" };

  const urls = (campaign.training_image_urls ?? []).filter(Boolean);
  if (urls.length === 0) {
    return { ok: false, error: "Upload at least one training image before distilling." };
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return { ok: false, error: "GEMINI_API_KEY missing on the dashboard host." };

  // Fetch each training image as base64. Gemini's multimodal endpoint
  // accepts either inlineData (base64) or fileData (URI) parts; we use
  // inlineData here because Gemini can't fetch our Supabase URLs from
  // the dashboard's network and the storage bucket is public anyway.
  const parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }> = [];
  parts.push({
    text:
      `You are analysing reference images for the "${campaign.name}" brand` +
      (campaign.description ? ` (${campaign.description})` : "") +
      `.\n\n` +
      `Look carefully at all of the following images and produce a SINGLE detailed paragraph (150-300 words) describing the SHARED visual style across them. Cover:\n` +
      `- Colour palette (specific hues, saturation, contrast)\n` +
      `- Lighting and mood (warm/cool, soft/hard, key-light direction)\n` +
      `- Character / subject design (rendering style, proportions, distinctive features)\n` +
      `- Composition and framing (depth of field, viewpoint, negative space)\n` +
      `- Texture and rendering technique (illustration, photorealism, mixed media, etc.)\n` +
      `- Recurring visual motifs or props\n\n` +
      `This paragraph will be appended VERBATIM to every future image-generation prompt for this brand, so be specific and technical — write it as guidance for an image-generation model, not for a human reader. Do NOT mention "the images you provided" or refer to the references; describe the style as standalone instructions.\n\n` +
      `Output the paragraph only. No headings, no bullet points, no preamble.`,
  });

  for (const url of urls) {
    try {
      const resp = await fetch(url);
      if (!resp.ok) {
        return { ok: false, error: `Failed to fetch ${url}: HTTP ${resp.status}` };
      }
      const buf = Buffer.from(await resp.arrayBuffer());
      const mimeType = resp.headers.get("content-type") || "image/png";
      parts.push({ inlineData: { mimeType, data: buf.toString("base64") } });
    } catch (err) {
      return { ok: false, error: `Failed to fetch ${url}: ${(err as Error).message}` };
    }
  }

  const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;
  let distilledText: string;
  try {
    const resp = await fetch(geminiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts }],
        // No responseMimeType — we want plain text, not JSON.
      }),
    });
    if (!resp.ok) {
      const errText = await resp.text();
      return { ok: false, error: `Gemini ${resp.status}: ${errText.slice(0, 300)}` };
    }
    const data = await resp.json();
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!text || typeof text !== "string") {
      return { ok: false, error: "Gemini returned no text response" };
    }
    distilledText = text.trim();
  } catch (err) {
    return { ok: false, error: `Gemini call failed: ${(err as Error).message}` };
  }

  const { error: updateErr } = await sb
    .from("campaigns")
    .update({
      style_distillation: distilledText,
      style_distilled_at: new Date().toISOString(),
    })
    .eq("id", campaign.id);
  if (updateErr) return { ok: false, error: updateErr.message };

  revalidatePath(`/campaigns/${input.slug}/edit`);
  return { ok: true, distillation: distilledText };
}
