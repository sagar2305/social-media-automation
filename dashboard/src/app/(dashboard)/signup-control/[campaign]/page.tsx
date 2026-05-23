/**
 * /signup-control/<campaign> — campaign-scoped 4-tile editor picker.
 *
 * After admin picks a campaign at /signup-control, they land here
 * with the 4 editors that make up that campaign's creator-onboarding
 * flow: Brief, TikTok Setup, Welcome (shared), and Login/Signup Form.
 *
 * The Welcome tile is included on EVERY campaign's picker for
 * convenience, even though it's stored under SHARED_CAMPAIGN — clicks
 * route to /signup-control/welcome regardless of which campaign tile
 * the admin came from.
 */

import Link from "next/link";
import { notFound } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { getCampaignBySlug } from "@/lib/campaigns";
import {
  CMS_SLUGS,
  campaignMeta,
  isCampaign,
  resolveCampaignKey,
  slugScope,
  type CmsSlug,
} from "@/lib/cms-schemas";

/** Fallback icon for DB-only campaigns that haven't uploaded one. */
const GENERIC_APP_ICON = "/app-icons/generic.svg";
import {
  FileEdit,
  ArrowUpRight,
  ExternalLink,
  CheckCircle2,
  ChevronLeft,
} from "lucide-react";

export const dynamic = "force-dynamic";

const TILE_TITLES: Record<CmsSlug, string> = {
  brief: "Internship Brief",
  "tiktok-setup": "TikTok Setup Guide",
  welcome: "Welcome / Portal Chooser",
  "auth-form": "Login & Signup Form",
  "campaign-theme": "Brand Theme",
};

const TILE_DESCRIPTIONS: Record<CmsSlug, string> = {
  brief: "The long-scroll brief shown at /creator/<campaign>/brief.",
  "tiktok-setup": "The 6-step interactive guide at /creator/<campaign>/setup/tiktok.",
  welcome: "The first screen at /welcome — Creator vs Staff. Shared across campaigns.",
  "auth-form": "Copy shown on /creator/<campaign>/login and /signup.",
  "campaign-theme": "Pick the brand color for this campaign's creator-facing pages.",
};

interface Tile {
  slug: CmsSlug;
  title: string;
  description: string;
  livePath: string;
  editorHref: string;
  isSaved: boolean;
  updatedAt: string | null;
}

export default async function SignupControlCampaignPage({
  params,
}: {
  params: Promise<{ campaign: string }>;
}) {
  await requireRole("admin");
  const { campaign } = await params;
  // DB existence check — supports admin-added campaigns from
  // /campaigns/new without a static registry update.
  const row = await getCampaignBySlug(campaign);
  if (!row) notFound();
  const knownMeta = isCampaign(campaign) ? campaignMeta[campaign] : null;
  const meta = {
    label: row.name || knownMeta?.label || campaign,
    description: row.description || knownMeta?.description || "Creator program",
    appIcon: row.image_url || knownMeta?.appIcon || GENERIC_APP_ICON,
  };

  // Bulk-fetch saved rows for this campaign + the shared welcome row
  // so each tile can show "Saved · 2h ago" vs "Defaults · never edited".
  const sb = await createClient();
  const savedByKey = new Map<string, string>();
  try {
    const { data } = await sb
      .from("cms_pages")
      .select("campaign, slug, updated_at")
      .in("campaign", [campaign, "_shared"]);
    if (data) {
      for (const r of data) {
        savedByKey.set(
          `${r.campaign}/${r.slug}`,
          r.updated_at as string,
        );
      }
    }
  } catch {
    // Table missing or RLS issue — tiles fall back to "defaults".
  }

  const tiles: Tile[] = CMS_SLUGS.map((slug) => {
    const key = `${resolveCampaignKey(slug, campaign)}/${slug}`;
    const updatedAt = savedByKey.get(key) ?? null;
    return {
      slug,
      title: TILE_TITLES[slug],
      description: TILE_DESCRIPTIONS[slug],
      livePath: livePathFor(slug, campaign),
      editorHref:
        slugScope[slug] === "shared"
          ? `/signup-control/welcome`
          : `/signup-control/${campaign}/${slug}`,
      isSaved: Boolean(updatedAt),
      updatedAt,
    };
  });

  return (
    <div className="p-6 sm:p-8 space-y-6 max-w-5xl">
      <header className="space-y-2">
        <Link
          href="/signup-control"
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" />
          Back to campaign chooser
        </Link>
        <div className="flex items-center gap-3 pt-1">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={meta.appIcon}
            alt=""
            width={44}
            height={44}
            className="h-11 w-11 rounded-xl object-cover bg-white ring-1 ring-emerald-500/25"
          />
          <div>
            <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-[10px] uppercase tracking-widest font-semibold">
              <FileEdit className="h-3 w-3" />
              {meta.label}
            </div>
            <h1 className="text-2xl sm:text-3xl font-semibold tracking-tight">
              Edit {meta.label} onboarding pages
            </h1>
          </div>
        </div>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Pick a page to edit its copy, video links, FAQ items, journey
          steps, and more. Changes go live the moment you save — no
          deploy needed.
        </p>
      </header>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {tiles.map((tile) => (
          <Link
            key={tile.slug}
            href={tile.editorHref}
            className="group rounded-2xl border border-emerald-500/30 bg-gradient-to-br from-emerald-500/[0.08] to-emerald-500/[0.02] hover:from-emerald-500/[0.14] hover:to-emerald-500/[0.04] transition-colors p-5 flex flex-col gap-3"
          >
            <div className="flex items-center justify-between">
              <div className="h-10 w-10 rounded-xl bg-emerald-500/15 ring-1 ring-emerald-500/25 text-emerald-700 dark:text-emerald-300 flex items-center justify-center">
                <FileEdit className="h-5 w-5" strokeWidth={2.25} />
              </div>
              <ArrowUpRight className="h-5 w-5 text-emerald-600/70 group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-emerald-600 transition-all" />
            </div>
            <div className="space-y-1">
              <p className="text-lg font-semibold leading-tight">{tile.title}</p>
              <p className="text-sm text-foreground/70 leading-snug">
                {tile.description}
              </p>
            </div>
            <div className="flex items-center justify-between text-xs pt-1 mt-auto">
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <ExternalLink className="h-3 w-3" />
                {tile.livePath}
              </span>
              {tile.isSaved ? (
                <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300 font-medium">
                  <CheckCircle2 className="h-3 w-3" />
                  Saved · {formatRelative(tile.updatedAt!)}
                </span>
              ) : (
                <span className="text-muted-foreground">Defaults · never edited</span>
              )}
            </div>
          </Link>
        ))}
      </div>

      <Card>
        <CardContent className="p-5 text-xs text-muted-foreground space-y-1.5">
          <p className="font-semibold text-foreground">How this works</p>
          <p>
            Each tile edits a JSON content blob for that page. If a tile
            shows <em>&quot;Defaults · never edited&quot;</em>, the
            creator-facing page is rendering the baked-in fallback for
            this campaign — your first save replaces those defaults.
            The <strong>Welcome</strong> page is shared across
            campaigns, so editing it from here updates the chooser for
            every campaign.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

function livePathFor(slug: CmsSlug, campaign: string): string {
  switch (slug) {
    case "brief": return `/creator/${campaign}/brief`;
    case "tiktok-setup": return `/creator/${campaign}/setup/tiktok`;
    case "auth-form": return `/creator/${campaign}/signup`;
    case "welcome": return "/welcome";
    // Theme has no single "live page" — preview by visiting the brief.
    case "campaign-theme": return `/creator/${campaign}/brief`;
  }
}

function formatRelative(iso: string): string {
  const then = new Date(iso).getTime();
  if (!then) return "—";
  const diffMs = Date.now() - then;
  const min = Math.floor(diffMs / 60_000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.floor(hr / 24);
  return `${day}d ago`;
}
