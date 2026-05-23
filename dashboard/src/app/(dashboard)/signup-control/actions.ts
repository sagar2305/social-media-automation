"use server";

/**
 * Server actions for the Signup Control admin CMS.
 *
 *   • savePageContent(campaign, slug, content)   — validate + upsert + snapshot
 *   • updateCmsField(campaign, slug, path, value) — granular path update
 *   • uploadCmsImage(formData)                    — file → Supabase Storage → URL
 *   • listVersions(campaign, slug)                — recent snapshots
 *   • restoreVersion(versionId)                   — load a snapshot back into live
 *
 * The cms_pages / cms_page_versions tables are keyed by (campaign, slug)
 * so a single slug can store different content per campaign. Shared
 * slugs (e.g. `welcome`) are stored under the SHARED_CAMPAIGN sentinel
 * — callers can pass any campaign and resolveCampaignKey() routes them
 * to the right row.
 */

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase";
import {
  cmsSchemaBySlug,
  cmsPageMeta,
  type CmsSlug,
  resolveCampaignKey,
  slugScope,
} from "@/lib/cms-schemas";
import { defaultsFor } from "@/lib/cms-defaults";
import { setAtPath, type Path } from "@/lib/cms-inline-helpers";

type Result<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

const CMS_BUCKET = "cms-uploads";

/**
 * Invalidate the caches for every URL that renders this slug.
 *
 * Per-campaign slugs invalidate the campaign-scoped URL plus (for
 * `minutewise`) the legacy redirect URL. The `welcome` slug is shared
 * across campaigns, so it invalidates the single welcome URL.
 */
async function bumpRevalidatePaths(slug: CmsSlug, campaign: string) {
  if (slugScope[slug] === "shared") {
    revalidatePath(cmsPageMeta[slug].livePath, "layout");
  } else if (slug === "campaign-theme") {
    // The theme cascades from the (creator)/[campaign] LAYOUT down to
    // every page under it. Revalidate each of the 4 pages so the new
    // CSS-variable scope re-applies on next visit. Plus the chooser at
    // /welcome/campaign (which previews each card's theme).
    revalidatePath(`/creator/${campaign}/brief`, "layout");
    revalidatePath(`/creator/${campaign}/setup/tiktok`, "layout");
    revalidatePath(`/creator/${campaign}/login`, "layout");
    revalidatePath(`/creator/${campaign}/signup`, "layout");
    revalidatePath("/welcome/campaign", "layout");
  } else {
    revalidatePath(`/creator/${campaign}/${pathSegmentForSlug(slug)}`, "layout");
    if (slug === "auth-form") {
      revalidatePath(`/creator/${campaign}/login`, "layout");
      revalidatePath(`/creator/${campaign}/signup`, "layout");
    }
    if (campaign === "minutewise") {
      // The pre-multi-campaign URLs redirect to the Minutewise routes —
      // keep them invalidated too so old bookmarks rendering legacy
      // routes never serve stale content.
      revalidatePath(cmsPageMeta[slug].livePath, "layout");
      if (slug === "auth-form") {
        revalidatePath("/creator/login", "layout");
        revalidatePath("/creator/signup", "layout");
      }
    }
  }
  revalidatePath("/signup-control", "layout");
  revalidatePath(`/signup-control/${campaign}`, "layout");
  revalidatePath(`/signup-control/${campaign}/${slug}`, "layout");
}

/** Map a CMS slug to the path segment used in /creator/<campaign>/<segment>. */
function pathSegmentForSlug(slug: CmsSlug): string {
  switch (slug) {
    case "brief": return "brief";
    case "tiktok-setup": return "setup/tiktok";
    case "auth-form": return "signup"; // signup is the canonical auth path
    case "welcome": return "";
    // Theme has no own URL; bumpRevalidatePaths handles it explicitly
    // before this switch is consulted, so this branch is unreachable
    // but kept for type exhaustiveness.
    case "campaign-theme": return "brief";
  }
}

export async function savePageContent(
  campaign: string,
  slug: CmsSlug,
  content: unknown,
): Promise<Result> {
  const auth = await assertRole("admin");
  if (!auth.ok) return { ok: false, error: auth.error };

  const schema = cmsSchemaBySlug[slug];
  const parsed = schema.safeParse(content);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const path = first?.path?.join(".") || "(root)";
    return { ok: false, error: `Invalid content at ${path}: ${first?.message ?? "unknown"}` };
  }

  const campaignKey = resolveCampaignKey(slug, campaign);
  const sb = await createClient();

  // 1. Snapshot the CURRENT content into cms_page_versions BEFORE updating
  //    cms_pages. If this is the first save (no row yet) we skip the
  //    snapshot — there's nothing to preserve.
  const { data: existing } = await sb
    .from("cms_pages")
    .select("content")
    .eq("campaign", campaignKey)
    .eq("slug", slug)
    .maybeSingle();
  if (existing) {
    await sb.from("cms_page_versions").insert({
      campaign: campaignKey,
      slug,
      content: existing.content,
      saved_by: auth.user.id,
    });
  }

  // 2. Upsert the new content.
  const { error } = await sb
    .from("cms_pages")
    .upsert(
      { campaign: campaignKey, slug, content: parsed.data, updated_by: auth.user.id },
      { onConflict: "campaign,slug" },
    );

  if (error) return { ok: false, error: error.message };

  await bumpRevalidatePaths(slug, campaign);
  return { ok: true };
}

/**
 * Upload an image to Supabase Storage (`cms-uploads` bucket) and return
 * the public URL. The bucket is public-read; writes are gated by this
 * server action's admin check, not by RLS.
 */
export async function uploadCmsImage(formData: FormData): Promise<Result<{ url: string }>> {
  const auth = await assertRole("admin");
  if (!auth.ok) return { ok: false, error: auth.error };

  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false, error: "No file provided." };
  if (file.size > 10 * 1024 * 1024) return { ok: false, error: "File exceeds 10MB limit." };

  const ext = (file.name.match(/\.[a-z0-9]+$/i)?.[0] || "").toLowerCase() || ".bin";
  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const path = `${auth.user.id}/${stamp}${ext}`;

  const sb = await createClient();
  const { error: uploadErr } = await sb.storage.from(CMS_BUCKET).upload(path, file, {
    upsert: false,
    contentType: file.type || undefined,
    cacheControl: "31536000",
  });
  if (uploadErr) return { ok: false, error: uploadErr.message };

  const { data: pub } = sb.storage.from(CMS_BUCKET).getPublicUrl(path);
  return { ok: true, data: { url: pub.publicUrl } };
}

export interface VersionRow {
  id: number;
  saved_at: string;
  saved_by: string | null;
  saved_by_email: string | null;
}

export async function listVersions(
  campaign: string,
  slug: CmsSlug,
): Promise<Result<VersionRow[]>> {
  const auth = await assertRole("admin");
  if (!auth.ok) return { ok: false, error: auth.error };

  const campaignKey = resolveCampaignKey(slug, campaign);
  const sb = await createClient();
  const { data, error } = await sb
    .from("cms_page_versions")
    .select("id, saved_at, saved_by")
    .eq("campaign", campaignKey)
    .eq("slug", slug)
    .order("saved_at", { ascending: false })
    .limit(15);
  if (error) return { ok: false, error: error.message };

  // Best-effort email lookup. profiles table has the role + email mapping.
  const userIds = Array.from(new Set((data ?? []).map((r) => r.saved_by).filter(Boolean))) as string[];
  const emails = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: profiles } = await sb.from("profiles").select("id, email").in("id", userIds);
    if (profiles) for (const p of profiles) emails.set(p.id as string, p.email as string);
  }

  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      id: r.id as number,
      saved_at: r.saved_at as string,
      saved_by: (r.saved_by as string | null) ?? null,
      saved_by_email: r.saved_by ? emails.get(r.saved_by as string) ?? null : null,
    })),
  };
}

/**
 * Fetch a single version snapshot for restore.
 *
 * The (campaign, slug) the editor is currently scoped to MUST be
 * passed in so the server can reject a stale or cross-campaign
 * version id. Without this guard, an admin editing /signup-control/
 * roastai/brief who somehow obtains a Minutewise version id (URL
 * paste, stale React state, devtools) could call restore and have the
 * Minutewise content land in the Roast AI row on the next Save.
 */
export async function getVersionContent(
  versionId: number,
  campaign: string,
  slug: CmsSlug,
): Promise<Result<{ campaign: string; slug: CmsSlug; content: unknown }>> {
  const auth = await assertRole("admin");
  if (!auth.ok) return { ok: false, error: auth.error };

  const expectedCampaign = resolveCampaignKey(slug, campaign);
  const sb = await createClient();
  const { data, error } = await sb
    .from("cms_page_versions")
    .select("campaign, slug, content")
    .eq("id", versionId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Version not found." };

  const rowCampaign = data.campaign as string;
  const rowSlug = data.slug as CmsSlug;
  if (rowCampaign !== expectedCampaign || rowSlug !== slug) {
    // Don't reveal which campaign the version actually belongs to.
    return {
      ok: false,
      error: "That version doesn't belong to this editor. Refresh the history list and try again.",
    };
  }

  return { ok: true, data: { campaign: rowCampaign, slug: rowSlug, content: data.content } };
}

/**
 * Granular field update — used by the inline `<Editable>` UI on the
 * live creator pages. Reads the current row (or falls back to the
 * baked-in defaults if none exists yet), applies the path update,
 * re-validates the whole blob, snapshots the previous content into
 * cms_page_versions, then upserts and revalidates.
 *
 *   updateCmsField("minutewise", "brief", ["hero", "heading"], "New title")
 *   updateCmsField("roastai",    "brief", ["faq", "items", 2, "q"], "Updated question")
 *
 * The "whole blob is re-validated on every field write" is intentional:
 * it guarantees the row in cms_pages always satisfies the page's zod
 * schema, so getPageContent can never end up rendering defaults because
 * a previous partial-write left the row in a broken state.
 */
export async function updateCmsField(
  campaign: string,
  slug: CmsSlug,
  path: Path,
  value: unknown,
): Promise<Result> {
  const auth = await assertRole("admin");
  if (!auth.ok) return { ok: false, error: auth.error };

  if (!Array.isArray(path) || path.length === 0) {
    return { ok: false, error: "Path must be a non-empty array." };
  }

  const campaignKey = resolveCampaignKey(slug, campaign);
  const sb = await createClient();
  const { data: existing } = await sb
    .from("cms_pages")
    .select("content")
    .eq("campaign", campaignKey)
    .eq("slug", slug)
    .maybeSingle();

  // Start from the saved row when present, otherwise from the defaults.
  // Either way, after setAtPath the result must satisfy the schema.
  const baseline =
    existing?.content ?? (defaultsFor(slug, campaign) as unknown);

  let nextContent: unknown;
  try {
    nextContent = setAtPath(baseline, path, value);
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }

  const schema = cmsSchemaBySlug[slug];
  const parsed = schema.safeParse(nextContent);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    const p = first?.path?.join(".") || "(root)";
    return { ok: false, error: `Invalid at ${p}: ${first?.message ?? "unknown"}` };
  }

  // Snapshot the OLD content (or undefined if it's the first write).
  if (existing?.content !== undefined) {
    await sb.from("cms_page_versions").insert({
      campaign: campaignKey,
      slug,
      content: existing.content,
      saved_by: auth.user.id,
    });
  }

  const { error: upErr } = await sb
    .from("cms_pages")
    .upsert(
      { campaign: campaignKey, slug, content: parsed.data, updated_by: auth.user.id },
      { onConflict: "campaign,slug" },
    );
  if (upErr) return { ok: false, error: upErr.message };

  await bumpRevalidatePaths(slug, campaign);
  return { ok: true };
}


/**
 * Toggle whether a campaign appears on /welcome/campaign.
 *
 * Writes the new value to public.campaigns.show_on_chooser (added by
 * the migration in dashboard/migrations/add_campaign_show_on_chooser.sql).
 * If the column is missing (migration not yet run) the action returns
 * a friendly error so the operator can resolve it instead of silently
 * doing nothing.
 *
 * Revalidates both /signup-control (so the toggle pill on the tile
 * re-renders) and /welcome/campaign (so the chooser updates instantly
 * for any visitor refreshing the page).
 */
export async function setChooserVisibility(
  slug: string,
  show: boolean,
): Promise<Result<{ show: boolean }>> {
  const auth = await assertRole("admin");
  if (!auth.ok) return { ok: false, error: auth.error };

  const sb = await createClient();
  const { error } = await sb
    .from("campaigns")
    .update({ show_on_chooser: show })
    .eq("slug", slug);

  if (error) {
    if (error.message?.includes("show_on_chooser")) {
      return {
        ok: false,
        error: "Migration missing: run dashboard/migrations/add_campaign_show_on_chooser.sql in Supabase, then try again.",
      };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/signup-control", "layout");
  revalidatePath("/welcome/campaign", "layout");
  return { ok: true, data: { show } };
}
