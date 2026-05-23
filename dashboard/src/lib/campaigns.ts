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
 * Postgres error code "42703" = undefined_column. PostgREST surfaces it
 * in the error.code field on the response.
 */
const PG_UNDEFINED_COLUMN = "42703";

/**
 * True iff the Supabase error indicates the show_on_chooser column
 * doesn't exist yet (migration not applied). We use this to decide
 * whether to retry the legacy SELECT vs surface the error.
 */
function isMissingChooserColumn(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; message?: string };
  return e.code === PG_UNDEFINED_COLUMN
    || (typeof e.message === "string" && e.message.includes("show_on_chooser"));
}

/**
 * Fetch every non-archived campaign, ordered for stable card layout.
 *
 * Fallback strategy:
 *   • Missing show_on_chooser column → retry without it and synthesize
 *     show_on_chooser=false. This only kicks in when the migration in
 *     add_campaign_show_on_chooser.sql hasn't been applied yet.
 *   • Any OTHER error (network, RLS, DB down) → return the static
 *     campaignMeta fallback. We do NOT mutate show_on_chooser to false
 *     for these cases because that would hide legitimately-published
 *     campaigns from the chooser on a transient failure.
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
    if (isMissingChooserColumn(full.error)) {
      // Legacy schema — column not yet migrated. Retry without it.
      const legacy = await sb
        .from("campaigns")
        .select("slug, name, description, image_url, status")
        .neq("status", "archived")
        .order("name", { ascending: true });
      if (!legacy.error && legacy.data) {
        return legacy.data.map((r) => ({ ...r, show_on_chooser: false }) as CampaignRow);
      }
    }
    // Genuine error (RLS, network, transient DB failure). Fall back to
    // the static registry so the 3 known apps stay visible rather than
    // disappearing on a hiccup.
    return staticFallback();
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
    if (isMissingChooserColumn(full.error)) {
      // Legacy schema — retry without show_on_chooser.
      const legacy = await sb
        .from("campaigns")
        .select("slug, name, description, image_url, status")
        .eq("slug", slug)
        .maybeSingle();
      if (!legacy.error && legacy.data) {
        if (legacy.data.status === "archived") return null;
        return { ...legacy.data, show_on_chooser: false } as CampaignRow;
      }
    }
    // Any other failure — fall back to static row for known slugs only.
    return isCampaign(slug) ? staticRow(slug) : null;
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
