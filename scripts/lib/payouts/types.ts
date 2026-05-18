/**
 * Creator-payout calculator — type definitions.
 *
 * These mirror the Phase 17d schema (creator_payments_layer1 and
 * creator_payments_layer2 migrations) and are used by:
 *   - the pure calculator function in `./calculator.ts`
 *   - the DB helpers in `./db.ts`
 *   - the CLI runner `scripts/payouts_calculate.ts`
 *
 * The dashboard has its own copy in `dashboard/src/lib/types.ts` —
 * keeping the two intentionally separate so the engine doesn't need
 * to depend on dashboard code and vice versa. They drift at most by
 * one column at any time; the schema is the single source of truth.
 */

// ─── Creators + assignments ─────────────────────────────────────

export type CreatorKind = 'ugc' | 'team_member';
export type CreatorStatus = 'invited' | 'onboarded' | 'suspended' | 'archived';
export type ProcessorKind = 'manual' | 'lumanu' | 'stripe' | 'wise';

export interface Creator {
  id: string;
  kind: CreatorKind;
  legal_name: string;
  display_name: string | null;
  email: string;
  country: string | null;
  preferred_processor: ProcessorKind;
  manual_payout_notes: string | null;
  owned_account_ids: string[];
  status: CreatorStatus;
  invited_at: string;
  onboarded_at: string | null;
}

export type AssignmentStatus =
  | 'pending'
  | 'accepted'
  | 'rejected'
  | 'active'
  | 'completed'
  | 'cancelled';

export interface Assignment {
  id: string;
  creator_id: string;
  campaign_id: string;
  rate_override_cents: number | null;
  expected_posts: number;
  due_date: string | null;
  status: AssignmentStatus;
  /** IDs of multipliers from CampaignPayoutConfig.multipliers that
   *  apply to THIS specific assignment. Calculator treats each as a
   *  separate breakdown line. */
  applied_multipliers: string[];
}

// ─── Per-campaign rate card ─────────────────────────────────────

export type PayoutMode = 'none' | 'flat' | 'cpm' | 'hybrid' | 'milestone';

export interface Multiplier {
  /** Stable id used in Assignment.applied_multipliers. */
  id: string;
  /** Human label shown on the breakdown line. */
  label: string;
  /** Percentage adjustment. e.g. 15 means +15%. Can be negative for
   *  discounts (e.g. early-payment discount of -5). */
  pct: number;
}

export interface MilestoneTier {
  /** Per-post view threshold the post must hit to earn the bonus. */
  views: number;
  /** Bonus amount paid (per post hitting the threshold). */
  bonus_cents: number;
}

export interface CampaignPayoutConfig {
  campaign_id: string;
  mode: PayoutMode;

  // Mode-specific rate fields
  flat_per_post_cents: number | null;
  cpm_cents: number | null;
  cpm_view_window_days: number;            // e.g. 14 — wait this long before
                                            // including a post's views in CPM
  hybrid_threshold_views: number | null;
  milestones: MilestoneTier[];

  multipliers: Multiplier[];               // rate-card menu (campaign-level)

  total_budget_cents: number | null;
  currency: string;                        // 'USD' / 'INR' / etc.

  approval_required: boolean;
  instant_payout: boolean;
}

// ─── Posts (subset relevant to the calculator) ──────────────────

/**
 * Calculator-relevant subset of the `posts` row. We re-declare it
 * here rather than reusing the engine's `Post` type because we want
 * the calculator to be importable from anywhere without dragging in
 * the rest of the engine.
 */
export interface CalculatorPost {
  id: string;
  /** When the post went live on TikTok (or was scheduled to). The
   *  CPM window-day rule compares against this. */
  posted_at: string;
  /** TikTok views as of the metric snapshot. */
  views: number;
  /** Saves as of the metric snapshot. Reserved for milestone bonus
   *  rules that bonus on saves rather than views. */
  saves: number | null;
  /** 'published' / 'scheduled' / 'draft' / 'failed'. The calculator
   *  only counts 'published' posts. */
  status: string;
}

// ─── Manual adjustments (operator-typed line items) ─────────────

export type AdjustmentKind = 'add' | 'subtract' | 'override';

export interface ManualAdjustment {
  /** Free-form label, shown on the breakdown line. */
  label: string;
  cents: number;
  kind: AdjustmentKind;
  note: string | null;
}

// ─── Calculator inputs / outputs ────────────────────────────────

export interface CalculatorInput {
  config: CampaignPayoutConfig;
  assignment: Assignment;
  posts: CalculatorPost[];
  /** Fixed point-in-time used to evaluate the CPM view window. The
   *  calculator is deterministic given this snapshot — running it
   *  twice with the same snapshot and inputs returns byte-identical
   *  output. Typically `new Date()` at call time. */
  metricSnapshotAt: Date;
  /** Manual adjustments carried over from the existing pending
   *  payout, if any. The calculator preserves these; only the
   *  operator clears them via the dashboard. */
  manualAdjustments: ManualAdjustment[];
}

export interface BreakdownLine {
  /** Short label shown on the dashboard breakdown row. */
  label: string;
  /** Money delta this line adds to the running total. Always signed:
   *  positive = added, negative = subtracted. */
  cents: number;
  /** What kind of line — drives styling on the dashboard. */
  kind: 'base' | 'cpm' | 'milestone' | 'multiplier' | 'adjustment' | 'subtotal' | 'total';
  /** Optional reference to the post id this line came from. Lets the
   *  dashboard link the line to a specific post. */
  post_id?: string;
  /** Optional metadata for hover tooltips / CSV exports. */
  meta?: Record<string, unknown>;
}

export interface CalculatorOutput {
  amount_cents: number;
  currency: string;
  breakdown: BreakdownLine[];
  /** ISO-8601 of the snapshot the calculator used. Persisted on the
   *  payouts row for audit. */
  metric_snapshot_at: string;
  /** Mode the calculator applied. Useful for dashboards because the
   *  config might've changed between runs and we want to show what
   *  THIS payout was computed under. */
  rule: PayoutMode;
  /** Post ids that contributed any cents to this payout. */
  contributing_post_ids: string[];
}
