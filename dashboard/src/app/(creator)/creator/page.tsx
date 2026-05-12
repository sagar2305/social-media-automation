/**
 * /creator — earnings landing page.
 *
 * Mirrors the admin /creators/[id] earnings card but with first-person
 * copy and stripped of internal-only fields (ledger txn ids, payout
 * id slugs, multipliers menu, etc.). One-page summary that answers
 * "what have I earned, what's the status of each chunk, when do I
 * get paid".
 */

import { requireCreator } from "@/lib/auth";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import Link from "next/link";
import { Wallet, ArrowRight, Inbox } from "lucide-react";
import type { Assignment, Campaign, CampaignPayoutConfig, PayoutWithJoins } from "@/lib/types";
import { CampaignProgressCard } from "./campaign-progress";
import { InviteCard } from "./invite-card";
import { PaymentInfoCard } from "./payment-info-card";
import { AddAccountCard, type CreatorAccountRequest } from "./add-account-card";

export const dynamic = "force-dynamic";

function fmtUsd(cents: number, currency: string = "USD"): string {
  const sym = currency === "USD" ? "$" : currency === "INR" ? "₹" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "";
  return `${sym}${(cents / 100).toFixed(2)}`;
}

/**
 * Time-of-day greeting — small touch that makes the dashboard feel
 * alive on a returning visit. Falls back to "Welcome back" if anything
 * is off (server timezone vs creator timezone is fine here; a creator
 * in another timezone might see "Good evening" at noon, no harm done).
 */
function greet(): string {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
}

function statusLabel(s: string): string {
  switch (s) {
    case "pending": return "Pending review";
    case "approved":
    case "processing": return "Approved";
    case "paid": return "Paid";
    case "cancelled": return "Cancelled";
    default: return s;
  }
}

function statusDotClass(s: string): string {
  switch (s) {
    case "pending": return "bg-amber-500";
    case "approved":
    case "processing": return "bg-blue-500";
    case "paid": return "bg-emerald-500";
    default: return "bg-muted-foreground";
  }
}

export default async function CreatorHome() {
  const { creator } = await requireCreator();
  const sb = await createClient();

  // Pull payouts (with campaign), assignments (with campaign), the
  // payout configs for those campaigns, and the post counts per
  // assignment in parallel — one round-trip per shape.
  const [{ data: payouts }, { data: assignments }, { data: posts }] = await Promise.all([
    sb.from("payouts")
      .select("*, campaign:campaign_id(id, slug, name)")
      .eq("creator_id", creator.id)
      .order("created_at", { ascending: false })
      .returns<PayoutWithJoins[]>(),
    sb.from("assignments")
      .select("*, campaign:campaign_id(id, slug, name, status)")
      .eq("creator_id", creator.id)
      .returns<Array<Assignment & { campaign: Pick<Campaign,"id"|"slug"|"name"|"status"> | Pick<Campaign,"id"|"slug"|"name"|"status">[] }>>(),
    sb.from("posts")
      .select("assignment_id, campaign_id, account, views, likes")
      .eq("creator_id", creator.id)
      .returns<Array<{
        assignment_id: string | null;
        campaign_id: string | null;
        account: string | null;
        views: number | null;
        likes: number | null;
      }>>(),
  ]);

  // Creator's account requests (any status). Joined with campaign
  // so we can label which campaign each pending request is for.
  const { data: accountRequests } = await sb
    .from("creator_account_requests")
    .select("*, campaign:campaign_id(name)")
    .eq("creator_id", creator.id)
    .order("created_at", { ascending: false })
    .returns<Array<{
      id: string; handle: string; display_name: string | null;
      campaign_id: string | null;
      campaign: { name: string } | { name: string }[] | null;
      notes: string | null; status: string; created_at: string;
      rejection_reason: string | null;
    }>>();
  const flattenedRequests: CreatorAccountRequest[] = (accountRequests ?? []).map((r) => {
    const camp = Array.isArray(r.campaign) ? r.campaign[0] : r.campaign;
    return {
      id: r.id,
      handle: r.handle,
      display_name: r.display_name,
      campaign_id: r.campaign_id,
      campaign_name: camp?.name ?? null,
      notes: r.notes,
      status: r.status as "pending" | "approved" | "rejected",
      created_at: r.created_at,
      rejection_reason: r.rejection_reason,
    };
  });

  const safe: PayoutWithJoins[] = (payouts ?? []).map((p) => ({
    ...p,
    campaign: Array.isArray(p.campaign) ? p.campaign[0] : p.campaign,
  })) as PayoutWithJoins[];

  const safeAssignments = (assignments ?? []).map((a) => ({
    ...a,
    campaign: Array.isArray(a.campaign) ? a.campaign[0] : a.campaign,
  }));

  // Single fetch of every payout config touching one of this creator's
  // campaigns. Map by campaign_id for O(1) lookup in the render loop.
  const campaignIds = [...new Set(safeAssignments.map((a) => a.campaign_id))];
  const { data: configs } = campaignIds.length > 0
    ? await sb.from("campaign_payout_configs").select("*").in("campaign_id", campaignIds).returns<CampaignPayoutConfig[]>()
    : { data: [] as CampaignPayoutConfig[] };
  const configByCampaign = new Map((configs ?? []).map((c) => [c.campaign_id, c]));

  const postsByAssignment = new Map<string, number>();
  for (const p of posts ?? []) {
    if (!p.assignment_id) continue;
    postsByAssignment.set(p.assignment_id, (postsByAssignment.get(p.assignment_id) ?? 0) + 1);
  }

  // Accounts assigned to this creator. Two sources combine into one
  // list so both kinds of creator get a sensible view:
  //   - team_members: every account in their owned_account_ids
  //     (always, even before any posts exist)
  //   - UGC creators: every unique account handle the admin has
  //     tagged their posts on (post-derived)
  // Each handle merged once; team-member ownership wins the "owned"
  // flag so the badge renders correctly.
  type AccountSummary = {
    handle: string;
    name: string;
    owned: boolean;
    posts: number;
    views: number;
    likes: number;
  };
  const accountsMap = new Map<string, AccountSummary>();

  // 1. Pull post-derived account stats first.
  for (const p of posts ?? []) {
    if (!p.account) continue;
    const cur = accountsMap.get(p.account) ?? {
      handle: p.account,
      name: `@${p.account}`,
      owned: false,
      posts: 0,
      views: 0,
      likes: 0,
    };
    cur.posts += 1;
    cur.views += p.views ?? 0;
    cur.likes += p.likes ?? 0;
    accountsMap.set(p.account, cur);
  }

  // 2. For team_member creators, layer on the owned accounts. We have
  // owned_account_ids on the creator row — resolve to handles via the
  // accounts table so the UI can show real names, not just UUIDs.
  if (creator.kind === "team_member" && (creator.owned_account_ids ?? []).length > 0) {
    const { data: ownedAccounts } = await sb
      .from("accounts")
      .select("id, name, handle")
      .in("id", creator.owned_account_ids)
      .returns<Array<{ id: string; name: string; handle: string }>>();
    for (const a of ownedAccounts ?? []) {
      const cur = accountsMap.get(a.handle);
      if (cur) {
        cur.owned = true;
        cur.name = a.name;          // prefer the canonical display name
      } else {
        accountsMap.set(a.handle, {
          handle: a.handle,
          name: a.name,
          owned: true,
          posts: 0,
          views: 0,
          likes: 0,
        });
      }
    }
  }
  // Sort: owned first (team_members care about those), then by post
  // count desc within each group.
  const accountsList = [...accountsMap.values()].sort((a, b) => {
    if (a.owned !== b.owned) return a.owned ? -1 : 1;
    return b.posts - a.posts;
  });

  const pending = safe.filter((p) => p.status === "pending").reduce((s, p) => s + p.amount_cents, 0);
  const approved = safe.filter((p) => p.status === "approved" || p.status === "processing").reduce((s, p) => s + p.amount_cents, 0);
  const paid = safe.filter((p) => p.status === "paid").reduce((s, p) => s + p.amount_cents, 0);
  const total = pending + approved + paid;

  const firstName = (creator.display_name || creator.legal_name).replace(/^@/, "").split(/\s+/)[0];
  const pendingInvites = safeAssignments.filter((a) => a.status === "pending");
  const activeAssignments = safeAssignments.filter((a) => a.status === "active" || a.status === "accepted" || a.status === "completed");

  return (
    <div className="space-y-10">
      {/* Greeting — kept lightweight; the hero card below carries the
          actual visual weight. */}
      <div>
        <p className="text-xs font-medium text-emerald-700/80 dark:text-emerald-400/80 uppercase tracking-widest">
          {greet()}
        </p>
        <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight mt-1">
          Welcome back, {firstName}.
        </h1>
        <p className="text-muted-foreground mt-2 text-sm max-w-prose">
          Your earnings, the campaigns you&apos;re on, and a transparent
          breakdown of every cent.
        </p>
      </div>

      {/* Hero earnings card — full-width emerald gradient with decorative
          floating-dot pattern (Stripe Express vibe), a giant total
          number, and three sub-metrics laid out as separate tiles. */}
      <section className="relative overflow-hidden rounded-2xl border border-emerald-500/25 bg-gradient-to-br from-emerald-500/[0.10] via-emerald-500/[0.04] to-transparent shadow-sm">
        {/* Decorative dot pattern in the top-right corner. Pure CSS,
            tiny SVG inline. Hidden on small screens to keep mobile
            layouts uncluttered. */}
        <div
          aria-hidden
          className="hidden sm:block absolute -top-6 -right-6 h-44 w-44 opacity-40 [background-image:radial-gradient(theme(colors.emerald.500/0.5)_1px,transparent_1px)] [background-size:14px_14px]"
        />

        <div className="relative px-6 sm:px-8 py-8 sm:py-9 space-y-6">
          <div className="flex items-center gap-2">
            <Wallet className="h-3.5 w-3.5 text-emerald-700/80 dark:text-emerald-400/80" />
            <p className="text-[10px] font-semibold uppercase tracking-widest text-emerald-700/80 dark:text-emerald-400/80">
              Total earned
            </p>
            <span className="text-muted-foreground/60">·</span>
            <p className="text-[10px] text-muted-foreground">
              {safe.length} payout{safe.length === 1 ? "" : "s"}
            </p>
          </div>
          <p className="text-6xl sm:text-7xl font-bold tabular-nums tracking-tighter leading-none">
            {fmtUsd(total)}
          </p>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-4 border-t border-emerald-500/15">
            <SubMetric label="Pending review" value={fmtUsd(pending)} hint="Awaiting your contact's approval" accent="amber" />
            <SubMetric label="Approved" value={fmtUsd(approved)} hint="Approved, payment on the way" accent="blue" />
            <SubMetric label="Paid" value={fmtUsd(paid)} hint="Already sent to you" accent="emerald" />
          </div>
        </div>
      </section>

      {/* Pending invites — high-priority surface so it's at the top, not
          buried in the campaign list. */}
      {pendingInvites.length > 0 && (
        <section>
          <SectionHeader
            label="Pending invites"
            count={pendingInvites.length}
            hint="Review the terms before accepting"
          />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {pendingInvites.map((a) => (
              <InviteCard
                key={a.id}
                assignment={a}
                campaign={a.campaign}
                config={configByCampaign.get(a.campaign_id) ?? null}
              />
            ))}
          </div>
        </section>
      )}

      {/* Active campaigns — only renders the section when there's
          actually data, so a brand-new creator's page stays clean. */}
      {activeAssignments.length > 0 && (
        <section>
          <SectionHeader label="Campaigns you're on" count={activeAssignments.length} />
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {activeAssignments.map((a) => (
              <CampaignProgressCard
                key={a.id}
                campaign={a.campaign}
                assignment={a}
                config={configByCampaign.get(a.campaign_id) ?? null}
                postsDelivered={postsByAssignment.get(a.id) ?? 0}
              />
            ))}
          </div>
        </section>
      )}

      {/* Accounts assigned to this creator. For team_member creators,
          this is their owned handle(s) (auto-attribution); for UGC
          creators, the list is derived from posts the admin has
          tagged to them. Renders the union, sorted owned-first. */}
      {accountsList.length > 0 && (
        <section>
          <SectionHeader
            label="Your accounts"
            count={accountsList.length}
            hint={creator.kind === "team_member"
              ? "Handles assigned to you + handles your tagged posts went live on"
              : "Handles your tagged posts went live on"}
          />
          <div className="rounded-2xl border border-border bg-card overflow-hidden">
            <div className="divide-y divide-border/40">
              {accountsList.map((a) => (
                <div
                  key={a.handle}
                  className="flex items-center justify-between gap-3 px-5 py-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium flex items-center gap-2 truncate">
                      @{a.handle}
                      {a.owned && (
                        <span className="inline-flex items-center rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 px-1.5 py-0.5 text-[9px] uppercase tracking-widest font-semibold">
                          Owned
                        </span>
                      )}
                    </p>
                    {a.name !== `@${a.handle}` && (
                      <p className="text-[11px] text-muted-foreground mt-0.5 truncate">{a.name}</p>
                    )}
                  </div>
                  <div className="flex items-center gap-5 shrink-0 text-sm tabular-nums">
                    <div className="text-right">
                      <p className="font-semibold">{a.posts.toLocaleString("en-US")}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest">posts</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{a.views.toLocaleString("en-US")}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest">views</p>
                    </div>
                    <div className="text-right">
                      <p className="font-semibold">{a.likes.toLocaleString("en-US")}</p>
                      <p className="text-[10px] text-muted-foreground uppercase tracking-widest">likes</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {/* Add-your-own-account card. Always rendered (even with no
          campaigns / no requests yet) so the affordance is discoverable. */}
      <AddAccountCard
        campaigns={activeAssignments.map((a) => ({
          id: a.campaign.id,
          slug: a.campaign.slug,
          name: a.campaign.name,
        }))}
        requests={flattenedRequests}
      />

      {/* Two-up: payment info on the left (editable — creator's UPI ID +
          screenshot), recent payouts on the right. Payment info is the
          creator's primary lever for getting paid faster, so it stays
          above the fold even on narrow screens. */}
      <section className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-2">
          <PaymentInfoCard
            creatorId={creator.id}
            initialUpiId={creator.payment_upi_id}
            initialScreenshotPath={creator.payment_screenshot_path}
            initialUploadedAt={creator.payment_screenshot_uploaded_at}
          />
        </div>

        {/* Recent payouts list — friendlier than a table; status dot lets
            the creator triage at a glance. */}
        <div className="lg:col-span-3">
          <div className="rounded-2xl border border-border bg-card h-full overflow-hidden">
            <div className="flex items-baseline justify-between px-5 sm:px-6 pt-5 sm:pt-6 pb-3">
              <p className="text-sm font-semibold">Recent payouts</p>
              {safe.length > 0 && (
                <Link
                  href="/creator/payments"
                  className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
                >
                  See all <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
            {safe.length === 0 ? (
              <div className="px-5 sm:px-6 pb-6 pt-2">
                <div className="rounded-xl border border-dashed border-border/60 bg-muted/20 px-5 py-8 text-center space-y-2">
                  <Inbox className="h-5 w-5 text-muted-foreground/60 mx-auto" />
                  <p className="text-sm font-medium">No payouts yet</p>
                  <p className="text-xs text-muted-foreground max-w-xs mx-auto">
                    Once your posts qualify, the calculator creates the first
                    payout automatically.
                  </p>
                </div>
              </div>
            ) : (
              <div className="divide-y divide-border/40">
                {safe.slice(0, 5).map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-4 px-5 sm:px-6 py-3 hover:bg-muted/30 transition-colors"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <span className={`h-2 w-2 rounded-full shrink-0 ${statusDotClass(p.status)}`} />
                      <div className="min-w-0">
                        <p className="text-sm font-medium truncate">{p.campaign?.name ?? "Campaign"}</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {new Date(p.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                          {" · "}
                          {statusLabel(p.status)}
                        </p>
                      </div>
                    </div>
                    <p className="text-sm font-semibold tabular-nums shrink-0">
                      {fmtUsd(p.amount_cents, p.currency)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Empty-state hero shows when nothing else is on the page —
          new creators with no invites + no payouts + no active campaigns
          would otherwise stare at a single $0.00 hero. */}
      {pendingInvites.length === 0 && activeAssignments.length === 0 && safe.length === 0 && (
        <section className="rounded-2xl border border-dashed border-border/60 bg-muted/20 px-6 py-10 text-center">
          <p className="text-sm font-medium">All set up — nothing here yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-md mx-auto">
            Once your contact sends an invite or tags a post to you, it&apos;ll
            show up on this page right away.
          </p>
        </section>
      )}
    </div>
  );
}

function SectionHeader({ label, count, hint }: { label: string; count?: number; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between mb-4">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold tracking-tight">{label}</h2>
        {typeof count === "number" && count > 0 && (
          <span className="inline-flex items-center justify-center min-w-[1.25rem] h-5 px-1.5 rounded-full bg-muted text-[10px] font-semibold tabular-nums text-muted-foreground">
            {count}
          </span>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function SubMetric({ label, value, hint, accent }: { label: string; value: string; hint: string; accent: "amber" | "blue" | "emerald" }) {
  const dotColour =
    accent === "amber" ? "bg-amber-500" :
    accent === "blue" ? "bg-blue-500" :
    "bg-emerald-500";
  return (
    <div className="rounded-xl bg-background/60 backdrop-blur-sm border border-border/40 px-4 py-3">
      <div className="flex items-center gap-1.5">
        <span className={`h-1.5 w-1.5 rounded-full ${dotColour}`} />
        <p className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium">{label}</p>
      </div>
      <p className="text-2xl font-semibold tabular-nums mt-1">{value}</p>
      <p className="text-[11px] text-muted-foreground mt-1 leading-relaxed">{hint}</p>
    </div>
  );
}
