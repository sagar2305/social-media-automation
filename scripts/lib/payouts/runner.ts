/**
 * Calculator runner — the orchestrator that bridges the pure
 * calculator (`./calculator.ts`) and the Postgres-backed `payouts`
 * table.
 *
 * Called from `pull_analytics.ts` after every metrics refresh. For
 * each active assignment on each campaign with a payout config, it:
 *   1. Reads current posts + their freshly-updated metrics
 *   2. Reads the assignment's existing pending payout (if any) so it
 *      can preserve operator-typed manual_adjustments
 *   3. Runs the calculator
 *   4. Upserts the pending payout row
 *
 * Idempotency contract:
 *   - At most ONE pending payout per assignment at a time
 *     (enforced by the partial unique index on payouts).
 *   - Re-running the runner with the same DB state produces a
 *     byte-identical pending payout amount (modulo the snapshot
 *     timestamp, which is stamped fresh each run for audit).
 *
 * NEVER writes ledger entries. The ledger only sees a payout once
 * the operator approves it (Step 3 — dashboard). Until then, the
 * pending amount is fluid as views accumulate.
 *
 * Failure semantics:
 *   - One assignment crashing must not abort the others — every
 *     assignment is processed in its own try/catch.
 *   - One campaign crashing must not abort the others.
 *   - If the runner can't read the DB at all, log + return; the
 *     analytics refresh that called us continues normally.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { calculatePayout } from './calculator.js';
import type {
  Assignment,
  CalculatorPost,
  CampaignPayoutConfig,
  ManualAdjustment,
} from './types.js';

interface RunnerStats {
  campaignsScanned: number;
  campaignsSkipped: number;        // mode='none' or no config
  assignmentsProcessed: number;
  payoutsCreated: number;
  payoutsUpdated: number;
  payoutsCleared: number;          // existing pending zeroed out
  errors: number;
}

function emptyStats(): RunnerStats {
  return {
    campaignsScanned: 0,
    campaignsSkipped: 0,
    assignmentsProcessed: 0,
    payoutsCreated: 0,
    payoutsUpdated: 0,
    payoutsCleared: 0,
    errors: 0,
  };
}

function client(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

/**
 * Auto-attribute untagged posts on a campaign to creators based on
 * two priority rules, evaluated in order.
 *
 * Rule 1 (account-ownership, strong):
 *   If a post is on an account that some team_member creator owns
 *   (creators.owned_account_ids contains the account id), tag the
 *   post with that creator. Captures the team-member share of any
 *   bot-published post on their handle.
 *
 * Rule 2 (single-active-assignment, fallback):
 *   If the campaign has exactly one assignment in status='active'
 *   AND no Rule 1 match, tag the post with that creator. This is
 *   the "Maya is the only UGC creator on MinuteWise" case.
 *
 * Multiple-active-creators-without-account-ownership case is left
 * untouched — there's no fair way to auto-pick which of two UGC
 * creators owns a given post, so the admin tags those manually
 * via the post drawer.
 *
 * Idempotent: only acts on rows where posts.creator_id IS NULL.
 * Returns the number of newly-tagged posts so the caller can log.
 */
async function autoAttributePosts(
  sb: SupabaseClient,
  campaignId: string,
  activeAssignments: Assignment[],
  _log: (msg: string) => void,
): Promise<number> {
  // Pull untagged posts on this campaign. Cheap — typically a small
  // backlog since the runner ticks every analytics refresh.
  const { data: untagged } = await sb
    .from('posts')
    .select('id, account')
    .eq('campaign_id', campaignId)
    .is('creator_id', null)
    .returns<Array<{ id: string; account: string | null }>>();

  if (!untagged || untagged.length === 0) return 0;

  // Resolve account handles → account ids so we can compare against
  // creators.owned_account_ids (which holds account ids, not handles).
  const handles = [...new Set(untagged.map(p => p.account).filter((h): h is string => !!h))];
  const handleToId = new Map<string, string>();
  if (handles.length > 0) {
    const { data: accounts } = await sb
      .from('accounts')
      .select('id, handle')
      .in('handle', handles)
      .returns<Array<{ id: string; handle: string }>>();
    for (const a of accounts ?? []) handleToId.set(a.handle, a.id);
  }

  // Map account-id → team_member creator id (if any team member owns
  // that account). Run-once per pass; cheap enough to not cache.
  const { data: teamCreators } = await sb
    .from('creators')
    .select('id, owned_account_ids, kind')
    .eq('kind', 'team_member')
    .returns<Array<{ id: string; owned_account_ids: string[]; kind: string }>>();
  const accountIdToTeamCreator = new Map<string, string>();
  for (const c of teamCreators ?? []) {
    for (const accId of c.owned_account_ids ?? []) {
      // First-wins if two team_members claim the same account; the
      // operator should fix the conflict, we won't double-tag.
      if (!accountIdToTeamCreator.has(accId)) accountIdToTeamCreator.set(accId, c.id);
    }
  }

  // Lookup the team_member's assignment on this campaign (so we can
  // also set posts.assignment_id correctly). May be null if the
  // team_member isn't assigned to this campaign — Rule 1 still tags
  // the creator_id but leaves assignment_id null in that case.
  const teamCreatorToAssignment = new Map<string, Assignment>();
  for (const a of activeAssignments) teamCreatorToAssignment.set(a.creator_id, a);

  const singleActiveUgc = activeAssignments.length === 1 ? activeAssignments[0] : null;

  let tagged = 0;
  for (const post of untagged) {
    const accId = post.account ? handleToId.get(post.account) : null;
    const teamCreatorId = accId ? accountIdToTeamCreator.get(accId) : null;

    let creatorId: string | null = null;
    let assignmentId: string | null = null;

    if (teamCreatorId) {
      // Rule 1
      creatorId = teamCreatorId;
      assignmentId = teamCreatorToAssignment.get(teamCreatorId)?.id ?? null;
    } else if (singleActiveUgc) {
      // Rule 2
      creatorId = singleActiveUgc.creator_id;
      assignmentId = singleActiveUgc.id;
    }

    if (!creatorId) continue;

    const { error } = await sb
      .from('posts')
      .update({ creator_id: creatorId, assignment_id: assignmentId })
      .eq('id', post.id)
      .is('creator_id', null);              // race guard
    if (!error) tagged++;
  }

  return tagged;
}

/**
 * Process one assignment: fetch its posts + any existing pending
 * payout, run the calculator, upsert the pending payout row.
 *
 * The function is intentionally chatty about what it did so the
 * caller (or operator scanning logs) can trace decisions.
 */
async function processAssignment(
  sb: SupabaseClient,
  config: CampaignPayoutConfig,
  assignment: Assignment,
  log: (msg: string) => void,
): Promise<{ created: boolean; updated: boolean; cleared: boolean }> {
  // Posts linked to this assignment via posts.assignment_id (column
  // added in the Phase 17d Layer 2 migration). We map the existing
  // `date` column to the calculator's `posted_at` field — `date`
  // already holds the post's go-live date in this codebase.
  const { data: postsRaw, error: postsErr } = await sb
    .from('posts')
    .select('id, date, views, saves, status')
    .eq('assignment_id', assignment.id)
    .returns<Array<{
      id: string;
      date: string | null;
      views: number | null;
      saves: number | null;
      status: string | null;
    }>>();

  if (postsErr) {
    throw new Error(`load posts: ${postsErr.message}`);
  }

  const posts: CalculatorPost[] = (postsRaw ?? []).map(p => ({
    id: p.id,
    posted_at: p.date ?? new Date(0).toISOString(),
    views: p.views ?? 0,
    saves: p.saves,
    status: p.status ?? 'unknown',
  }));

  // Existing pending payout — we want to preserve manual_adjustments
  // the operator may have typed in. Other fields get overwritten.
  const { data: existingPending } = await sb
    .from('payouts')
    .select('id, manual_adjustments, amount_cents')
    .eq('assignment_id', assignment.id)
    .eq('status', 'pending')
    .maybeSingle<{
      id: string;
      manual_adjustments: ManualAdjustment[] | null;
      amount_cents: number;
    }>();

  const manualAdjustments = existingPending?.manual_adjustments ?? [];
  const out = calculatePayout({
    config,
    assignment,
    posts,
    metricSnapshotAt: new Date(),
    manualAdjustments,
  });

  // Skip the upsert when the calculator output is zero AND there's
  // no existing pending row. We don't want to spam the table with
  // empty rows for assignments that simply haven't earned anything
  // yet. If a pending row already exists at zero, leave it alone —
  // the operator may want to see the zero and decide to cancel it.
  if (out.amount_cents === 0 && !existingPending) {
    return { created: false, updated: false, cleared: false };
  }

  const computedFrom = {
    rule: out.rule,
    metric_snapshot_at: out.metric_snapshot_at,
    contributing_post_ids: out.contributing_post_ids,
    breakdown: out.breakdown,
  };

  if (existingPending) {
    // Update path — preserves the row id (so any UI links stay
    // valid) and the manual_adjustments column. amount_cents and
    // computed_from get refreshed.
    if (existingPending.amount_cents === out.amount_cents) {
      // No-op update: amount unchanged, but refresh computed_from
      // so the snapshot is current. Don't count it as "updated"
      // for the stats since nothing meaningful changed.
      await sb
        .from('payouts')
        .update({
          computed_from: computedFrom,
          updated_at: new Date().toISOString(),
        })
        .eq('id', existingPending.id);
      return { created: false, updated: false, cleared: false };
    }
    const { error: updateErr } = await sb
      .from('payouts')
      .update({
        amount_cents: out.amount_cents,
        currency: out.currency,
        computed_from: computedFrom,
        updated_at: new Date().toISOString(),
      })
      .eq('id', existingPending.id);
    if (updateErr) throw new Error(`update pending: ${updateErr.message}`);
    log(`  ${assignment.id.slice(0, 8)}…: $${(existingPending.amount_cents / 100).toFixed(2)} → $${(out.amount_cents / 100).toFixed(2)}`);
    return { created: false, updated: true, cleared: false };
  }

  // Insert path — the partial unique index will reject a duplicate
  // pending row if one was created concurrently between our SELECT
  // and INSERT. That's the correct behaviour; we'll just return
  // false and the next runner tick picks it up.
  const { error: insertErr } = await sb.from('payouts').insert({
    creator_id: assignment.creator_id,
    campaign_id: assignment.campaign_id,
    assignment_id: assignment.id,
    amount_cents: out.amount_cents,
    currency: out.currency,
    computed_from: computedFrom,
    manual_adjustments: [],
    status: 'pending',
    processor: null,
  });
  if (insertErr) throw new Error(`insert pending: ${insertErr.message}`);
  log(`  ${assignment.id.slice(0, 8)}…: created pending $${(out.amount_cents / 100).toFixed(2)}`);
  return { created: true, updated: false, cleared: false };
}

/**
 * Recompute pending payouts for one campaign. Returns a stats
 * object the caller can fold into a global tally.
 */
export async function recomputePendingPayoutsForCampaign(
  campaignId: string,
  log: (msg: string) => void = () => {},
): Promise<RunnerStats> {
  const stats = emptyStats();
  const sb = client();
  if (!sb) {
    log('[payouts] supabase env missing — skipping');
    return stats;
  }

  stats.campaignsScanned = 1;

  // Load the rate card config. Mode='none' or no row → nothing to do.
  const { data: config } = await sb
    .from('campaign_payout_configs')
    .select('*')
    .eq('campaign_id', campaignId)
    .maybeSingle<CampaignPayoutConfig>();

  if (!config || config.mode === 'none') {
    stats.campaignsSkipped++;
    return stats;
  }

  // Active + accepted assignments only. Cancelled assignments don't
  // earn even if their old posts are still live.
  const { data: assignments } = await sb
    .from('assignments')
    .select('*')
    .eq('campaign_id', campaignId)
    .in('status', ['accepted', 'active'])
    .returns<Assignment[]>();

  if (!assignments || assignments.length === 0) {
    return stats;
  }

  log(`[payouts] campaign ${campaignId.slice(0, 8)}… mode=${config.mode}, ${assignments.length} active assignment(s)`);

  // Auto-attribute untagged posts BEFORE computing payouts so the
  // assignment-scoped post query downstream (`processAssignment`)
  // picks them up. Two rules in priority order — see helper docstring.
  try {
    const tagged = await autoAttributePosts(sb, campaignId, assignments, log);
    if (tagged > 0) log(`  [auto-attribute] tagged ${tagged} previously-untagged post(s)`);
  } catch (err) {
    // Non-fatal: a failed attribution leaves posts untagged (status quo
    // ante), the operator can still tag manually. We never want a bad
    // attribution pass to block the payout calculation that follows.
    log(`  [auto-attribute] non-fatal error: ${err instanceof Error ? err.message : String(err)}`);
  }

  for (const a of assignments) {
    stats.assignmentsProcessed++;
    try {
      const r = await processAssignment(sb, config, a, log);
      if (r.created) stats.payoutsCreated++;
      if (r.updated) stats.payoutsUpdated++;
      if (r.cleared) stats.payoutsCleared++;
    } catch (err) {
      stats.errors++;
      const msg = err instanceof Error ? err.message : String(err);
      log(`  [payouts] assignment ${a.id.slice(0, 8)}… failed: ${msg}`);
    }
  }
  return stats;
}

/**
 * The entry point `pull_analytics.ts` calls. Iterates every active
 * campaign and recomputes pending payouts for each. Cheap query
 * pattern (one query per campaign) — fine to run on every analytics
 * refresh (~every 6 hours via launchd).
 *
 * Returns a stats summary the caller can log. Never throws.
 */
export async function recomputePendingPayoutsForAllActiveCampaigns(
  log: (msg: string) => void = () => {},
): Promise<RunnerStats> {
  const total = emptyStats();
  const sb = client();
  if (!sb) {
    log('[payouts] supabase env missing — skipping');
    return total;
  }

  const { data: campaigns } = await sb
    .from('campaigns')
    .select('id, slug')
    .eq('status', 'active')
    .returns<Array<{ id: string; slug: string }>>();

  if (!campaigns || campaigns.length === 0) return total;

  for (const c of campaigns) {
    try {
      const s = await recomputePendingPayoutsForCampaign(c.id, log);
      total.campaignsScanned += s.campaignsScanned;
      total.campaignsSkipped += s.campaignsSkipped;
      total.assignmentsProcessed += s.assignmentsProcessed;
      total.payoutsCreated += s.payoutsCreated;
      total.payoutsUpdated += s.payoutsUpdated;
      total.payoutsCleared += s.payoutsCleared;
      total.errors += s.errors;
    } catch (err) {
      total.errors++;
      const msg = err instanceof Error ? err.message : String(err);
      log(`[payouts] campaign ${c.slug} crashed: ${msg}`);
    }
  }

  if (total.assignmentsProcessed > 0 || total.errors > 0) {
    log(
      `[payouts] done — scanned ${total.campaignsScanned} campaign(s), ` +
      `skipped ${total.campaignsSkipped} (mode=none/no-config), ` +
      `processed ${total.assignmentsProcessed} assignment(s), ` +
      `created ${total.payoutsCreated} / updated ${total.payoutsUpdated} pending payout(s)` +
      (total.errors > 0 ? ` (${total.errors} error${total.errors === 1 ? '' : 's'})` : '')
    );
  }
  return total;
}
