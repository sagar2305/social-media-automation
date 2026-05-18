/**
 * Layout for /campaigns/[slug]/* — wraps the per-campaign tabs with a
 * shared hero header. The header surfaces the campaign image, name,
 * status, posting-progress summary, and global per-campaign actions
 * (Refresh Now, Share, Edit) so they stay in view across every tab.
 *
 * Tab strip is rendered as a client-side <CampaignTabs /> component so
 * the active tab can be highlighted from usePathname() without each
 * page needing to render its own.
 */

import { notFound } from "next/navigation";
import Image from "next/image";
import { createClient } from "@/lib/supabase";
import type { Campaign } from "@/lib/types";
import { CampaignTabs } from "./campaign-tabs";
import { RefreshNowButton } from "./refresh-now-button";
import { CampaignShareMenu } from "./share-menu";
import { RunCycleButton } from "./run-cycle-button";
import { Image as ImageIcon, Pencil } from "lucide-react";
import Link from "next/link";

export const revalidate = 30;

function StatusPill({ status }: { status: Campaign["status"] }) {
  const styles: Record<Campaign["status"], string> = {
    active: "bg-[#16a34a]/10 text-[#16a34a]",
    paused: "bg-[#bf4800]/10 text-[#bf4800]",
    archived: "bg-muted text-muted-foreground",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium ${styles[status]}`}
    >
      {status}
    </span>
  );
}

async function getCampaignAndStats(slug: string) {
  const sb = await createClient();
  const { data: campaign } = await sb
    .from("campaigns")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<Campaign>();
  if (!campaign) return null;

  // Posts count + active accounts (with handles for the Run Cycle button) in parallel.
  const [postsRes, accountsRes] = await Promise.all([
    sb
      .from("posts")
      .select("id", { count: "exact", head: true })
      .eq("campaign_id", campaign.id),
    sb
      .from("accounts")
      .select("handle, name")
      .eq("campaign_id", campaign.id)
      .eq("active", true)
      .order("created_at", { ascending: true }),
  ]);

  const postsCount = postsRes.count ?? 0;
  const accountsList = (accountsRes.data ?? []) as { handle: string; name: string }[];
  const accountsCount = accountsList.length;

  // Days remaining + total post target (mirrors /campaigns list math)
  let daysLeft: number | null = null;
  let postsTargetTotal = 0;
  if (campaign.end_date) {
    daysLeft = Math.max(
      0,
      Math.ceil(
        (new Date(campaign.end_date).getTime() - Date.now()) / 86_400_000,
      ),
    );
  }
  if (campaign.start_date && campaign.end_date) {
    const weeks = Math.max(
      1,
      Math.round(
        (new Date(campaign.end_date).getTime() -
          new Date(campaign.start_date).getTime()) /
          (7 * 86_400_000),
      ),
    );
    postsTargetTotal = accountsCount * campaign.target_posts_per_week * weeks;
  }

  return { campaign, postsCount, accountsCount, accountsList, daysLeft, postsTargetTotal };
}

export default async function CampaignLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const data = await getCampaignAndStats(slug);
  if (!data) notFound();

  const { campaign, postsCount, accountsCount, accountsList, daysLeft, postsTargetTotal } = data;
  const progress =
    postsTargetTotal > 0
      ? Math.min(100, (postsCount / postsTargetTotal) * 100)
      : null;

  return (
    <div className="space-y-6">
      {/* Hero header */}
      <div className="flex items-start gap-5">
        {/* Image */}
        <div className="relative h-12 w-12 rounded-lg bg-muted overflow-hidden shrink-0 flex items-center justify-center">
          {campaign.image_url ? (
            <Image
              src={campaign.image_url}
              alt={campaign.name}
              fill
              className="object-cover"
              sizes="48px"
            />
          ) : (
            <ImageIcon className="h-5 w-5 text-muted-foreground/40" />
          )}
        </div>

        {/* Title block — single-line meta strip below the name keeps the
            hero compact and Trackr-like. Description gone from the hero;
            it lives on the edit page + appears in the Resources/share
            views where it's actually useful. */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-xl font-semibold tracking-tight">{campaign.name}</h1>
            <StatusPill status={campaign.status} />
          </div>
          <p className="flex items-center gap-2 mt-1 text-xs text-muted-foreground">
            <span>
              <span className="text-foreground tabular-nums">{accountsCount}</span>{" "}
              account{accountsCount === 1 ? "" : "s"}
            </span>
            <span className="text-border">·</span>
            {progress !== null ? (
              <span>
                <span className="text-foreground tabular-nums">
                  {postsCount}/{postsTargetTotal}
                </span>{" "}
                posts ({progress.toFixed(0)}%)
              </span>
            ) : (
              <span>
                <span className="text-foreground tabular-nums">{postsCount}</span>{" "}
                post{postsCount === 1 ? "" : "s"}
              </span>
            )}
            {daysLeft !== null && (
              <>
                <span className="text-border">·</span>
                <span>
                  {daysLeft === 0
                    ? "Ends today"
                    : daysLeft === 1
                      ? "1 day left"
                      : `${daysLeft} days left`}
                </span>
              </>
            )}
          </p>
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Run a posting cycle now — primary action; ships the same
              cycle_jobs flow as the global /runs page but auto-attaches
              campaign_id so jobs.poller fires it with --campaign=<slug>. */}
          <RunCycleButton
            campaignId={campaign.id}
            campaignSlug={campaign.slug}
            campaignName={campaign.name}
            campaignStatus={campaign.status}
            enabledFlows={campaign.flows_enabled ?? {
              photorealistic: true,
              animated: true,
              emoji_overlay: true,
            }}
            campaignAccounts={accountsList}
          />
          <RefreshNowButton campaignId={campaign.id} campaignSlug={campaign.slug} />
          <Link
            href={`/campaigns/${campaign.slug}/edit`}
            className="inline-flex items-center gap-1.5 rounded-md border border-input bg-background px-3 py-2 text-xs font-medium hover:bg-muted transition-colors"
          >
            <Pencil className="h-3.5 w-3.5" />
            Edit
          </Link>
          <CampaignShareMenu
            campaignId={campaign.id}
            campaignSlug={campaign.slug}
            campaignName={campaign.name}
          />

        </div>
      </div>

      {/* Tab strip */}
      <CampaignTabs slug={campaign.slug} />

      {/* Tab content */}
      {children}
    </div>
  );
}
