/**
 * Campaign metadata loader.
 *
 * Fetches campaign rows from Supabase so scripts can access the campaign's
 * description, visual style, branded hashtags, flow weights, etc. without
 * hardcoding MinuteWise-specific values.
 *
 * Used by:
 *   - text_overlay.ts / generate_images.ts → inject description + visual
 *     style into Gemini prompts so per-campaign content actually looks
 *     and reads differently.
 *   - post_to_tiktok.ts → resolve the campaign's CTA image.
 *   - daily-refresh.ts / autoresearch.ts → iterate active campaigns when
 *     the cron fires (one plist, multiple campaigns).
 *
 * In-memory cache keyed by slug. Safe because campaign metadata changes
 * infrequently and the process is short-lived (cron-fired).
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

export interface Campaign {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  image_url: string | null;
  cta_image_url: string | null;
  status: 'active' | 'paused' | 'archived';
  start_date: string | null;
  end_date: string | null;

  // Content generation
  visual_style_prompt: string | null;
  tone_of_voice: string | null;
  character_consistency: string | null;
  gallery_inspo_urls: string[];

  // Style training (Phase 17c) — operator-uploaded reference images
  // distilled into a paragraph by Gemini Vision once. Injected into
  // every text + image prompt at cycle time. The training_image_urls
  // are NOT read at cycle time — only the distilled text is.
  training_image_urls: string[];
  style_distillation: string | null;
  style_distilled_at: string | null;

  // Flows
  flows_enabled: { photorealistic: boolean; animated: boolean; emoji_overlay: boolean };
  flow_weights:  { photorealistic: number;  animated: number;  emoji_overlay: number };

  // Hashtags
  tracked_hashtags: string[];
  branded_hashtags: string[];

  // Posting goals
  target_posts_per_week: number;

  // AI brain
  autoresearch_enabled: boolean;
  autoresearch_cadence: 'daily' | 'every_2_days' | 'weekly';

  // Alerts
  slack_webhook: string | null;
  discord_webhook: string | null;
  milestone_thresholds: number[];

  // Email reports
  email_recipients: string[];
  email_frequency: 'daily' | 'weekly' | 'monthly';
  email_include: Record<string, boolean>;

  // Resources
  external_resources: Array<{ label: string; url: string }>;
  internal_resources: Array<{ label: string; url: string }>;
  owner_email: string | null;

  created_at: string;
  updated_at: string;
}

const cacheBySlug = new Map<string, Campaign>();
let _client: SupabaseClient | null = null;

function client(): SupabaseClient | null {
  if (_client) return _client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  _client = createClient(url, key);
  return _client;
}

/**
 * Load a single campaign by slug. Returns null if not found or if Supabase
 * is unreachable (callers should fall back to safe defaults).
 */
export async function getCampaign(slug: string): Promise<Campaign | null> {
  if (cacheBySlug.has(slug)) return cacheBySlug.get(slug)!;

  const sb = client();
  if (!sb) return null;

  const { data, error } = await sb
    .from('campaigns')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();

  if (error || !data) return null;

  const campaign = data as unknown as Campaign;
  cacheBySlug.set(slug, campaign);
  return campaign;
}

/**
 * List every active campaign — used by the cron iterators
 * (daily-refresh, autoresearch, scheduler_tick).
 */
export async function listActiveCampaigns(): Promise<Campaign[]> {
  const sb = client();
  if (!sb) return [];

  const { data, error } = await sb
    .from('campaigns')
    .select('*')
    .eq('status', 'active')
    .order('created_at', { ascending: true });

  if (error || !data) return [];

  const campaigns = data as unknown as Campaign[];
  for (const c of campaigns) cacheBySlug.set(c.slug, c);
  return campaigns;
}

/** Reset cache. Used in long-lived test/dev processes. */
export function resetCampaignCache(): void {
  cacheBySlug.clear();
}
