"use server";

/**
 * Server actions for the Signup Control admin CMS.
 *
 *   • savePageContent(slug, content)   — validate + upsert + snapshot
 *   • uploadCmsImage(formData)         — file → Supabase Storage → URL
 *   • listVersions(slug)               — recent snapshots
 *   • restoreVersion(versionId)        — load a snapshot back into live
 */

import { revalidatePath } from "next/cache";
import { assertRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase";
import {
  cmsSchemaBySlug,
  cmsPageMeta,
  type CmsSlug,
} from "@/lib/cms-schemas";
import { cmsDefaults } from "@/lib/cms-defaults";
import { setAtPath, type Path } from "@/lib/cms-inline-helpers";

type Result<T = undefined> =
  | (T extends undefined ? { ok: true } : { ok: true; data: T })
  | { ok: false; error: string };

const CMS_BUCKET = "cms-uploads";

async function bumpRevalidatePaths(slug: CmsSlug) {
  revalidatePath(cmsPageMeta[slug].livePath, "layout");
  revalidatePath("/signup-control", "layout");
  revalidatePath(`/signup-control/${slug}`, "layout");
  if (slug === "auth-form") {
    revalidatePath("/creator/login", "layout");
    revalidatePath("/creator/signup", "layout");
  }
}

export async function savePageContent(
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

  const sb = await createClient();

  // 1. Snapshot the CURRENT content into cms_page_versions BEFORE updating
  //    cms_pages. If this is the first save (no row yet) we skip the
  //    snapshot — there's nothing to preserve.
  const { data: existing } = await sb
    .from("cms_pages")
    .select("content")
    .eq("slug", slug)
    .maybeSingle();
  if (existing) {
    await sb.from("cms_page_versions").insert({
      slug,
      content: existing.content,
      saved_by: auth.user.id,
    });
  }

  // 2. Upsert the new content.
  const { error } = await sb
    .from("cms_pages")
    .upsert(
      { slug, content: parsed.data, updated_by: auth.user.id },
      { onConflict: "slug" },
    );

  if (error) return { ok: false, error: error.message };

  await bumpRevalidatePaths(slug);
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

export async function listVersions(slug: CmsSlug): Promise<Result<VersionRow[]>> {
  const auth = await assertRole("admin");
  if (!auth.ok) return { ok: false, error: auth.error };

  const sb = await createClient();
  const { data, error } = await sb
    .from("cms_page_versions")
    .select("id, saved_at, saved_by")
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

export async function getVersionContent(versionId: number): Promise<Result<{ slug: CmsSlug; content: unknown }>> {
  const auth = await assertRole("admin");
  if (!auth.ok) return { ok: false, error: auth.error };

  const sb = await createClient();
  const { data, error } = await sb
    .from("cms_page_versions")
    .select("slug, content")
    .eq("id", versionId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Version not found." };
  return { ok: true, data: { slug: data.slug as CmsSlug, content: data.content } };
}

/**
 * Granular field update — used by the inline `<Editable>` UI on the
 * live creator pages. Reads the current row (or falls back to the
 * baked-in defaults if none exists yet), applies the path update,
 * re-validates the whole blob, snapshots the previous content into
 * cms_page_versions, then upserts and revalidates.
 *
 *   updateCmsField("brief", ["hero", "heading"], "New title")
 *   updateCmsField("brief", ["faq", "items", 2, "q"], "Updated question")
 *
 * The "whole blob is re-validated on every field write" is intentional:
 * it guarantees the row in cms_pages always satisfies the page's zod
 * schema, so getPageContent can never end up rendering defaults because
 * a previous partial-write left the row in a broken state.
 */
export async function updateCmsField(
  slug: CmsSlug,
  path: Path,
  value: unknown,
): Promise<Result> {
  const auth = await assertRole("admin");
  if (!auth.ok) return { ok: false, error: auth.error };

  if (!Array.isArray(path) || path.length === 0) {
    return { ok: false, error: "Path must be a non-empty array." };
  }

  const sb = await createClient();
  const { data: existing } = await sb
    .from("cms_pages")
    .select("content")
    .eq("slug", slug)
    .maybeSingle();

  // Start from the saved row when present, otherwise from the defaults.
  // Either way, after setAtPath the result must satisfy the schema.
  const baseline =
    existing?.content ?? (cmsDefaults[slug] as unknown);

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
      slug,
      content: existing.content,
      saved_by: auth.user.id,
    });
  }

  const { error: upErr } = await sb
    .from("cms_pages")
    .upsert(
      { slug, content: parsed.data, updated_by: auth.user.id },
      { onConflict: "slug" },
    );
  if (upErr) return { ok: false, error: upErr.message };

  await bumpRevalidatePaths(slug);
  return { ok: true };
}
