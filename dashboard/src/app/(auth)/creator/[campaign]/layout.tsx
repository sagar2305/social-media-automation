/**
 * /creator/<campaign>/* — campaign-scoped layout.
 *
 * Wraps every per-campaign creator page in a `theme-<name>` div so
 * the brand color cascades down to every `bg-brand-*` / `text-brand-*`
 * utility inside.
 *
 * The theme value is loaded from the CMS slug "campaign-theme". If
 * no row exists yet, getPageContent falls back to
 * cmsDefaults.campaign-theme (per-campaign), so a fresh project
 * still renders Minutewise=emerald, Roast AI=rose, Call Recorder=blue
 * without any admin action.
 *
 * `contents` on the wrapper keeps it layout-neutral — the wrapper
 * adds no extra box to the visual tree, only the CSS-variable scope.
 */

import type { CSSProperties } from "react";
import { notFound } from "next/navigation";
import { getPageContent } from "@/lib/cms";
import { getCampaignBySlug } from "@/lib/campaigns";

export default async function CreatorCampaignLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ campaign: string }>;
}) {
  const { campaign } = await params;
  // DB-existence check replaces the old isCampaign() static gate so a
  // brand-new campaign added via /campaigns/new works the moment its
  // row lands in Supabase — no code change needed.
  const row = await getCampaignBySlug(campaign);
  if (!row) notFound();
  const { theme, customColor } = await getPageContent("campaign-theme", campaign);

  // When theme === "custom", inject the admin's chosen hex as
  // --brand-custom; the .theme-custom rule in globals.css then
  // derives the full 50–950 ramp from it at runtime via color-mix.
  // For the 4 named presets the inline style is undefined so the
  // .theme-<name> rule alone supplies all 11 shades.
  const style: CSSProperties | undefined =
    theme === "custom" && customColor
      ? ({ "--brand-custom": customColor } as CSSProperties)
      : undefined;

  return (
    <div className={`theme-${theme} contents`} style={style}>
      {children}
    </div>
  );
}
