/**
 * Creator-payout calculator (Phase 17d).
 *
 * Pure, deterministic, side-effect-free: given a campaign rate-card
 * config + an assignment + the assignment's posts + a metric snapshot
 * timestamp, return the amount the creator is owed plus a
 * line-by-line breakdown.
 *
 * Industry pattern this implements:
 *   - Flat (per-post fixed)
 *   - CPM (per-1000-views)
 *   - Hybrid (flat base + CPM kicker above per-post threshold)
 *   - Milestone (bonus tiers when a post crosses a view threshold)
 *
 * Plus the universal multiplier menu (usage rights / exclusivity /
 * rush / etc.) and operator-typed manual adjustments.
 *
 * The breakdown is the killer feature — every cent traces to a
 * labelled line. The dashboard renders the breakdown verbatim, so
 * operators (and creators in disputes) can see exactly how the total
 * was reached. See `BreakdownLine` for the shape.
 *
 * NOT covered by this function (intentionally):
 *   - Reading from the database — that's `./db.ts`.
 *   - Writing the result anywhere — caller decides whether to upsert
 *     a payouts row, just preview, etc.
 *   - Currency conversion — every line stays in `config.currency`.
 *     Multi-currency campaigns are out of scope for v1.
 *
 * Determinism rule: same inputs → byte-identical output. Run the
 * calculator a hundred times with the same `metricSnapshotAt` and
 * the breakdown array equality check passes every time. This is
 * what makes the upsert keyed on (assignment_id) safe.
 */

import type {
  CalculatorInput,
  CalculatorOutput,
  BreakdownLine,
  CalculatorPost,
  CampaignPayoutConfig,
  ManualAdjustment,
} from './types.js';

const MS_PER_DAY = 86_400_000;

/**
 * Round half-away-from-zero. JS's default `Math.round` rounds half
 * to positive infinity (so -0.5 rounds to 0, not -1) which gives
 * asymmetric behaviour for negative adjustments. Money math wants
 * symmetric rounding.
 */
function roundCents(n: number): number {
  return Math.sign(n) * Math.round(Math.abs(n));
}

/**
 * Subset of posts that are "frozen enough" for the CPM rule. A post
 * just published 5 minutes ago has misleading views; the operator
 * sets `cpm_view_window_days` (typical: 7-14 days) to wait until the
 * organic decay curve has flattened.
 *
 * `null` window means "include immediately" — useful for flat-only
 * campaigns where view counts don't matter.
 */
function postIsCpmEligible(p: CalculatorPost, windowDays: number, snapshotAt: Date): boolean {
  if (p.status !== 'published') return false;
  if (windowDays <= 0) return true;
  const postedAt = new Date(p.posted_at).getTime();
  const cutoff = snapshotAt.getTime() - windowDays * MS_PER_DAY;
  return postedAt <= cutoff;
}

/**
 * Posts that count toward the flat-per-post rule. Less restrictive
 * than CPM eligibility — flat fees pay on delivery, not on view
 * stabilisation. We still require status=published so abandoned
 * drafts don't earn a fee.
 */
function postIsFlatEligible(p: CalculatorPost): boolean {
  return p.status === 'published';
}

// ─── Per-mode helpers ──────────────────────────────────────────

function computeFlat(
  posts: CalculatorPost[],
  config: CampaignPayoutConfig,
): { cents: number; lines: BreakdownLine[]; contributing: string[] } {
  const eligible = posts.filter(postIsFlatEligible);
  const rate = config.flat_per_post_cents ?? 0;
  if (rate <= 0 || eligible.length === 0) return { cents: 0, lines: [], contributing: [] };

  const cents = eligible.length * rate;
  return {
    cents,
    lines: [{
      label: `${eligible.length} delivered post${eligible.length === 1 ? '' : 's'} × $${(rate / 100).toFixed(2)} flat fee`,
      cents,
      kind: 'base',
      meta: { post_count: eligible.length, rate_cents: rate },
    }],
    contributing: eligible.map(p => p.id),
  };
}

function computeCpm(
  posts: CalculatorPost[],
  config: CampaignPayoutConfig,
  snapshotAt: Date,
  thresholdViews: number,    // 0 for pure CPM, hybrid_threshold_views for hybrid
): { cents: number; lines: BreakdownLine[]; contributing: string[] } {
  const cpm = config.cpm_cents ?? 0;
  if (cpm <= 0) return { cents: 0, lines: [], contributing: [] };

  const eligible = posts.filter(p => postIsCpmEligible(p, config.cpm_view_window_days, snapshotAt));
  if (eligible.length === 0) return { cents: 0, lines: [], contributing: [] };

  let total = 0;
  const lines: BreakdownLine[] = [];
  const contributing: string[] = [];

  for (const p of eligible) {
    const eligibleViews = Math.max(0, p.views - thresholdViews);
    if (eligibleViews <= 0) continue;
    const earned = roundCents((eligibleViews / 1000) * cpm);
    if (earned <= 0) continue;
    total += earned;
    contributing.push(p.id);
    lines.push({
      label: thresholdViews > 0
        ? `Post ${p.id.slice(0, 6)}… ${p.views.toLocaleString()} views → ${eligibleViews.toLocaleString()} above threshold → $${(earned / 100).toFixed(2)}`
        : `Post ${p.id.slice(0, 6)}… ${p.views.toLocaleString()} views × $${(cpm / 100).toFixed(2)} CPM → $${(earned / 100).toFixed(2)}`,
      cents: earned,
      kind: 'cpm',
      post_id: p.id,
      meta: { views: p.views, eligible_views: eligibleViews, cpm_cents: cpm },
    });
  }

  return { cents: total, lines, contributing };
}

function computeMilestones(
  posts: CalculatorPost[],
  config: CampaignPayoutConfig,
  snapshotAt: Date,
): { cents: number; lines: BreakdownLine[]; contributing: string[] } {
  if (!config.milestones || config.milestones.length === 0) {
    return { cents: 0, lines: [], contributing: [] };
  }
  const eligible = posts.filter(p => postIsCpmEligible(p, config.cpm_view_window_days, snapshotAt));
  if (eligible.length === 0) return { cents: 0, lines: [], contributing: [] };

  // Sort tiers ascending so we award the highest tier the post hits
  // (ladder semantics — a post that hit 1M doesn't double-pay the 100k tier).
  const tiers = [...config.milestones].sort((a, b) => a.views - b.views);

  let total = 0;
  const lines: BreakdownLine[] = [];
  const contributing: string[] = [];

  for (const p of eligible) {
    let highestTier: typeof tiers[number] | null = null;
    for (const t of tiers) {
      if (p.views >= t.views) highestTier = t;
    }
    if (!highestTier) continue;
    total += highestTier.bonus_cents;
    contributing.push(p.id);
    lines.push({
      label: `Post ${p.id.slice(0, 6)}… hit ${highestTier.views.toLocaleString()}-view milestone → $${(highestTier.bonus_cents / 100).toFixed(2)} bonus`,
      cents: highestTier.bonus_cents,
      kind: 'milestone',
      post_id: p.id,
      meta: { milestone_views: highestTier.views, views: p.views },
    });
  }
  return { cents: total, lines, contributing };
}

// ─── Multipliers + adjustments ─────────────────────────────────

function applyMultipliers(
  subtotalCents: number,
  config: CampaignPayoutConfig,
  appliedMultiplierIds: string[],
): { cents: number; lines: BreakdownLine[] } {
  if (subtotalCents === 0) return { cents: 0, lines: [] };
  if (!config.multipliers || appliedMultiplierIds.length === 0) {
    return { cents: 0, lines: [] };
  }

  let total = 0;
  const lines: BreakdownLine[] = [];

  for (const id of appliedMultiplierIds) {
    const m = config.multipliers.find(x => x.id === id);
    if (!m || m.pct === 0) continue;
    const delta = roundCents((subtotalCents * m.pct) / 100);
    total += delta;
    const sign = m.pct > 0 ? '+' : '';
    lines.push({
      label: `${m.label} (${sign}${m.pct}%)`,
      cents: delta,
      kind: 'multiplier',
      meta: { multiplier_id: id, pct: m.pct },
    });
  }
  return { cents: total, lines };
}

function applyManualAdjustments(
  adjustments: ManualAdjustment[],
): { cents: number; lines: BreakdownLine[] } {
  let total = 0;
  const lines: BreakdownLine[] = [];

  for (const a of adjustments) {
    let delta: number;
    if (a.kind === 'add') delta = a.cents;
    else if (a.kind === 'subtract') delta = -a.cents;
    else continue;   // 'override' is handled by the caller, not here
    total += delta;
    lines.push({
      label: a.note ? `${a.label} (${a.note})` : a.label,
      cents: delta,
      kind: 'adjustment',
    });
  }
  return { cents: total, lines };
}

// ─── Public API ────────────────────────────────────────────────

/**
 * Compute the amount owed for one assignment, given its rate card,
 * its posts, and the metric snapshot point-in-time. Returns the
 * total + a verbose breakdown the dashboard renders verbatim.
 *
 * Behaviour rules baked in:
 *   - mode='none' or mode missing → returns 0 with no lines
 *   - mode='flat' → flat * delivered posts
 *   - mode='cpm'  → Σ per-post (views/1000 × cpm) for posts past the
 *                   cpm_view_window_days
 *   - mode='hybrid' → flat base + CPM kicker on views above
 *                     hybrid_threshold_views, per post
 *   - mode='milestone' → ladder bonus tiers; each post earns at most
 *                        one tier (the highest it crosses)
 *   - assignment.rate_override_cents replaces the campaign config's
 *     flat_per_post_cents for THIS assignment only (negotiated rate
 *     for premium creators)
 *   - Multipliers apply to the SUBTOTAL of base+cpm+milestone, before
 *     manual adjustments
 *   - Manual adjustments are added/subtracted last and never
 *     multiplied
 *   - Final amount is clamped at >= 0 (no negative payouts ever)
 *
 * The function never throws on bad data; it logs nothing and just
 * returns the safe-default zero. The caller is responsible for
 * surfacing "this campaign has no payout config" / "no eligible
 * posts" messaging.
 */
export function calculatePayout(input: CalculatorInput): CalculatorOutput {
  const { config, assignment, posts, metricSnapshotAt, manualAdjustments } = input;

  const mode = config.mode ?? 'none';

  if (mode === 'none') {
    return {
      amount_cents: 0,
      currency: config.currency ?? 'USD',
      breakdown: [],
      metric_snapshot_at: metricSnapshotAt.toISOString(),
      rule: 'none',
      contributing_post_ids: [],
    };
  }

  // Per-assignment rate override replaces the flat fee just for this
  // creator (negotiated premium / nano-tier discount). It does NOT
  // override the CPM rate or multipliers.
  const effectiveConfig: CampaignPayoutConfig = assignment.rate_override_cents != null
    ? { ...config, flat_per_post_cents: assignment.rate_override_cents }
    : config;

  const allLines: BreakdownLine[] = [];
  const allContributing = new Set<string>();
  let subtotal = 0;

  // 1. Base / CPM / Milestone — depending on mode
  if (mode === 'flat' || mode === 'hybrid') {
    const { cents, lines, contributing } = computeFlat(posts, effectiveConfig);
    subtotal += cents;
    allLines.push(...lines);
    contributing.forEach(id => allContributing.add(id));
  }

  if (mode === 'cpm' || mode === 'hybrid') {
    const threshold = mode === 'hybrid' ? (effectiveConfig.hybrid_threshold_views ?? 0) : 0;
    const { cents, lines, contributing } = computeCpm(posts, effectiveConfig, metricSnapshotAt, threshold);
    subtotal += cents;
    allLines.push(...lines);
    contributing.forEach(id => allContributing.add(id));
  }

  if (mode === 'milestone') {
    const { cents, lines, contributing } = computeMilestones(posts, effectiveConfig, metricSnapshotAt);
    subtotal += cents;
    allLines.push(...lines);
    contributing.forEach(id => allContributing.add(id));
  }

  // Subtotal marker line for the dashboard before multipliers/adjustments
  if (allLines.length > 0) {
    allLines.push({
      label: 'Subtotal',
      cents: subtotal,
      kind: 'subtotal',
    });
  }

  // 2. Multipliers (usage rights / exclusivity / rush / etc.)
  const m = applyMultipliers(subtotal, effectiveConfig, assignment.applied_multipliers ?? []);
  subtotal += m.cents;
  allLines.push(...m.lines);

  // 3. Manual adjustments (operator-typed)
  const a = applyManualAdjustments(manualAdjustments ?? []);
  subtotal += a.cents;
  allLines.push(...a.lines);

  // Floor at zero — never produce a negative payout. If a particularly
  // aggressive subtract adjustment drives the total below zero,
  // surface it with a note so the operator notices.
  let final = subtotal;
  if (final < 0) {
    allLines.push({
      label: 'Floor at $0 (calculator never produces negative payouts)',
      cents: -final,
      kind: 'adjustment',
      meta: { floored_from_cents: subtotal },
    });
    final = 0;
  }

  // Total marker line
  allLines.push({
    label: 'Total owed',
    cents: final,
    kind: 'total',
  });

  return {
    amount_cents: final,
    currency: effectiveConfig.currency ?? 'USD',
    breakdown: allLines,
    metric_snapshot_at: metricSnapshotAt.toISOString(),
    rule: mode,
    contributing_post_ids: [...allContributing],
  };
}
