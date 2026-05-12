/**
 * /campaigns/[slug]/creators — per-campaign creator roster.
 *
 * Shows all assignments on this campaign with: creator info, post
 * progress (delivered vs expected), earnings-to-date, payout status
 * tally, and a link into the full creator profile.
 *
 * Includes the budget-spent progress bar at the top — the operator's
 * single most-glanced UI element on this tab.
 */

import { notFound } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { ChevronRight, UserPlus, AlertCircle } from "lucide-react";
import type {
  Campaign,
  CampaignPayoutConfig,
  Assignment,
  Creator,
  Payout,
} from "@/lib/types";
import { CampaignAssignCreatorButton } from "./assign-button";
import { ReassignButton } from "./reassign-button";

export const dynamic = "force-dynamic";

interface RosterRow {
  assignment: Assignment;
  creator: Creator;
  posts_delivered: number;
  earned_cents: number;
  pending_cents: number;
  approved_cents: number;
  paid_cents: number;
}

async function load(slug: string): Promise<{
  campaign: Campaign;
  config: CampaignPayoutConfig | null;
  roster: RosterRow[];
  total_budget_cents: number | null;
  total_earned_cents: number;
  total_paid_cents: number;
} | null> {
  const sb = await createClient();
  const { data: campaign } = await sb
    .from("campaigns")
    .select("*")
    .eq("slug", slug)
    .maybeSingle<Campaign>();
  if (!campaign) return null;

  const [{ data: config }, { data: assignments }, { data: payouts }, { data: posts }] = await Promise.all([
    sb.from("campaign_payout_configs").select("*").eq("campaign_id", campaign.id).maybeSingle<CampaignPayoutConfig>(),
    sb.from("assignments").select("*").eq("campaign_id", campaign.id).returns<Assignment[]>(),
    sb.from("payouts").select("creator_id, status, amount_cents").eq("campaign_id", campaign.id).returns<Pick<Payout, "creator_id" | "status" | "amount_cents">[]>(),
    sb.from("posts").select("creator_id, assignment_id").eq("campaign_id", campaign.id).returns<Array<{ creator_id: string | null; assignment_id: string | null }>>(),
  ]);

  if (!assignments || assignments.length === 0) {
    return {
      campaign,
      config: config ?? null,
      roster: [],
      total_budget_cents: config?.total_budget_cents ?? null,
      total_earned_cents: 0,
      total_paid_cents: 0,
    };
  }

  // Pull creator rows for everyone assigned (one round-trip).
  const creatorIds = [...new Set(assignments.map(a => a.creator_id))];
  const { data: creators } = await sb.from("creators").select("*").in("id", creatorIds).returns<Creator[]>();
  const creatorMap = new Map((creators ?? []).map(c => [c.id, c]));

  // Aggregate payouts + post counts per assignment.
  const roster: RosterRow[] = assignments.map((a) => {
    const c = creatorMap.get(a.creator_id);
    if (!c) {
      // Orphan assignment with a deleted creator — render a stub
      // row so the operator can fix the data.
      return {
        assignment: a,
        creator: {
          id: a.creator_id, kind: "ugc", legal_name: "(deleted creator)",
          display_name: null, email: "", country: null,
          preferred_processor: "manual", manual_payout_notes: null,
          owned_account_ids: [], status: "archived",
          invited_at: a.invited_at, onboarded_at: null, created_at: a.invited_at,
          payment_upi_id: null, payment_screenshot_path: null, payment_screenshot_uploaded_at: null,
        },
        posts_delivered: 0,
        earned_cents: 0, pending_cents: 0, approved_cents: 0, paid_cents: 0,
      };
    }
    const myPayouts = (payouts ?? []).filter(p => p.creator_id === a.creator_id);
    const pending = myPayouts.filter(p => p.status === "pending").reduce((s, p) => s + p.amount_cents, 0);
    const approved = myPayouts.filter(p => p.status === "approved" || p.status === "processing").reduce((s, p) => s + p.amount_cents, 0);
    const paid = myPayouts.filter(p => p.status === "paid").reduce((s, p) => s + p.amount_cents, 0);
    const delivered = (posts ?? []).filter(p => p.assignment_id === a.id).length;
    return {
      assignment: a,
      creator: c,
      posts_delivered: delivered,
      earned_cents: pending + approved + paid,
      pending_cents: pending,
      approved_cents: approved,
      paid_cents: paid,
    };
  });

  const total_earned = roster.reduce((s, r) => s + r.earned_cents, 0);
  const total_paid = roster.reduce((s, r) => s + r.paid_cents, 0);

  return {
    campaign,
    config: config ?? null,
    roster,
    total_budget_cents: config?.total_budget_cents ?? null,
    total_earned_cents: total_earned,
    total_paid_cents: total_paid,
  };
}

function fmt(cents: number, currency: string): string {
  const sym = currency === "USD" ? "$" : currency === "INR" ? "₹" : currency === "EUR" ? "€" : currency === "GBP" ? "£" : "";
  return `${sym}${(cents / 100).toFixed(2)}`;
}

export default async function CampaignCreatorsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const data = await load(slug);
  if (!data) notFound();

  const { campaign, config, roster, total_budget_cents, total_earned_cents, total_paid_cents } = data;
  const currency = config?.currency ?? "USD";
  const utilizationPct = total_budget_cents && total_budget_cents > 0
    ? Math.min(100, (total_earned_cents / total_budget_cents) * 100)
    : null;

  return (
    <div className="space-y-5">
      {/* Soft-warn when the campaign has no payout config — without it,
          the runner skips this campaign and no payouts ever materialise. */}
      {(!config || config.mode === "none") && (
        <div className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-50 dark:bg-amber-500/5 px-3 py-2 text-xs">
          <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600" />
          <div className="flex-1">
            <p className="font-medium text-foreground">No payout configuration on this campaign yet.</p>
            <p className="text-muted-foreground mt-0.5">
              Set a rate card on the{" "}
              <Link href={`/campaigns/${slug}/edit`} className="text-primary underline-offset-4 hover:underline">Edit page</Link>
              {" "}so the calculator knows how much each creator earns.
            </p>
          </div>
        </div>
      )}

      {/* Budget bar */}
      {total_budget_cents && total_budget_cents > 0 && (
        <Card>
          <CardContent className="py-4">
            <div className="flex items-center justify-between mb-2 text-xs">
              <span className="text-muted-foreground">Budget utilization</span>
              <span className="tabular-nums font-medium">
                {fmt(total_earned_cents, currency)} earned / {fmt(total_budget_cents, currency)} budget
              </span>
            </div>
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div
                className={`h-full transition-all ${
                  utilizationPct! >= 90 ? "bg-destructive" :
                  utilizationPct! >= 80 ? "bg-amber-500" :
                  "bg-primary"
                }`}
                style={{ width: `${utilizationPct}%` }}
              />
            </div>
            <div className="flex items-center justify-between mt-2 text-[11px] text-muted-foreground">
              <span>{utilizationPct!.toFixed(1)}% used</span>
              <span>
                {fmt(total_paid_cents, currency)} paid externally · {fmt(total_earned_cents - total_paid_cents, currency)} outstanding
              </span>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Header + invite */}
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-base font-semibold">Creators on {campaign.name}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            Assignments + delivery progress. Click a row for the creator&apos;s full profile.
          </p>
        </div>
        <CampaignAssignCreatorButton campaignId={campaign.id} multipliers={config?.multipliers ?? []} />
      </div>

      {/* Roster */}
      {roster.length === 0 ? (
        <Card className="border-dashed border border-border/60">
          <CardContent className="py-10 text-center text-sm text-muted-foreground space-y-3">
            <p>No creators assigned yet.</p>
            <CampaignAssignCreatorButton campaignId={campaign.id} multipliers={config?.multipliers ?? []} variant="outline" label="Assign your first creator" />
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="py-0 divide-y divide-border/60">
            {roster.map((row) => (
              <div
                key={row.assignment.id}
                className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
              >
                {/* Whole-row click → creator profile, except the
                    Reassign button which has its own stop-propagation. */}
                <Link
                  href={`/creators/${row.creator.id}`}
                  className="flex items-center justify-between gap-3 min-w-0 flex-1"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium flex items-center gap-2">
                      {row.creator.display_name || row.creator.legal_name}
                      <StatusBadge status={row.assignment.status} />
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {row.posts_delivered} / {row.assignment.expected_posts} posts ·{" "}
                      {row.creator.email}
                      {row.assignment.rate_override_cents != null && (
                        <> · <span className="font-mono">{fmt(row.assignment.rate_override_cents, currency)}/post override</span></>
                      )}
                      {row.assignment.applied_multipliers.length > 0 && (
                        <> · {row.assignment.applied_multipliers.length} multiplier{row.assignment.applied_multipliers.length === 1 ? "" : "s"}</>
                      )}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums">{fmt(row.earned_cents, currency)}</p>
                    <p className="text-[10px] text-muted-foreground">
                      {row.pending_cents > 0 && <span className="text-amber-600">{fmt(row.pending_cents, currency)} pending</span>}
                      {row.pending_cents > 0 && row.paid_cents > 0 && " · "}
                      {row.paid_cents > 0 && <span className="text-emerald-600">{fmt(row.paid_cents, currency)} paid</span>}
                    </p>
                  </div>
                </Link>

                {/* Actions column — only the Reassign button for now,
                    only shown when there's remaining work to hand off
                    AND the assignment is still active/accepted. */}
                <div className="flex items-center gap-2 shrink-0 pl-2 border-l border-border/40 ml-1">
                  {(row.assignment.status === "active" || row.assignment.status === "accepted") && (
                    <ReassignButton
                      assignmentId={row.assignment.id}
                      currentCreatorId={row.creator.id}
                      currentCreatorName={row.creator.display_name || row.creator.legal_name}
                      campaignId={campaign.id}
                      postsDelivered={row.posts_delivered}
                      expectedPosts={row.assignment.expected_posts}
                    />
                  )}
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function StatusBadge({ status }: { status: Assignment["status"] }) {
  const colour =
    status === "active"     ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400" :
    status === "completed"  ? "bg-blue-500/15 text-blue-700 dark:text-blue-400" :
    status === "pending"    ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" :
    "bg-muted text-muted-foreground";
  return (
    <span className={`inline-flex items-center rounded-full px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wider ${colour}`}>
      {status}
    </span>
  );
}
