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
