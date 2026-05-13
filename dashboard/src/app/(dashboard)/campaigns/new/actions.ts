"use server";

/**
 * Server actions for the /campaigns/new form.
 *
 * Three responsibilities:
 *   1. Upload optional hero + CTA images to the campaign-assets storage bucket.
 *   2. Insert the campaigns row, returning the new slug for redirect.
 *   3. Pre-create the per-campaign data directory at
 *      data/campaigns/<slug>/ with the seven standard markdown files
 *      (POST-TRACKER, FORMAT-WINNERS, etc). The cycle expects these to
 *      exist — without them, the first post to a brand-new campaign
 *      throws ENOENT inside trackPost and the cycle reports
 *      "0 submissions completed" with no visible reason. Pre-creating
 *      them at create time means a fresh campaign is immediately ready
 *      to run.
 *
 * All writes use the SSR Supabase client which enforces RLS through the
 * authenticated user's cookie. Anon callers can't reach this action because
 * the (dashboard) layout already gates on auth.
 */

import { createClient } from "@/lib/supabase";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { upsertCampaignPayoutConfig } from "../../payouts/actions";
import {
  draftToUpsertPayload,
  type PayoutConfigDraft,
} from "@/components/payout-config-fields";

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
  /** Path prefix under `<slug>/`. Single keys (`"hero"`, `"cta"`) become
   *  `<slug>/hero-<ts>.<ext>`; nested paths (`"training/<ts>-<i>"`)
   *  become `<slug>/training/<ts>-<i>.<ext>` so training images land in
   *  their own subfolder for tidy storage management. */
  kind: string,
): Promise<string | null> {
  if (!file || file.size === 0) return null;
  const sb = await createClient();

  const ext = (file.name.split(".").pop() || "png").toLowerCase();
  // For nested kinds we don't need an extra `-<ts>` suffix because the
  // caller already includes a unique element in the kind string.
  const path = kind.includes("/")
    ? `${slug}/${kind}.${ext}`
    : `${slug}/${kind}-${Date.now()}.${ext}`;
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
  | { ok: true; slug: string; warning?: string }
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

  // Single-flow per campaign — picked at creation, used by every
  // cycle and batch for this campaign. Defaults to photorealistic
  // when the form omits it (e.g. unit tests, programmatic creates).
  const primaryFlowRaw = String(formData.get("primary_flow") ?? "photorealistic").trim();
  const validFlows = ["photorealistic", "animated", "emoji_overlay"] as const;
  type FlowName = typeof validFlows[number];
  const primaryFlow: FlowName = (validFlows as readonly string[]).includes(primaryFlowRaw)
    ? (primaryFlowRaw as FlowName)
    : "photorealistic";
  const flows_enabled = {
    photorealistic: primaryFlow === "photorealistic",
    animated: primaryFlow === "animated",
    emoji_overlay: primaryFlow === "emoji_overlay",
  };
  // Flow weights collapse to a one-hot encoding mirroring flows_enabled
  // so any downstream code that still consults weights agrees with the
  // single-flow story.
  const flow_weights = {
    photorealistic: primaryFlow === "photorealistic" ? 1 : 0,
    animated: primaryFlow === "animated" ? 1 : 0,
    emoji_overlay: primaryFlow === "emoji_overlay" ? 1 : 0,
  };
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

  // Training images — multipart files under "training_images". The
  // dashboard form caps this at 15 (engine schema allows up to 25;
  // remainder is added on the Edit page after creation). We DON'T
  // distill here — that's a deliberate user click on the Edit page so
  // they can upload the full set first and pay the Gemini Vision call
  // exactly once.
  const trainingFiles = formData.getAll("training_images")
    .filter((v): v is File => v instanceof File && v.size > 0);
  const training_image_urls: string[] = [];
  for (let i = 0; i < trainingFiles.length; i++) {
    const url = await uploadToCampaignAssets(trainingFiles[i], slug, `training/${Date.now()}-${i}`);
    if (url) training_image_urls.push(url);
  }

  const { data: created, error } = await sb
    .from("campaigns")
    .insert({
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
      training_image_urls,
      flows_enabled,
      flow_weights,
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !created) {
    console.error("[campaigns/new] insert failed:", error);
    return { ok: false, error: error?.message ?? "Insert failed" };
  }

  // Payout config (optional). The form ships it as a single JSON
  // blob under `payout_config_json` regardless of whether the user
  // touched the section — mode='none' is the no-op state. Skip the
  // upsert entirely for 'none' to avoid littering campaign_payout_configs
  // with empty rows. On validation/insert failure we don't roll back
  // the campaign — the manager can fix it on the Edit page, which
  // we surface as a `warning` in the success payload.
  let payoutWarning: string | undefined;
  const payoutRaw = String(formData.get("payout_config_json") ?? "").trim();
  if (payoutRaw) {
    let draft: PayoutConfigDraft | null = null;
    try {
      draft = JSON.parse(payoutRaw) as PayoutConfigDraft;
    } catch (e) {
      payoutWarning = `Payout config didn't save (couldn't parse form payload). Set it on the campaign's Edit page.`;
    }
    if (draft && draft.mode !== "none") {
      const r = await upsertCampaignPayoutConfig({
        campaign_id: created.id,
        ...draftToUpsertPayload(draft),
      });
      if (!r.ok) {
        payoutWarning = `Campaign created, but payout config didn't save: ${r.error}. Fix it on the Edit page.`;
      }
    }
  }

  // Best-effort: pre-create the per-campaign data dir + standard files
  // so the first cycle doesn't trip ENOENT inside post_to_tiktok's
  // trackPost. Wrapped in try/catch — a filesystem failure here must
  // NOT block the campaign-creation user flow (the dashboard runs on
  // Vercel/host where /Users/aditya/... isn't writable; the engine on
  // the Mac mini will create the dir on-demand via post_to_tiktok's
  // ensureDir as a backup).
  try {
    await scaffoldCampaignDataDir(slug, name);
  } catch (e) {
    console.warn("[campaigns/new] data dir scaffold skipped:", (e as Error).message);
  }

  revalidatePath("/campaigns");
  return { ok: true, slug, warning: payoutWarning };
}

/**
 * Create data/campaigns/<slug>/ on disk with the seven standard files
 * the engine reads/writes during a cycle. Files are seeded with empty
 * skeletons that match the format the pipeline scripts expect (markdown
 * tables, JSON object). Idempotent — re-running on an existing dir
 * leaves any populated files alone (only writes when absent).
 */
async function scaffoldCampaignDataDir(slug: string, name: string): Promise<void> {
  // Resolve up to repo root from the dashboard's CWD. The dashboard
  // runs under dashboard/ so we go ../data/campaigns/<slug>.
  const dir = resolve(process.cwd(), "..", "data", "campaigns", slug);
  await mkdir(dir, { recursive: true });

  const seeds: Record<string, string> = {
    "POST-TRACKER.md":
      `# Post Tracker — ${name}\n\n` +
      `_Auto-generated when the cycle posts. New rows get appended here._\n\n` +
      `| Post ID | Date | Hook | Format | Hashtags | Views | Likes | Saves | Shares | Comments | Save Rate | Status | TikTok URL |\n` +
      `|---------|------|------|--------|----------|-------|-------|-------|--------|----------|-----------|--------|------------|\n`,
    "FORMAT-WINNERS.md":
      `# Format Winners — ${name}\n\n_Will be populated by the optimizer after the first cycle of data._\n`,
    "HASHTAG-BANK.md":
      `# Hashtag Bank — ${name}\n\n_Will be populated on the next research run._\n`,
    "LESSONS-LEARNED.md":
      `# Lessons Learned — ${name}\n\n_Rolling 7-day insights will appear here after the optimizer runs._\n`,
    "EXPERIMENT-LOG.md":
      `# Experiment Log — ${name}\n\n## Active Experiment\nNone yet.\n\n## Completed Experiments\n_None yet._\n`,
    "TRENDING-NOW.md":
      `# Trending Now — ${name}\n\n_Will be populated by the next research run (Virlo)._\n`,
    "results.tsv":
      `experiment_id\tcreated_at\tflow\thook\tposts\tsave_rate\twinner\n`,
  };

  // Only write when absent — never clobber populated files.
  for (const [fname, body] of Object.entries(seeds)) {
    const fp = resolve(dir, fname);
    try {
      const { stat } = await import("node:fs/promises");
      await stat(fp); // exists, skip
    } catch {
      await writeFile(fp, body);
    }
  }
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
