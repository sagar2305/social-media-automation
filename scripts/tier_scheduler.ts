/**
 * Tier-based bulk analytics scheduler.
 *
 * Implements the Smart Analytics Fetching Plan (docs/post_analytics_plan.pdf):
 * tiered fetches via ScrapeCreators `/v3/tiktok/profile/videos` (1 credit per
 * page of up to 10 posts) instead of per-post `/v2/tiktok/video` (1 credit per
 * post). Costs auto-scale with `config.tiktokAccounts.length` — no structural
 * changes needed when accounts are added.
 *
 * Tiers:
 *   hot     — page 1            — daily
 *   warm    — pages 2-3         — every 3 days
 *   cool    — pages 4-9         — weekly
 *   archive — pages 10-12       — weekly (only when posts ≥ 30 days old exist)
 *   stats   — /v1/tiktok/profile (account follower/like totals) — weekly
 */

import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { config } from '../config/config.js';
import { apiRequest, log } from './api-client.js';

// ─── Tier Configuration ──────────────────────────────────────

export type TierName = 'hot' | 'warm' | 'cool' | 'archive' | 'stats';

interface TierConfig {
  name: TierName;
  startPage: number; // 0-indexed: hot=0 (page 1), warm=1 (page 2), etc.
  pageCount: number; // how many pages this tier covers
  intervalDays: number; // minimum days between runs
  minPostAgeDays?: number; // skip tier until a post this old exists
}

export const TIERS: Record<TierName, TierConfig> = {
  hot: { name: 'hot', startPage: 0, pageCount: 1, intervalDays: 1 },
  warm: { name: 'warm', startPage: 1, pageCount: 2, intervalDays: 3 },
  cool: { name: 'cool', startPage: 3, pageCount: 6, intervalDays: 7 },
  archive: { name: 'archive', startPage: 9, pageCount: 3, intervalDays: 7, minPostAgeDays: 30 },
  stats: { name: 'stats', startPage: 0, pageCount: 0, intervalDays: 7 }, // uses /v1/profile, not pages
};

// ─── State Persistence ───────────────────────────────────────

interface TierState {
  startDate: string; // ISO date — day 0 of the plan
  lastRun: Partial<Record<TierName, string>>; // ISO dates per tier
  creditHistory: Array<{ date: string; tiers: TierName[]; accounts: number; credits: number }>;
}

const STATE_PATH = join(config.paths.memory, 'tier-state.json');

async function loadState(): Promise<TierState> {
  try {
    const raw = await readFile(STATE_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return { startDate: new Date().toISOString().slice(0, 10), lastRun: {}, creditHistory: [] };
  }
}

async function saveState(state: TierState): Promise<void> {
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

// ─── Scheduling ──────────────────────────────────────────────

function daysBetween(a: string, b: string): number {
  const ms = new Date(b).getTime() - new Date(a).getTime();
  return Math.floor(ms / (24 * 60 * 60 * 1000));
}

export function decideTiers(state: TierState, today: string, oldestPostAgeDays: number): TierName[] {
  const fire: TierName[] = [];
  for (const tier of Object.values(TIERS)) {
    const last = state.lastRun[tier.name];
    const due = !last || daysBetween(last, today) >= tier.intervalDays;
    if (!due) continue;
    if (tier.minPostAgeDays && oldestPostAgeDays < tier.minPostAgeDays) continue;
    fire.push(tier.name);
  }
  return fire;
}

// ─── ScrapeCreators Fetchers ─────────────────────────────────

export interface ProfileVideo {
  aweme_id: string;
  desc: string;
  create_time: number;
  statistics: {
    play_count: number;
    digg_count: number;
    collect_count: number;
    share_count: number;
    comment_count: number;
  };
}

interface ProfileVideosResponse {
  success: boolean;
  credits_remaining?: number;
  has_more?: number;
  max_cursor?: number;
  aweme_list?: ProfileVideo[];
}

/**
 * Fetch up to `maxPages` pages of a single account's videos via cursor
 * pagination. Each page = up to 10 videos. Returns videos keyed by page index
 * so callers can attribute credits to tiers.
 */
async function fetchAccountPages(
  handle: string,
  maxPages: number,
): Promise<{ pages: ProfileVideo[][]; credits: number }> {
  const pages: ProfileVideo[][] = [];
  let cursor: number | undefined = undefined;
  let credits = 0;

  for (let p = 0; p < maxPages; p++) {
    const path = cursor
      ? `/v3/tiktok/profile/videos?handle=${handle}&max_cursor=${cursor}`
      : `/v3/tiktok/profile/videos?handle=${handle}`;

    let data: ProfileVideosResponse;
    try {
      data = await apiRequest<ProfileVideosResponse>('scrapeCreators', path);
    } catch (err) {
      log(`    ${handle}: page ${p + 1} fetch failed (${err})`);
      break;
    }
    credits++;

    const list = data.aweme_list || [];
    pages.push(list);

    if (!data.has_more || !data.max_cursor || list.length === 0) break;
    cursor = data.max_cursor;
  }

  return { pages, credits };
}

interface ProfileStatsResponse {
  stats: {
    followerCount: number;
    heartCount: number;
    videoCount: number;
    followingCount: number;
  };
}

async function fetchAccountStats(
  handle: string,
): Promise<{ followers: number; totalLikes: number; videos: number } | null> {
  try {
    const data = await apiRequest<ProfileStatsResponse>(
      'scrapeCreators',
      `/v1/tiktok/profile?handle=${handle}`,
    );
    return {
      followers: data.stats.followerCount || 0,
      totalLikes: data.stats.heartCount || 0,
      videos: data.stats.videoCount || 0,
    };
  } catch (err) {
    log(`    ${handle}: stats fetch failed (${err})`);
    return null;
  }
}

// ─── Public API ──────────────────────────────────────────────

export interface TieredFetchResult {
  tiersFired: TierName[];
  /** Videos keyed by account handle, deduplicated across tiers */
  videosByAccount: Map<string, ProfileVideo[]>;
  /** Account stats keyed by handle (only populated if stats tier fired) */
  statsByAccount: Map<string, { followers: number; totalLikes: number; videos: number }>;
  /** Total ScrapeCreators credits consumed this run */
  creditsUsed: number;
}

/**
 * Runs the tier scheduler: decides which tiers should fire today, fetches the
 * required pages per account (sharing the cursor chain across tiers that fire
 * together), and returns consolidated video + stats data. Caller is responsible
 * for applying the results to POST-TRACKER.md.
 */
export async function runTieredFetch(): Promise<TieredFetchResult> {
  const state = await loadState();
  const today = new Date().toISOString().slice(0, 10);

  // Estimate oldest-post-age from state.startDate (plan treats its own start as day 0)
  const oldestPostAgeDays = daysBetween(state.startDate, today);

  const tiersFired = decideTiers(state, today, oldestPostAgeDays);
  const accounts = config.tiktokAccounts;
  const accountCount = accounts.length;

  log(`=== TIER SCHEDULER ===`);
  log(`Plan day: ${oldestPostAgeDays} | accounts: ${accountCount} | tiers firing: ${tiersFired.join(', ') || '(none)'}`);

  const videosByAccount = new Map<string, ProfileVideo[]>();
  const statsByAccount = new Map<string, { followers: number; totalLikes: number; videos: number }>();

  if (!tiersFired.length) {
    log('No tiers due today — skipping fetch');
    return { tiersFired, videosByAccount, statsByAccount, creditsUsed: 0 };
  }

  // Compute maximum page-depth needed across all firing tiers (hot/warm/cool/archive)
  const pageTiers = tiersFired.filter((t) => t !== 'stats');
  let maxPages = 0;
  for (const t of pageTiers) {
    const end = TIERS[t].startPage + TIERS[t].pageCount;
    if (end > maxPages) maxPages = end;
  }

  let totalCredits = 0;

  // Fetch pages for each account (shared across all firing page-tiers)
  if (maxPages > 0) {
    log(`Fetching pages 1-${maxPages} for ${accountCount} accounts...`);
    for (const account of accounts) {
      const { pages, credits } = await fetchAccountPages(account.handle, maxPages);
      totalCredits += credits;

      // Flatten pages into per-account video list (deduplicated by aweme_id)
      const seen = new Set<string>();
      const flat: ProfileVideo[] = [];
      for (const page of pages) {
        for (const v of page) {
          if (!seen.has(v.aweme_id)) {
            seen.add(v.aweme_id);
            flat.push(v);
          }
        }
      }
      videosByAccount.set(account.handle, flat);

      log(`  @${account.handle}: ${pages.length} pages, ${flat.length} unique videos (${credits} credits)`);
    }
  }

  // Stats tier: /v1/profile per account (1 credit each)
  if (tiersFired.includes('stats')) {
    log(`Fetching account stats for ${accountCount} accounts...`);
    for (const account of accounts) {
      const stats = await fetchAccountStats(account.handle);
      if (stats) {
        statsByAccount.set(account.handle, stats);
        totalCredits++;
        log(`  @${account.handle}: ${stats.followers} followers, ${stats.videos} videos`);
      }
    }
  }

  // Update state
  for (const t of tiersFired) state.lastRun[t] = today;
  state.creditHistory.push({ date: today, tiers: tiersFired, accounts: accountCount, credits: totalCredits });
  // Keep last 90 entries
  if (state.creditHistory.length > 90) state.creditHistory = state.creditHistory.slice(-90);
  await saveState(state);

  log(`=== TIER FETCH COMPLETE — ${totalCredits} credits used ===`);

  return { tiersFired, videosByAccount, statsByAccount, creditsUsed: totalCredits };
}

// Allow standalone execution: `tsx scripts/tier_scheduler.ts`
if (process.argv[1]?.endsWith('tier_scheduler.ts')) {
  runTieredFetch()
    .then((r) => {
      console.log('\nResult:', {
        tiersFired: r.tiersFired,
        accountsWithVideos: r.videosByAccount.size,
        accountsWithStats: r.statsByAccount.size,
        creditsUsed: r.creditsUsed,
      });
    })
    .catch(console.error);
}
