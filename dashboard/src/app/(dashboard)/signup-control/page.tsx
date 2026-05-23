/**
 * /signup-control — top-level admin chooser for the CMS.
 *
 * Step 1: pick which campaign to edit (Minutewise, Roast AI, Call
 * Recorder). Each card shows the count of pages that have saved rows
 * for that campaign, and links to /signup-control/<campaign> where
 * the 4 editors (Brief, TikTok Setup, Welcome, Auth Form) live.
 *
 * Admin-gated via requireRole. The Welcome editor is shared across
 * campaigns and is reachable from each campaign's tile picker.
 */

import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { listActiveCampaigns } from "@/lib/campaigns";
import { campaignMeta, isCampaign } from "@/lib/cms-schemas";
import { FileEdit, ArrowUpRight, CheckCircle2 } from "lucide-react";
import { ChooserToggle } from "./chooser-toggle";

export const dynamic = "force-dynamic";

interface CampaignTile {
  slug: string;
  label: string;
  description: string;
  appIcon: string;
  savedSlugCount: number;
  lastUpdated: string | null;
  /** Whether this campaign currently appears on /welcome/campaign. */
  showOnChooser: boolean;
}

/** Fallback icon for DB-only campaigns that haven't uploaded one. */
const GENERIC_APP_ICON = "/app-icons/generic.svg";

export default async function SignupControlPage() {
  await requireRole("admin");

  // The campaign list is DB-driven so a campaign added via
  // /campaigns/new appears here automatically — admin can edit its
  // creator-onboarding copy without a code change.
  const campaigns = await listActiveCampaigns();

  // Bulk-fetch per-campaign save counts so each tile can show how
  // many of its 4 pages have been edited (Brief/TikTok/Welcome/Auth).
  const sb = await createClient();
  const savedByCampaign = new Map<string, { count: number; lastUpdated: string | null }>();
  try {
    const { data } = await sb
      .from("cms_pages")
      .select("campaign, updated_at");
    if (data) {
      for (const row of data) {
        const key = (row.campaign as string) ?? "minutewise";
        const acc = savedByCampaign.get(key) ?? { count: 0, lastUpdated: null };
        acc.count += 1;
        const ts = row.updated_at as string;
        if (!acc.lastUpdated || (ts && ts > acc.lastUpdated)) acc.lastUpdated = ts;
        savedByCampaign.set(key, acc);
      }
    }
  } catch {
    // Table may not exist yet — fine, tiles show zero saves.
  }

  const tiles: CampaignTile[] = campaigns.map((row) => {
    // Known apps prefer the static fallback name/description/icon when
    // the DB column is empty; brand-new campaigns surface the admin's
    // typed name + description from /campaigns/new.
    const fallback = isCampaign(row.slug) ? campaignMeta[row.slug] : null;
    const saved = savedByCampaign.get(row.slug) ?? { count: 0, lastUpdated: null };
    return {
      slug: row.slug,
      label: row.name || fallback?.label || row.slug,
      description: row.description || fallback?.description || "Creator program",
      appIcon: row.image_url || fallback?.appIcon || GENERIC_APP_ICON,
      savedSlugCount: saved.count,
      lastUpdated: saved.lastUpdated,
      showOnChooser: row.show_on_chooser,
    };
  });

  return (
    <div className="p-4 sm:p-8 space-y-5 sm:space-y-6 max-w-5xl">
      <header className="space-y-2">
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] uppercase tracking-widest font-semibold">
          <FileEdit className="h-3 w-3" />
          Signup Control
        </div>
        <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
          Pick a campaign to edit
        </h1>
        <p className="text-xs sm:text-sm text-muted-foreground max-w-2xl">
          Each campaign has its own creator-onboarding pages — Brief,
          TikTok Setup, and Login/Signup Form. Pick one to edit its
          copy, video links, FAQ items, journey steps, and more.
          Changes go live the moment you save.
        </p>
      </header>

      {/* Tile grid:
            • phone (< sm): 2-per-row so each tile has room for the
              icon, name, description AND the Show/Hide toggle without
              feeling cramped.
            • tablet+ (sm+): 3-per-row, the user's preferred density.
          The whole tile body is the link to the editor; the
          "Show / Hide" toggle is a sibling button that doesn't
          navigate so admins can flip chooser visibility without
          leaving this page. */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {tiles.map((tile) => (
          <div
            key={tile.slug}
            className="group relative overflow-hidden rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.08] to-emerald-500/[0.02] hover:from-emerald-500/[0.14] hover:to-emerald-500/[0.04] transition-colors p-4 flex flex-col gap-2 items-center text-center"
          >
            <Link
              href={`/signup-control/${tile.slug}`}
              className="absolute inset-0 z-0"
              aria-label={`Edit ${tile.label} pages`}
            />
            {/* Upper-right "open" arrow, same affordance as the
                /welcome/campaign cards. */}
            <ArrowUpRight
              className="absolute top-2 right-2 h-4 w-4 text-emerald-600/70 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-emerald-600 transition-all pointer-events-none"
              aria-hidden
            />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={tile.appIcon}
              alt=""
              width={44}
              height={44}
              className="relative z-[1] h-11 w-11 sm:h-12 sm:w-12 rounded-xl object-cover bg-white ring-1 ring-emerald-500/20 pointer-events-none"
            />
            <div className="relative z-[1] space-y-0.5 min-w-0 w-full pointer-events-none">
              <p className="text-sm font-semibold leading-tight truncate">
                {tile.label}
              </p>
              <p className="text-[11px] sm:text-xs text-foreground/70 leading-snug line-clamp-2">
                {tile.description}
              </p>
            </div>
            {/* Bottom row: badge + toggle pill. Stacks on phone
                (saved-count above CTA), side-by-side on tablet+. */}
            <div className="relative z-[1] mt-auto pt-1.5 w-full flex flex-col sm:flex-row items-center justify-center gap-1.5">
              {tile.savedSlugCount > 0 ? (
                <span className="inline-flex items-center gap-1 text-[10px] sm:text-[11px] text-emerald-700 dark:text-emerald-300 font-medium pointer-events-none">
                  <CheckCircle2 className="h-3 w-3" />
                  {tile.savedSlugCount} saved
                </span>
              ) : (
                <span className="text-[10px] sm:text-[11px] text-muted-foreground pointer-events-none">
                  Defaults only
                </span>
              )}
              {/* Visibility toggle — clickable, doesn't navigate. */}
              <ChooserToggle slug={tile.slug} initial={tile.showOnChooser} />
            </div>
          </div>
        ))}
      </div>

      <Card>
        <CardContent className="p-5 text-xs text-muted-foreground space-y-1.5">
          <p className="font-semibold text-foreground">How this works</p>
          <p>
            Each campaign has 3 editable creator-onboarding pages
            (Brief, TikTok Setup, Login/Signup Form) plus a shared
            Welcome page. Pick a campaign above to open its 4-tile
            picker. If a campaign shows <em>&quot;Defaults only&quot;</em>,
            the creator-facing pages are rendering the baked-in fallback
            content — your first save replaces those defaults.
          </p>
          <p>
            The <strong>Welcome / Portal Chooser</strong> page is the
            same for every campaign (it&apos;s shown <em>before</em> the
            creator picks a campaign), so editing it from any tile
            below updates all visitors.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
