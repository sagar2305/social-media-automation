export interface Post {
  id: string;
  date: string;
  hook_style: string;
  format: string;
  hashtags: string[];
  views: number;
  likes: number;
  saves: number;
  shares: number;
  comments: number;
  save_rate: number;
  status: string;
  tiktok_url: string | null;
  account: string | null;
  flow: string | null;
}

export interface AccountStat {
  id: number;
  date: string;
  account: string;
  followers: number;
  total_likes: number;
  views: number;
  videos: number;
}

export interface Experiment {
  id: string;
  date: string;
  variable: string;
  variant_a: string;
  variant_b: string;
  views_a: number;
  views_b: number;
  saves_a: number;
  saves_b: number;
  save_rate_a: number;
  save_rate_b: number;
  status: string;
  winner: string | null;
  description: string;
  account: string | null;
}

export interface FormatRanking {
  id: number;
  rank: number;
  hook_style: string;
  avg_views: number;
  avg_save_rate: number;
  post_count: number;
  last_used: string;
}

export interface HashtagSummary {
  hashtag: string;
  views: number;
  saves: number;
  likes: number;
  avg_save_rate: number;
  posts: number;
}

export interface Competitor {
  id: string;
  handle: string;
  platform: string;
  followers: number;
  views: number;
  likes: number;
  videos: number;
  last_checked: string | null;
  added_at: string;
}

export interface AlertRule {
  metric: string;
  condition: "gt" | "lt";
  threshold: number;
  enabled: boolean;
}

export interface AlertConfig {
  id: string;
  type: "slack" | "discord";
  webhook_url: string;
  enabled: boolean;
  rules: AlertRule[];
  created_at: string;
  updated_at: string;
}

export interface AccountSummary {
  account: string;
  followers: number;
  views: number;
  likes: number;
  saves: number;
  avg_save_rate: number;
  posts: number;
  last_posted: string | null;
}

// ─── Multi-campaign engine ──────────────────────────────────────────

export interface Campaign {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image_url: string | null;
  cta_image_url: string | null;
  status: "active" | "paused" | "archived";

  start_date: string | null;
  end_date: string | null;

  // Content generation
  visual_style_prompt: string | null;
  tone_of_voice: string | null;
  character_consistency: string | null;
  gallery_inspo_urls: string[];

  // Style Training (Phase 17c) — operator uploads reference images,
  // Gemini Vision distills them once into a style paragraph, the
  // engine injects that paragraph into every prompt thereafter.
  training_image_urls: string[];
  style_distillation: string | null;
  style_distilled_at: string | null;

  // Flows
  flows_enabled: { photorealistic: boolean; animated: boolean; emoji_overlay: boolean };
  flow_weights: { photorealistic: number; animated: number; emoji_overlay: number };

  // Hashtags
  tracked_hashtags: string[];
  branded_hashtags: string[];

  // Posting goals
  target_posts_per_week: number;

  // AI Brain
  autoresearch_enabled: boolean;
  autoresearch_cadence: "daily" | "every_2_days" | "weekly";

  // Alerts
  slack_webhook: string | null;
  discord_webhook: string | null;
  milestone_thresholds: number[];

  // Email reports
  email_recipients: string[];
  email_frequency: "daily" | "weekly" | "monthly";
  email_include: Record<string, boolean>;

  // Resources
  external_resources: Array<{ label: string; url: string }>;
  internal_resources: Array<{ label: string; url: string }>;
  owner_email: string | null;

  created_at: string;
  updated_at: string;
}

// ─── Phase 17d: creator payouts ──────────────────────────────────

export type CreatorKind = "ugc" | "team_member";
export type CreatorStatus = "invited" | "onboarded" | "suspended" | "archived";
export type ProcessorKind = "manual" | "lumanu" | "stripe" | "wise";

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
  created_at: string;

  // Creator-supplied payment info (set via the creator portal).
  // payment_screenshot_path is the storage object path inside the
  // 'creator-payment-info' bucket — turn it into a signed URL when
  // rendering so the image is never publicly readable.
  payment_upi_id: string | null;
  payment_screenshot_path: string | null;
  payment_screenshot_uploaded_at: string | null;
}

export type AssignmentStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "active"
  | "completed"
  | "cancelled";

export interface Assignment {
  id: string;
  creator_id: string;
  campaign_id: string;
  rate_override_cents: number | null;
  expected_posts: number;
  due_date: string | null;
  contract_url: string | null;
  status: AssignmentStatus;
  applied_multipliers: string[];
  invited_at: string;
  accepted_at: string | null;
  completed_at: string | null;
}

export type PayoutMode = "none" | "flat" | "cpm" | "hybrid" | "milestone";

export interface Multiplier {
  id: string;
  label: string;
  /** Percentage. e.g. 15 = +15%. Negative for discounts. */
  pct: number;
}

export interface MilestoneTier {
  views: number;
  bonus_cents: number;
}

export interface CampaignPayoutConfig {
  campaign_id: string;
  mode: PayoutMode;
  flat_per_post_cents: number | null;
  cpm_cents: number | null;
  cpm_view_window_days: number;
  hybrid_threshold_views: number | null;
  milestones: MilestoneTier[];
  multipliers: Multiplier[];
  total_budget_cents: number | null;
  currency: string;
  approval_required: boolean;
  instant_payout: boolean;
}

export type PayoutStatus =
  | "pending"
  | "approved"
  | "processing"
  | "paid"
  | "failed"
  | "cancelled";

export type AdjustmentKind = "add" | "subtract" | "override";

export interface ManualAdjustment {
  label: string;
  cents: number;
  kind: AdjustmentKind;
  note: string | null;
}

/** Calculator output persisted on payouts.computed_from. The dashboard
 *  reads this verbatim to render the breakdown table. */
export interface PayoutComputedFrom {
  rule: PayoutMode;
  metric_snapshot_at: string;
  contributing_post_ids: string[];
  breakdown: Array<{
    label: string;
    cents: number;
    kind: "base" | "cpm" | "milestone" | "multiplier" | "adjustment" | "subtotal" | "total";
    post_id?: string;
    meta?: Record<string, unknown>;
  }>;
}

export interface Payout {
  id: string;
  creator_id: string;
  campaign_id: string;
  assignment_id: string | null;
  amount_cents: number;
  currency: string;
  computed_from: PayoutComputedFrom;
  manual_adjustments: ManualAdjustment[];
  status: PayoutStatus;
  processor: ProcessorKind | null;
  processor_ref: string | null;
  processor_error: string | null;
  approval_ledger_txn_id: string | null;
  payment_ledger_txn_id: string | null;
  scheduled_for: string | null;
  paid_at: string | null;
  approved_by: string | null;
  approved_at: string | null;
  created_at: string;
  updated_at: string;
}

/** Joined for list views — payout + creator + campaign basics in one
 *  row so the inbox can render without N+1 queries. */
export interface PayoutWithJoins extends Payout {
  creator: Pick<
    Creator,
    | "id"
    | "legal_name"
    | "display_name"
    | "email"
    | "preferred_processor"
    | "manual_payout_notes"
    | "payment_upi_id"
    | "payment_screenshot_path"
    | "payment_screenshot_uploaded_at"
  >;
  campaign: Pick<Campaign, "id" | "slug" | "name">;
}

/**
 * Aggregated stats for a campaign — computed by joining campaigns with
 * posts/accounts/cycle_batches at query time. Used on the /campaigns
 * list cards so each tile can show "73/96 posts · 4.5K views" without
 * a per-card N+1 fetch.
 */
export interface CampaignSummary extends Campaign {
  account_count: number;
  posts_count: number;
  total_views: number;
  total_likes: number;
  total_saves: number;
  avg_save_rate: number;
  days_left: number | null;
  posts_target_total: number;
}
