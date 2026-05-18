/**
 * /campaigns/[slug]/accounts — manage TikTok accounts on this campaign.
 *
 * Server component loads:
 *   - the campaign row (for default target + name)
 *   - accounts on this campaign (rows in the table)
 *   - posts on this campaign (per-account aggregates)
 *   - accounts NOT on any campaign (Existing tab in the Add modal)
 *   - accounts on other campaigns (Move tab in the Add modal)
 *
 * Hands off to the client AccountManager for interactivity.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Eye, EyeOff } from "lucide-react";
import type { Campaign } from "@/lib/types";
import {
  AccountManager,
  type ManagedRow,
  type UnassignedAccount,
  type OtherCampaignAccount,
} from "./account-manager";

export const revalidate = 30;

interface AccountRow {
  id: string;
  name: string;
  handle: string;
  active: boolean;
  notes: string | null;
  target_posts_per_week: number | null;
  campaign_id: string | null;
}

interface PostAggregate {
  account: string | null;
  date: string | null;
  views: number | null;
  saves: number | null;
  save_rate: number | null;
  status: string | null;
}

interface OtherCampaignAccountRow extends AccountRow {
  campaigns: { name: string } | null;
}

async function loadAccountsTab(slug: string) {
  const sb = await createClient();

  const { data: campaign } = await sb
    .from("campaigns")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<Campaign>();
  if (!campaign) return null;

  const [
    onCampaignRes,
    postsRes,
    unassignedRes,
    otherRes,
  ] = await Promise.all([
    // Accounts attached to this campaign
    sb
      .from("accounts")
      .select("id, name, handle, active, notes, target_posts_per_week, campaign_id")
      .eq("campaign_id", campaign.id)
      .order("created_at", { ascending: true }),
    // Per-account post aggregates (campaign-scoped)
    sb
      .from("posts")
      .select("account, date, views, saves, save_rate, status")
      .eq("campaign_id", campaign.id),
    // Unassigned accounts for the "Existing" tab in the Add modal
    sb
      .from("accounts")
      .select("id, name, handle")
      .is("campaign_id", null)
      .order("created_at", { ascending: true }),
    // Accounts on OTHER campaigns for the "Move" tab — joined to campaigns
    // for the user-readable name.
    sb
      .from("accounts")
      .select("id, name, handle, active, notes, target_posts_per_week, campaign_id, campaigns:campaign_id(name)")
      .neq("campaign_id", campaign.id)
      .not("campaign_id", "is", null)
      .order("created_at", { ascending: true }),
  ]);

  const accounts = (onCampaignRes.data ?? []) as AccountRow[];
  const posts = (postsRes.data ?? []) as PostAggregate[];

  // Aggregate per-handle stats across all this campaign's posts.
  interface Acc {
    posts: number;
    views: number;
    saves: number;
    saveRates: number[];
    lastDate: string | null;
  }
  const byHandle = new Map<string, Acc>();
  for (const p of posts) {
    if (!p.account) continue;
    const acc = byHandle.get(p.account) ?? {
      posts: 0, views: 0, saves: 0, saveRates: [], lastDate: null,
    };
    acc.posts++;
    acc.views += p.views ?? 0;
    acc.saves += p.saves ?? 0;
    if (p.save_rate != null) acc.saveRates.push(Number(p.save_rate));
    if (p.date && (!acc.lastDate || p.date > acc.lastDate)) acc.lastDate = p.date;
    byHandle.set(p.account, acc);
  }

  const rows: ManagedRow[] = accounts.map((a) => {
    const stats = byHandle.get(a.handle);
    const avgSave = stats && stats.saveRates.length > 0
      ? stats.saveRates.reduce((s, n) => s + n, 0) / stats.saveRates.length
      : 0;
    return {
      id: a.id,
      name: a.name,
      handle: a.handle,
      active: a.active,
      notes: a.notes,
      blotato_id: a.id, // accounts.id doubles as Blotato id in current schema
      target_posts_per_week: a.target_posts_per_week,
      effective_target: a.target_posts_per_week ?? campaign.target_posts_per_week,
      posts: stats?.posts ?? 0,
      views: stats?.views ?? 0,
      saves: stats?.saves ?? 0,
      avg_save_rate: avgSave,
      last_posted: stats?.lastDate ?? null,
    };
  });

  const unassigned: UnassignedAccount[] = (unassignedRes.data ?? []).map((a) => ({
    id: a.id as string,
    name: a.name as string,
    handle: a.handle as string,
  }));

  const otherCampaignAccounts: OtherCampaignAccount[] = (
    (otherRes.data ?? []) as unknown as OtherCampaignAccountRow[]
  ).map((a) => ({
    id: a.id,
    name: a.name,
    handle: a.handle,
    campaign_name: a.campaigns?.name ?? "Other campaign",
  }));

  return {
    campaign,
    rows,
    unassigned,
    otherCampaignAccounts,
  };
}

export default async function CampaignAccountsPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ inactive?: string }>;
}) {
  const { slug } = await params;
  const { inactive: inactiveParam } = await searchParams;
  const showInactive = inactiveParam === "1" || inactiveParam === "true";

  const data = await loadAccountsTab(slug);
  if (!data) notFound();

  const { campaign, rows, unassigned, otherCampaignAccounts } = data;
  const visibleRows = showInactive ? rows : rows.filter((r) => r.active);
  const pausedCount = rows.filter((r) => !r.active).length;

  return (
    <Card className="shadow-sm border-0 ring-0">
      <CardContent className="pt-6 space-y-4">
        {/* Show-paused toggle. Hidden when there are no paused accounts so
            we don't clutter the UI with a useless control. */}
        {pausedCount > 0 && (
          <div className="flex items-center justify-end">
            <Link
              href={`/campaigns/${campaign.slug}/accounts${
                showInactive ? "" : "?inactive=1"
              }`}
              className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
                showInactive
                  ? "bg-primary/10 border-primary/30 text-primary hover:bg-primary/15"
                  : "border-input bg-background text-foreground hover:bg-muted"
              }`}
            >
              {showInactive ? (
                <Eye className="h-3.5 w-3.5" />
              ) : (
                <EyeOff className="h-3.5 w-3.5" />
              )}
              {showInactive
                ? `Showing ${pausedCount} paused`
                : `Hide ${pausedCount} paused`}
            </Link>
          </div>
        )}

        <AccountManager
          slug={campaign.slug}
          campaignName={campaign.name}
          campaignDefaultTarget={campaign.target_posts_per_week}
          rows={visibleRows}
          unassigned={unassigned}
          otherCampaignAccounts={otherCampaignAccounts}
          pausedHidden={showInactive ? 0 : pausedCount}
        />
      </CardContent>
    </Card>
  );
}
