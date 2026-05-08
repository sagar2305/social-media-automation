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
