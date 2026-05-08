"use server";

/**
 * Server actions for the /campaigns/new form.
 *
 * Two responsibilities:
 *   1. Upload optional hero + CTA images to the campaign-assets storage bucket.
 *   2. Insert the campaigns row, returning the new slug for redirect.
 *
 * All writes use the SSR Supabase client which enforces RLS through the
 * authenticated user's cookie. Anon callers can't reach this action because
 * the (dashboard) layout already gates on auth.
 */

import { createClient } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
}

async function uploadToCampaignAssets(
  file: File,
  slug: string,
  kind: "hero" | "cta",
): Promise<string | null> {
  if (!file || file.size === 0) return null;
  const sb = await createClient();

  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  const path = `${slug}/${kind}-${Date.now()}.${ext}`;
  const { error } = await sb.storage
    .from("campaign-assets")
    .upload(path, file, {
      upsert: true,
      contentType: file.type || "image/png",
    });
  if (error) {
    console.error(`[campaigns/new] ${kind} upload failed:`, error.message);
    return null;
  }

  const { data } = sb.storage.from("campaign-assets").getPublicUrl(path);
  return data.publicUrl;
}

export async function createCampaignAction(formData: FormData): Promise<
  | { ok: true; slug: string }
  | { ok: false; error: string }
> {
  const sb = await createClient();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) return { ok: false, error: "Campaign name is required" };

  const slugInput = String(formData.get("slug") ?? "").trim();
  const slug = slugify(slugInput || name);
  if (!slug) return { ok: false, error: "Could not derive a slug from the name" };

  // Prevent duplicate slugs early — the unique constraint would catch it,
  // but a friendly error beats a Postgres 23505.
  const { data: existing } = await sb
    .from("campaigns")
    .select("id")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) return { ok: false, error: `A campaign with slug "${slug}" already exists` };

  const description = String(formData.get("description") ?? "").trim() || null;
  const status = (String(formData.get("status") ?? "active") as "active" | "paused" | "archived");
  const start_date = String(formData.get("start_date") ?? "").trim() || null;
  const end_date = String(formData.get("end_date") ?? "").trim() || null;
  const visual_style_prompt =
    String(formData.get("visual_style_prompt") ?? "").trim() || null;
  const tone_of_voice = String(formData.get("tone_of_voice") ?? "").trim() || null;
  const owner_email = String(formData.get("owner_email") ?? "").trim() || null;
  const target_posts_per_week = Number(formData.get("target_posts_per_week") ?? 3) || 3;

  // Branded hashtags — comma-separated text, normalised to "#tag" entries.
  const brandedRaw = String(formData.get("branded_hashtags") ?? "");
  const branded_hashtags = brandedRaw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => (s.startsWith("#") ? s : `#${s}`));

  // Image uploads (optional)
  const heroFile = formData.get("hero_image") as File | null;
  const ctaFile = formData.get("cta_image") as File | null;

  const image_url = heroFile && heroFile.size > 0
    ? await uploadToCampaignAssets(heroFile, slug, "hero")
    : null;
  const cta_image_url = ctaFile && ctaFile.size > 0
    ? await uploadToCampaignAssets(ctaFile, slug, "cta")
    : null;

  const { error } = await sb.from("campaigns").insert({
    slug,
    name,
    description,
    status,
    start_date,
    end_date,
    visual_style_prompt,
    tone_of_voice,
    owner_email,
    target_posts_per_week,
    branded_hashtags,
    image_url,
    cta_image_url,
  });

  if (error) {
    console.error("[campaigns/new] insert failed:", error);
    return { ok: false, error: error.message };
  }

  revalidatePath("/campaigns");
  return { ok: true, slug };
}

/**
 * Wrapper that handles the redirect server-side. The form calls THIS, not
 * createCampaignAction, when there's nothing to display in-line afterwards.
 */
export async function createCampaignAndRedirect(formData: FormData): Promise<void> {
  const result = await createCampaignAction(formData);
  if (result.ok) redirect(`/campaigns/${result.slug}`);
  // If it failed, throw so the client-side form can show the message —
  // server actions don't have a built-in error channel for `action=` form
  // attributes, so the caller pattern is to bind useFormState/useActionState
  // around createCampaignAction directly. This wrapper is for happy-path
  // simplicity; callers that need errors use createCampaignAction.
  throw new Error(result.ok ? "unreachable" : result.error);
}
