/**
 * CMS reader — load page content from public.cms_pages with a safe
 * fallback to the baked-in defaults. Safe to call from server components
 * and server actions.
 *
 * Read path:
 *   1. Resolve the (campaign, slug) key — shared slugs (e.g. welcome)
 *      route to the SHARED_CAMPAIGN sentinel regardless of which
 *      campaign the caller passed in.
 *   2. Fetch the row by (campaign, slug).
 *   3. If found, validate with the page's zod schema.
 *   4. On any error (missing row, RLS issue, malformed shape, table not
 *      yet migrated), fall back to the per-campaign default content.
 *
 * Never throws. The creator-facing pages should always render.
 */

import { unstable_noStore as noStore } from "next/cache";
import { createClient } from "@/lib/supabase";
import {
  type CmsSlug,
  type CmsContentFor,
  cmsSchemaBySlug,
  resolveCampaignKey,
} from "@/lib/cms-schemas";
import { defaultsFor } from "@/lib/cms-defaults";

export async function getPageContent<S extends CmsSlug>(
  slug: S,
  campaign: string = "minutewise",
): Promise<CmsContentFor<S>> {
  // Belt-and-braces: every reader is called from a `force-dynamic` route,
  // but `noStore()` makes it impossible for the Next/Turbopack data cache
  // to ever return a stale copy of an admin's edit.
  noStore();

  const fallback = defaultsFor(slug, campaign) as CmsContentFor<S>;
  const campaignKey = resolveCampaignKey(slug, campaign);

  try {
    const sb = await createClient();
    const { data, error } = await sb
      .from("cms_pages")
      .select("content")
      .eq("campaign", campaignKey)
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      console.warn(`[cms] getPageContent(${campaign}/${slug}) supabase error:`, error.message);
      return fallback;
    }
    if (!data) return fallback;

    const schema = cmsSchemaBySlug[slug];
    const parsed = schema.safeParse(data.content);
    if (!parsed.success) {
      console.warn(
        `[cms] getPageContent(${campaign}/${slug}) parse failed — falling back to defaults. Issues:`,
        parsed.error.issues,
      );
      return fallback;
    }
    return parsed.data as CmsContentFor<S>;
  } catch (e) {
    console.warn(`[cms] getPageContent(${campaign}/${slug}) threw:`, e);
    return fallback;
  }
}

/**
 * Convenience wrapper used by the admin editor. Returns both the saved
 * content (if any) and a flag so the UI can communicate "you're editing
 * the factory defaults — nothing is saved yet."
 */
export async function getPageContentForEditor<S extends CmsSlug>(
  slug: S,
  campaign: string = "minutewise",
): Promise<{ content: CmsContentFor<S>; isDefault: boolean; updatedAt: string | null }> {
  noStore();

  const fallback = defaultsFor(slug, campaign) as CmsContentFor<S>;
  const campaignKey = resolveCampaignKey(slug, campaign);

  try {
    const sb = await createClient();
    const { data, error } = await sb
      .from("cms_pages")
      .select("content, updated_at")
      .eq("campaign", campaignKey)
      .eq("slug", slug)
      .maybeSingle();

    if (error) {
      console.warn(`[cms] getPageContentForEditor(${campaign}/${slug}) supabase error:`, error.message);
      return { content: fallback, isDefault: true, updatedAt: null };
    }
    if (!data) return { content: fallback, isDefault: true, updatedAt: null };

    const schema = cmsSchemaBySlug[slug];
    const parsed = schema.safeParse(data.content);
    if (!parsed.success) {
      console.warn(
        `[cms] getPageContentForEditor(${campaign}/${slug}) parse failed — editor will show defaults. Issues:`,
        parsed.error.issues,
      );
      return { content: fallback, isDefault: true, updatedAt: data.updated_at as string };
    }

    return {
      content: parsed.data as CmsContentFor<S>,
      isDefault: false,
      updatedAt: data.updated_at as string,
    };
  } catch (e) {
    console.warn(`[cms] getPageContentForEditor(${campaign}/${slug}) threw:`, e);
    return { content: fallback, isDefault: true, updatedAt: null };
  }
}
