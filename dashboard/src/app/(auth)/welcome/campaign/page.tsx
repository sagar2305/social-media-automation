/**
 * /welcome/campaign — campaign chooser, shown after a creator picks
 * "I'm a Creator" on /welcome.
 *
 * The card list is DB-driven from the `campaigns` table, gated by the
 * explicit per-campaign `show_on_chooser` flag (toggle on each tile
 * in /signup-control). A campaign added via /campaigns/new is hidden
 * until the admin flips its toggle ON — saving content for it is NOT
 * enough on its own. The migration backfills the 3 originally-shipped
 * apps (minutewise, roastai, call-recorder) as visible, so a fresh
 * project still has a working creator funnel out of the box.
 *
 * Each card previews the brand color that the visitor will see on the
 * matching creator pages by loading the campaign's "campaign-theme"
 * CMS row (Minutewise=emerald, Roast AI=rose, Call Recorder=blue,
 * brand-new campaigns default to emerald until the admin edits theme).
 */

import Link from "next/link";
import Image from "next/image";
import { ChevronRight, Sparkles } from "lucide-react";
import { getPageContent } from "@/lib/cms";
import { listActiveCampaigns } from "@/lib/campaigns";
import {
  CAMPAIGNS,
  campaignMeta,
  isCampaign,
  type ThemePreset,
} from "@/lib/cms-schemas";

/**
 * Safety-net fallback. If the show_on_chooser column hasn't been
 * migrated yet OR every row currently has it set to false (admin
 * still configuring), these three apps still appear so the public
 * creator funnel isn't accidentally taken down. The boss can opt
 * out of any of them by adding them to the DB and flipping the
 * toggle off explicitly.
 */
const ALWAYS_VISIBLE: ReadonlySet<string> = new Set<string>(CAMPAIGNS);

export const dynamic = "force-dynamic";

interface CampaignCard {
  slug: string;
  name: string;
  description: string;
  iconUrl: string;
  /** Brand-color preset for the card's emerald/rose/blue/amber tint. */
  theme: ThemePreset;
}

/** Fallback icon for DB-only campaigns that haven't uploaded one. */
const GENERIC_APP_ICON = "/app-icons/generic.svg";

async function loadCampaignCards(): Promise<CampaignCard[]> {
  const rows = await listActiveCampaigns();

  // Visibility rule:
  //   • A campaign appears here ONLY if the admin has explicitly
  //     flipped its "Shown" toggle in /signup-control (which sets
  //     campaigns.show_on_chooser = true).
  //   • The 3 originally-shipped apps are backfilled to true by the
  //     migration, so a fresh project still has a working chooser.
  //   • As a safety net, if the show_on_chooser column hasn't been
  //     migrated yet (every row's flag is false because the column
  //     doesn't exist), the static ALWAYS_VISIBLE set still surfaces
  //     the 3 defaults so the public funnel doesn't go dark.
  const anyExplicitlyVisible = rows.some((r) => r.show_on_chooser);
  const visible = rows.filter((r) => {
    if (r.show_on_chooser) return true;
    if (!anyExplicitlyVisible && ALWAYS_VISIBLE.has(r.slug)) return true;
    return false;
  });

  // Load each visible campaign's theme in parallel so each card previews
  // the color the visitor will see after clicking.
  const themesArr = await Promise.all(
    visible.map(async (row) => {
      const { theme } = await getPageContent("campaign-theme", row.slug);
      return [row.slug, theme] as const;
    }),
  );
  const themeBySlug = new Map<string, ThemePreset>(themesArr);

  return visible.map((row) => {
    // Known apps keep their static fallback name/description/icon when
    // the DB column is empty; admin-added campaigns surface the name +
    // description the admin typed on /campaigns/new.
    const fallback = isCampaign(row.slug) ? campaignMeta[row.slug] : null;
    return {
      slug: row.slug,
      name: row.name || fallback?.label || row.slug,
      description: row.description || fallback?.description || "Creator program",
      iconUrl: row.image_url || fallback?.appIcon || GENERIC_APP_ICON,
      theme: themeBySlug.get(row.slug) ?? "emerald",
    };
  });
}

export default async function WelcomeCampaignChooserPage() {
  const cards = await loadCampaignCards();

  return (
    <div className="w-full max-w-3xl px-4 space-y-6 sm:space-y-8">
      <div className="text-center space-y-2 sm:space-y-3">
        {/* Brewapps logo, centered above the heading — mirrors the
            pattern used by the creator auth form and welcome page so
            the visitor always sees the brand mark on entry. Smaller
            on mobile so the header doesn't push the cards below the
            fold on short screens. */}
        <Image
          src="/brewapps-logo.png"
          alt="Brewapps"
          width={144}
          height={144}
          priority
          className="h-14 sm:h-20 w-auto mx-auto"
        />
        <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-brand-500/10 text-brand-700 dark:text-brand-400 text-[10px] uppercase tracking-widest font-semibold">
          <Sparkles className="h-3 w-3" />
          BrewApps Creators
        </div>
        <h1 className="text-2xl sm:text-4xl font-semibold tracking-tight">
          Pick your campaign
        </h1>
        <p className="text-muted-foreground text-sm sm:text-base">
          Which app&apos;s creator program are you joining?
        </p>
      </div>

      {/* Empty state — shown when no campaigns have been "published"
          (i.e. no admin has saved any /signup-control content for any
          campaign yet). Tells the visitor what's happening rather
          than dropping them into an empty grid. */}
      {cards.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border bg-card/40 p-8 text-center space-y-2">
          <p className="text-sm font-medium">No creator programs are open right now.</p>
          <p className="text-xs text-muted-foreground">
            Check back soon — our team will announce when the next program is live.
          </p>
        </div>
      ) : (
        /* Layout breakpoints:
            • phone (< sm): 2-per-row so each card has ~150-180px of
              width — enough for a readable icon, name, and 2 lines of
              description.
            • tablet+ (sm+): 3-per-row, the user's preferred density.
            The tagline "OPEN CREATOR BRIEF →" only renders at sm+;
            on phone the chevron in the top-right of each card is the
            tap affordance. */
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {cards.map((card) => (
            <Link
              key={card.slug}
              href={`/creator/${card.slug}/brief`}
              // Wrap each card in its own theme-* class so the
              // brand-500/700/etc. utilities resolve to that campaign's
              // brand color — the card previews where it leads.
              className={`theme-${card.theme} group relative overflow-hidden rounded-2xl border border-brand-500/30 bg-gradient-to-br from-brand-500/[0.08] to-brand-500/[0.02] hover:from-brand-500/[0.14] hover:to-brand-500/[0.04] transition-colors p-4 sm:p-5 flex flex-col gap-3`}
            >
              <div className="flex items-start justify-between gap-2">
                {/* Plain <img> rather than next/image — these icons are
                    small PNGs already at the rendered size and they can
                    come from Supabase Storage URLs that Next 16 +
                    Turbopack don't reliably whitelist. */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={card.iconUrl}
                  alt=""
                  width={44}
                  height={44}
                  className="h-11 w-11 rounded-xl object-cover bg-white ring-1 ring-brand-500/20"
                />
                <ChevronRight
                  className="h-4 w-4 sm:h-5 sm:w-5 text-brand-600/60 dark:text-brand-400/60 shrink-0 mt-1 group-hover:translate-x-0.5 transition-transform"
                  aria-hidden
                />
              </div>
              <div className="space-y-1 min-w-0">
                <p className="text-sm sm:text-base font-semibold leading-tight">
                  {card.name}
                </p>
                <p className="text-xs sm:text-sm text-muted-foreground leading-snug line-clamp-3 sm:line-clamp-2">
                  {card.description}
                </p>
              </div>
              <p className="text-[10px] sm:text-[11px] uppercase tracking-widest text-brand-700/80 dark:text-brand-400/80 font-medium mt-auto">
                Open creator brief →
              </p>
            </Link>
          ))}
        </div>
      )}

      <p className="text-center text-xs text-muted-foreground">
        <Link
          href="/welcome"
          className="text-brand-700 dark:text-brand-300 hover:underline"
        >
          ← Wrong portal? Back to chooser
        </Link>
      </p>
    </div>
  );
}
