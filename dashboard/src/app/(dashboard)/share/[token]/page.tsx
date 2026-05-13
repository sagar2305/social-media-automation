/**
 * /share/[token] — public, no-login view of a campaign or account set.
 *
 * Phase 12: dispatches on share_links.link_type so a single token URL
 * can render three different presentations:
 *   - 'dashboard' (default; original behaviour) — KPI grid + Daily Views chart
 *   - 'gallery'                                 — visual grid of every post
 *   - 'overview'                                — campaign brief / strategy view
 *
 * The link can be scoped two ways:
 *   - share_links.campaign_id set → filter posts by campaign_id
 *   - share_links.accounts[]  set → filter posts by account handle
 * (both can coexist; campaign filter takes precedence when present.)
 */

import { notFound } from "next/navigation";
import { createClient } from "@/lib/supabase";
import type { Campaign } from "@/lib/types";
import {
  DashboardView,
  GalleryView,
  OverviewView,
  type SharedPost,
  type SharedAccountStat,
} from "./share-views";

export const revalidate = 300;

interface ShareLinkRow {
  id: string;
  token: string;
  title: string;
  accounts: string[] | null;
  campaign_id: string | null;
  link_type: string | null;
  expires_at: string | null;
}

export default async function SharedPage(props: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await props.params;
  const sb = await createClient();

  const { data: link } = await sb
    .from("share_links")
    .select("id, token, title, accounts, campaign_id, link_type, expires_at")
    .eq("token", token)
    .maybeSingle<ShareLinkRow>();

  if (!link) notFound();

  if (link.expires_at && new Date(link.expires_at) < new Date()) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center">
        <p className="text-muted-foreground text-lg">
          This shared link has expired.
        </p>
      </div>
    );
  }

  // Resolve the campaign first so we can show its brand on the public
  // header even for legacy links that lack a campaign_id.
  let campaign: Campaign | null = null;
  if (link.campaign_id) {
    const { data } = await sb
      .from("campaigns")
      .select("*")
      .eq("id", link.campaign_id)
      .maybeSingle<Campaign>();
    campaign = data ?? null;
  }

  // Build the posts query — campaign filter wins; account filter is a
  // legacy fallback for share links created before campaigns existed.
  let postsQuery = sb
    .from("posts")
    .select("id, date, hook_style, account, views, likes, saves, save_rate, tiktok_url, status")
    .eq("status", "published")
    .order("date", { ascending: false })
    .limit(500);

  if (link.campaign_id) {
    postsQuery = postsQuery.eq("campaign_id", link.campaign_id);
  } else if (link.accounts && link.accounts.length > 0) {
    postsQuery = postsQuery.in("account", link.accounts);
  }

  const [postsRes, statsRes] = await Promise.all([
    postsQuery,
    sb.from("account_stats")
      .select("account, followers, date")
      .order("date", { ascending: false })
      .limit(50),
  ]);

  const posts: SharedPost[] = (postsRes.data ?? []) as SharedPost[];

  // Dedupe account stats to the most recent per account handle.
  const latest = new Map<string, SharedAccountStat>();
  const accountFilter =
    link.accounts && link.accounts.length > 0 ? link.accounts : null;
  for (const s of statsRes.data ?? []) {
    if (latest.has(s.account)) continue;
    if (accountFilter && !accountFilter.includes(s.account)) continue;
    latest.set(s.account, { account: s.account, followers: s.followers ?? 0 });
  }
  const accountStats = Array.from(latest.values());

  const linkType = (link.link_type ?? "dashboard") as
    | "dashboard"
    | "gallery"
    | "overview";

  const props2 = {
    title: link.title,
    campaign,
    posts,
    accountStats,
  };

  if (linkType === "gallery") return <GalleryView {...props2} />;
  if (linkType === "overview") return <OverviewView {...props2} />;
  return <DashboardView {...props2} />;
}
