import { Suspense } from "react";
import { createClient } from "@/lib/supabase";
import { getUser } from "@/lib/auth";
import { AccountsTable } from "@/components/accounts-table";
import { AccountManager, type ManagedAccount } from "@/components/account-manager";
import { DateRangeFilter } from "@/components/date-range-filter";
import { ExportButton } from "@/components/export-button";
import { getDateFilter } from "@/lib/utils";
import {
  AccountsCampaignFilter,
  type AccountsFilterCampaign,
} from "./accounts-campaign-filter";
import { PendingRequestsPanel, type PendingAccountRequest } from "./pending-requests-panel";
import type { AccountSummary } from "@/lib/types";

export const revalidate = 0;

async function getAccountSummaries(dateFrom: string | null, campaignId: string | null) {
  const supabase = await createClient();
  let postsQuery = supabase
    .from("posts")
    .select("*")
    .eq("status", "published")
    .order("date", { ascending: false });

  if (dateFrom) postsQuery = postsQuery.gte("date", dateFrom);
  if (campaignId) postsQuery = postsQuery.eq("campaign_id", campaignId);

  const [postsRes, statsRes] = await Promise.all([
    postsQuery,
    supabase
      .from("account_stats")
      .select("*")
      .order("date", { ascending: false }),
  ]);

  const posts = postsRes.data ?? [];
  const stats = statsRes.data ?? [];

  // Latest stats per account
  const latestStats = new Map<string, (typeof stats)[0]>();
  for (const s of stats) {
    if (!latestStats.has(s.account)) latestStats.set(s.account, s);
  }

  // Aggregate posts per account
  const accountMap = new Map<string, { views: number; likes: number; saves: number; saveRates: number[]; count: number; lastDate: string | null }>();
  for (const p of posts) {
    const acc = p.account || "unknown";
    const existing = accountMap.get(acc) || { views: 0, likes: 0, saves: 0, saveRates: [], count: 0, lastDate: null };
    existing.views += p.views || 0;
    existing.likes += p.likes || 0;
    existing.saves += p.saves || 0;
    if (p.save_rate) existing.saveRates.push(Number(p.save_rate));
    existing.count++;
    if (!existing.lastDate || (p.date && p.date > existing.lastDate)) {
      existing.lastDate = p.date;
    }
    accountMap.set(acc, existing);
  }

  // Merge all known accounts
  const allAccounts = new Set([...accountMap.keys(), ...latestStats.keys()]);
  const summaries: AccountSummary[] = [];

  for (const account of allAccounts) {
    const agg = accountMap.get(account);
    const stat = latestStats.get(account);
    summaries.push({
      account,
      followers: stat?.followers || 0,
      views: agg?.views || 0,
      likes: agg?.likes || 0,
      saves: agg?.saves || 0,
      avg_save_rate:
        agg && agg.saveRates.length > 0
          ? agg.saveRates.reduce((a, b) => a + b, 0) / agg.saveRates.length
          : 0,
      posts: agg?.count || 0,
      last_posted: agg?.lastDate || null,
    });
  }

  return summaries;
}

async function getManagedAccounts(campaignId: string | null): Promise<ManagedAccount[]> {
  const supabase = await createClient();
  let query = supabase
    .from("accounts")
    .select("id, name, handle, active, notes, campaign:campaign_id(slug, name)")
    .order("created_at", { ascending: true });
  if (campaignId) query = query.eq("campaign_id", campaignId);
  // Postgrest expands the embedded relationship as an object when the FK
  // resolves to one row, but the JS typings often see it as an array —
  // normalise here so the consumer always gets `{slug,name} | null`.
  type RawRow = Omit<ManagedAccount, "campaign"> & {
    campaign: { slug: string; name: string } | { slug: string; name: string }[] | null;
  };
  const { data } = await query.returns<RawRow[]>();
  return (data ?? []).map((r) => ({
    ...r,
    campaign: Array.isArray(r.campaign) ? (r.campaign[0] ?? null) : r.campaign,
  }));
}

/**
 * Resolve `?campaign=<slug>` into a campaign id, plus pull the list of
 * non-archived campaigns for the dropdown. Bundled in one fn so the
 * page only does one round-trip for filter-related queries.
 *
 * Returns active=null + the full options list when the slug doesn't
 * match any campaign — graceful, the page still renders with no filter.
 */
async function resolveCampaignFilter(slug: string | null): Promise<{
  active: { id: string; slug: string; name: string } | null;
  options: AccountsFilterCampaign[];
}> {
  const sb = await createClient();
  const { data } = await sb
    .from("campaigns")
    .select("id, slug, name")
    .neq("status", "archived")
    .order("created_at", { ascending: true })
    .returns<Array<{ id: string; slug: string; name: string }>>();
  const options = (data ?? []).map(({ slug, name }) => ({ slug, name }));
  const active = slug
    ? (data ?? []).find((c) => c.slug === slug) ?? null
    : null;
  return { active, options };
}

/**
 * Pull every still-pending creator-account-request, joined with the
 * requesting creator + (optionally) the target campaign so the admin
 * has enough context to approve / reject without clicking through.
 *
 * Also runs the 7-day TTL sweep on stored credentials as a side
 * effect — this is the natural choke-point (admins land here when
 * reviewing requests, so the sweep gets exercised regularly without
 * needing its own cron). Failures are swallowed: if the RPC isn't
 * present yet or the call errors, the page still renders normally.
 */
async function loadPendingRequests(): Promise<PendingAccountRequest[]> {
  const sb = await createClient();
  // Best-effort sweep — fire-and-forget semantics. We await it so
  // the same DB connection isn't reused mid-flight, but we don't
  // surface the result.
  try {
    await sb.rpc("sweep_old_request_passwords");
  } catch {
    // Sweep failures are non-fatal; the on-approve/on-reject wipes
    // are the primary path anyway.
  }
  const { data } = await sb
    .from("creator_account_requests")
    .select(
      "id, handle, display_name, notes, created_at, campaign_id, " +
      "login_identifier, password_set_at, " +
      "creator:creator_id(id, legal_name, display_name, email), " +
      "campaign:campaign_id(name)",
    )
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .returns<Array<{
      id: string; handle: string; display_name: string | null; notes: string | null;
      created_at: string; campaign_id: string | null;
      login_identifier: string | null; password_set_at: string | null;
      creator: { id: string; legal_name: string; display_name: string | null; email: string } |
               { id: string; legal_name: string; display_name: string | null; email: string }[] | null;
      campaign: { name: string } | { name: string }[] | null;
    }>>();
  return (data ?? []).map((r) => {
    const c = Array.isArray(r.creator) ? r.creator[0] : r.creator;
    const camp = Array.isArray(r.campaign) ? r.campaign[0] : r.campaign;
    return {
      id: r.id,
      handle: r.handle,
      display_name: r.display_name,
      notes: r.notes,
      created_at: r.created_at,
      creator_id: c?.id ?? "",
      creator_name: c?.display_name || c?.legal_name || "(unknown creator)",
      creator_email: c?.email ?? "",
      campaign_id: r.campaign_id,
      campaign_name: camp?.name ?? null,
      login_identifier: r.login_identifier,
      // `has_password` is what the admin UI actually needs — a boolean
      // is safer to ship to the client than the timestamp because
      // it gives the panel nothing useful to leak.
      has_password: !!r.password_set_at,
    };
  });
}

export default async function AccountsPage(props: {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}) {
  const searchParams = await props.searchParams;
  const range = typeof searchParams.range === "string" ? searchParams.range : undefined;
  const campaignSlug = typeof searchParams.campaign === "string" ? searchParams.campaign : null;
  const dateFrom = getDateFilter(range);
  // Sequence: auth first (settles the token), then parallel data fetches.
  // Avoids Supabase auth lock contention.
  const user = await getUser();
  const { active: activeCampaign, options: campaignOptions } = await resolveCampaignFilter(campaignSlug);
  const campaignId = activeCampaign?.id ?? null;
  const [accounts, managed, pendingRequests] = await Promise.all([
    getAccountSummaries(dateFrom, campaignId),
    getManagedAccounts(campaignId),
    loadPendingRequests(),
  ]);
  const role = user?.role ?? "viewer";

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-5xl font-semibold tracking-tight">Accounts</h1>
          <p className="text-lg text-muted-foreground mt-2">
            {accounts.length} account{accounts.length !== 1 ? "s" : ""} tracked ·{" "}
            {managed.filter((a) => a.active).length} active in pipeline
            {activeCampaign && (
              <>
                {" "}·{" "}
                <span className="text-foreground font-medium">{activeCampaign.name}</span>
              </>
            )}
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Suspense>
            <AccountsCampaignFilter
              campaigns={campaignOptions}
              activeSlug={activeCampaign?.slug ?? null}
            />
          </Suspense>
          <ExportButton
            data={accounts as unknown as Record<string, unknown>[]}
            filename="accounts"
            columns={[
              { key: "account", label: "Account" },
              { key: "followers", label: "Followers" },
              { key: "views", label: "Views" },
              { key: "likes", label: "Likes" },
              { key: "saves", label: "Saves" },
              { key: "avg_save_rate", label: "Avg Save %" },
              { key: "posts", label: "Posts" },
              { key: "last_posted", label: "Last Posted" },
            ]}
          />
          <Suspense>
            <DateRangeFilter />
          </Suspense>
        </div>
      </div>

      {/* Pending account requests from creators — admins see these
          first so they don't get buried under the managed-accounts
          table. Panel renders nothing when there are 0 pending. */}
      {role === "admin" && <PendingRequestsPanel requests={pendingRequests} />}

      <AccountManager initial={managed} isAdmin={role === "admin"} />

      <div>
        <h2 className="text-2xl font-semibold tracking-tight mb-4">Performance</h2>
        <AccountsTable accounts={accounts} />
      </div>
    </div>
  );
}
