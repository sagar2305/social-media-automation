/**
 * /campaigns — list view of every campaign in the system.
 *
 * Two presentations selectable via ?view=:
 *   - cards   (default) — visual grid with hero image + KPIs + progress bar
 *   - calendar          — Gantt-style timeline by start/end date
 *
 * Same data, two layouts. Server-rendered both ways so refreshing keeps
 * whatever view the user picked.
 */

import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Plus, LayoutGrid, Calendar as CalendarIcon, Eye, EyeOff } from "lucide-react";
import type { Campaign, CampaignSummary } from "@/lib/types";
import { CampaignCards } from "./campaign-cards";
import { CampaignCalendar } from "./campaign-calendar";

export const revalidate = 60;

type View = "cards" | "calendar";

async function getCampaignsWithStats(showInactive: boolean): Promise<CampaignSummary[]> {
  const sb = await createClient();

  let campaignsQuery = sb
    .from("campaigns")
    .select("*")
    .order("created_at", { ascending: true });
  // Default hides archived campaigns; the toggle reveals them.
  if (!showInactive) campaignsQuery = campaignsQuery.neq("status", "archived");

  const { data: campaigns } = await campaignsQuery.returns<Campaign[]>();
  if (!campaigns?.length) return [];

  const { data: posts } = await sb
    .from("posts")
    .select("campaign_id, views, likes, saves, save_rate, status")
    .not("campaign_id", "is", null);

  const postStats = new Map<string, {
    count: number;
    views: number;
    likes: number;
    saves: number;
    saveRates: number[];
  }>();
  for (const p of posts ?? []) {
    if (!p.campaign_id) continue;
    const acc = postStats.get(p.campaign_id) ?? {
      count: 0, views: 0, likes: 0, saves: 0, saveRates: [],
    };
    acc.count++;
    acc.views += p.views ?? 0;
    acc.likes += p.likes ?? 0;
    acc.saves += p.saves ?? 0;
    if (p.save_rate != null) acc.saveRates.push(Number(p.save_rate));
    postStats.set(p.campaign_id, acc);
  }

  const { data: accounts } = await sb
    .from("accounts")
    .select("campaign_id, active")
    .eq("active", true)
    .not("campaign_id", "is", null);

  const accountCount = new Map<string, number>();
  for (const a of accounts ?? []) {
    if (!a.campaign_id) continue;
    accountCount.set(a.campaign_id, (accountCount.get(a.campaign_id) ?? 0) + 1);
  }

  const today = new Date();
  return campaigns.map((c) => {
    const stats = postStats.get(c.id);
    const accountsForCampaign = accountCount.get(c.id) ?? 0;

    const daysLeft = c.end_date
      ? Math.max(0, Math.ceil((new Date(c.end_date).getTime() - today.getTime()) / 86_400_000))
      : null;

    let postsTargetTotal = 0;
    if (c.start_date && c.end_date) {
      const weeks = Math.max(
        1,
        Math.round(
          (new Date(c.end_date).getTime() - new Date(c.start_date).getTime()) / (7 * 86_400_000),
        ),
      );
      postsTargetTotal = accountsForCampaign * c.target_posts_per_week * weeks;
    }

    return {
      ...c,
      account_count: accountsForCampaign,
      posts_count: stats?.count ?? 0,
      total_views: stats?.views ?? 0,
      total_likes: stats?.likes ?? 0,
      total_saves: stats?.saves ?? 0,
      avg_save_rate:
        stats && stats.saveRates.length > 0
          ? stats.saveRates.reduce((s, n) => s + n, 0) / stats.saveRates.length
          : 0,
      days_left: daysLeft,
      posts_target_total: postsTargetTotal,
    };
  });
}

function buildHref(view: View, showInactive: boolean): string {
  const params = new URLSearchParams();
  if (view === "calendar") params.set("view", "calendar");
  if (showInactive) params.set("inactive", "1");
  const qs = params.toString();
  return qs ? `/campaigns?${qs}` : "/campaigns";
}

function ViewToggle({ active, showInactive }: { active: View; showInactive: boolean }) {
  const tabBase =
    "inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors";
  return (
    <div className="inline-flex items-center rounded-lg bg-muted p-0.5">
      <Link
        href={buildHref("cards", showInactive)}
        className={`${tabBase} ${
          active === "cards"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <LayoutGrid className="h-3.5 w-3.5" />
        Cards
      </Link>
      <Link
        href={buildHref("calendar", showInactive)}
        className={`${tabBase} ${
          active === "calendar"
            ? "bg-background text-foreground shadow-sm"
            : "text-muted-foreground hover:text-foreground"
        }`}
      >
        <CalendarIcon className="h-3.5 w-3.5" />
        Calendar
      </Link>
    </div>
  );
}

function ShowInactiveToggle({
  showInactive,
  view,
}: {
  showInactive: boolean;
  view: View;
}) {
  return (
    <Link
      href={buildHref(view, !showInactive)}
      className={`inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors ${
        showInactive
          ? "bg-primary/10 border-primary/30 text-primary hover:bg-primary/15"
          : "border-input bg-background text-foreground hover:bg-muted"
      }`}
      title={
        showInactive
          ? "Click to hide archived campaigns"
          : "Click to also show archived campaigns"
      }
    >
      {showInactive ? (
        <Eye className="h-3.5 w-3.5" />
      ) : (
        <EyeOff className="h-3.5 w-3.5" />
      )}
      {showInactive ? "Showing archived" : "Hide archived"}
    </Link>
  );
}

export default async function CampaignsPage(props: {
  searchParams: Promise<{ view?: string; inactive?: string }>;
}) {
  const { view: viewParam, inactive: inactiveParam } = await props.searchParams;
  const view: View = viewParam === "calendar" ? "calendar" : "cards";
  const showInactive = inactiveParam === "1" || inactiveParam === "true";

  const campaigns = await getCampaignsWithStats(showInactive);
  const activeCount = campaigns.filter((c) => c.status === "active").length;
  const archivedCount = campaigns.filter((c) => c.status === "archived").length;

  return (
    <div className="space-y-6">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Campaigns</h1>
          <p className="text-muted-foreground mt-1">
            {campaigns.length} campaign{campaigns.length === 1 ? "" : "s"} ·{" "}
            {activeCount} active
            {showInactive && archivedCount > 0 && (
              <> · {archivedCount} archived</>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <ShowInactiveToggle showInactive={showInactive} view={view} />
          <ViewToggle active={view} showInactive={showInactive} />
          <Link
            href="/campaigns/new"
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
          >
            <Plus className="h-4 w-4" />
            New Campaign
          </Link>
        </div>
      </div>

      {/* Empty state — only shown in cards view; calendar has its own */}
      {campaigns.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="py-16 text-center">
            <p className="text-base font-medium mb-1">No campaigns yet</p>
            <p className="text-sm text-muted-foreground mb-6">
              Create your first campaign to start posting for an app.
            </p>
            <Link
              href="/campaigns/new"
              className="inline-flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90"
            >
              <Plus className="h-4 w-4" />
              New Campaign
            </Link>
          </CardContent>
        </Card>
      )}

      {campaigns.length > 0 && view === "cards" && (
        <CampaignCards campaigns={campaigns} />
      )}
      {campaigns.length > 0 && view === "calendar" && (
        <CampaignCalendar campaigns={campaigns} />
      )}
    </div>
  );
}
