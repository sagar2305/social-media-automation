/**
 * Runtime helpers for the `campaigns` table — the source of truth for
 * which campaigns exist. Lets routes accept any DB-active campaign,
 * not just the statically-registered set in cms-schemas (`CAMPAIGNS`).
 *
 * When admin adds a new campaign via /campaigns/new, it appears here
 * the moment its row lands in Supabase — no code change needed.
 */

import { unstable_noStore as noStore } from "next/cache";
import { createClient } from "@/lib/supabase";
import { campaignMeta, isCampaign } from "@/lib/cms-schemas";

/** Subset of the `campaigns` table needed by the creator/admin flows. */
export interface CampaignRow {
  slug: string;
  name: string;
  description: string | null;
  image_url: string | null;
  status: string;
  /** Whether this campaign appears on /welcome/campaign. Maps to
   *  campaigns.show_on_chooser (added by the multi-campaign migration).
   *  False when the column doesn't yet exist (the boss hasn't run the
   *  follow-up SQL), so the chooser falls back to the static defaults
   *  baked into welcome/campaign/page.tsx. */
  show_on_chooser: boolean;
}

/**
 * Fetch every non-archived campaign, ordered for stable card layout.
 * Falls back to the static `campaignMeta` registry when the DB is
 * unreachable so the chooser never goes empty — the visitor still sees
 * the known apps even if Supabase is down.
 *
 * `show_on_chooser` is optional in the SELECT — if the column doesn't
 * exist (migration not yet applied) we retry without it and synthesize
 * the field as false for every row.
 */
export async function listActiveCampaigns(): Promise<CampaignRow[]> {
  noStore();
  try {
    const sb = await createClient();
    const full = await sb
      .from("campaigns")
      .select("slug, name, description, image_url, status, show_on_chooser")
      .neq("status", "archived")
      .order("name", { ascending: true });
    if (!full.error && full.data) {
      return full.data as CampaignRow[];
    }
    // Column missing (or any other error) → retry without show_on_chooser.
    const legacy = await sb
      .from("campaigns")
      .select("slug, name, description, image_url, status")
      .neq("status", "archived")
      .order("name", { ascending: true });
    if (legacy.error || !legacy.data) return staticFallback();
    return legacy.data.map((r) => ({ ...r, show_on_chooser: false }) as CampaignRow);
  } catch {
    return staticFallback();
  }
}

/**
 * Look up a single campaign by slug. Returns null when the campaign
 * doesn't exist or is archived — callers typically `notFound()` in
 * that case. DB failures degrade to the static registry so the
 * 3 known apps keep working when Supabase is down.
 */
export async function getCampaignBySlug(slug: string): Promise<CampaignRow | null> {
  noStore();
  if (!isValidSlugShape(slug)) return null;
  try {
    const sb = await createClient();
    const full = await sb
      .from("campaigns")
      .select("slug, name, description, image_url, status, show_on_chooser")
      .eq("slug", slug)
      .maybeSingle();
    if (!full.error && full.data) {
      if (full.data.status === "archived") return null;
      return full.data as CampaignRow;
    }
    // Column missing or any other error — retry without show_on_chooser.
    const legacy = await sb
      .from("campaigns")
      .select("slug, name, description, image_url, status")
      .eq("slug", slug)
      .maybeSingle();
    if (legacy.error || !legacy.data) {
      return isCampaign(slug) ? staticRow(slug) : null;
    }
    if (legacy.data.status === "archived") return null;
    return { ...legacy.data, show_on_chooser: false } as CampaignRow;
  } catch {
    return isCampaign(slug) ? staticRow(slug) : null;
  }
}

/** Cheap slug validation — anything else can't appear as a real row. */
function isValidSlugShape(slug: string): boolean {
  return /^[a-z0-9][a-z0-9-]{0,59}$/.test(slug);
}

function staticFallback(): CampaignRow[] {
  return (Object.keys(campaignMeta) as Array<keyof typeof campaignMeta>).map(staticRow);
}

function staticRow(slug: keyof typeof campaignMeta): CampaignRow {
  const meta = campaignMeta[slug];
  return {
    slug,
    name: meta.label,
    description: meta.description,
    image_url: meta.appIcon,
    status: "active",
    // The three static defaults are always visible on the chooser.
    show_on_chooser: true,
  };
}
