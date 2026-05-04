import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { config } from '../config/config.js';
import { apiRequest, log } from './api-client.js';
import { runTieredFetch, type ProfileVideo } from './tier_scheduler.js';
import { classifyError } from './auto_fix/classifier.js';
import { logClassified } from './auto_fix/audit_logger.js';
import { maybeNotify } from './auto_fix/notifier.js';

// ─── Types ────────────────────────────────────────────────────

export interface PostMetrics {
  postId: string;
  views: number;
  likes: number;
  saves: number;
  shares: number;
  comments: number;
  saveRate: number;
}

interface TrackerRow {
  postId: string;
  date: string;
  hookStyle: string;
  format: string;
  hashtags: string;
  views: string;
  likes: string;
  saves: string;
  shares: string;
  comments: string;
  saveRate: string;
  status: string;
  tiktokUrl: string;
}

interface AccountStats {
  name: string;
  followers: number;
  totalLikes: number;
  views: number;
  recentLikes: number;
  recentComments: number;
  recentShares: number;
  videos: number;
}

// ─── Tracker Parsing ──────────────────────────────────────────

function parseTracker(content: string): TrackerRow[] {
  const lines = content.split('\n').filter((l) => l.startsWith('|') && !l.includes('Post ID') && !l.includes('---'));
  return lines.map((line) => {
    const cols = line.split('|').map((c) => c.trim()).filter(Boolean);
    return {
      postId: cols[0] || '',
      date: cols[1] || '',
      hookStyle: cols[2] || '',
      format: cols[3] || '',
      hashtags: cols[4] || '',
      views: cols[5] || '-',
      likes: cols[6] || '-',
      saves: cols[7] || '-',
      shares: cols[8] || '-',
      comments: cols[9] || '-',
      saveRate: cols[10] || '-',
      status: cols[11] || 'draft',
      tiktokUrl: cols[12] || '',
    };
  });
}

function serializeTracker(rows: TrackerRow[]): string {
  const header = '# Post Tracker\n\n| Post ID | Date | Hook Style | Format | Hashtags | Views | Likes | Saves | Shares | Comments | Save Rate | Status | TikTok URL |\n|---------|------|-----------|--------|----------|-------|-------|-------|--------|----------|-----------|--------|------------|\n';
  const dataRows = rows
    .map(
      (r) =>
        `| ${r.postId} | ${r.date} | ${r.hookStyle} | ${r.format} | ${r.hashtags} | ${r.views} | ${r.likes} | ${r.saves} | ${r.shares} | ${r.comments} | ${r.saveRate} | ${r.status} | ${r.tiktokUrl || '-'} |`,
    )
    .join('\n');
  return header + dataRows + '\n';
}

// ─── Step 1: Check post statuses via Blotato ─────────────────

async function checkBlotPostStatus(rows: TrackerRow[]): Promise<number> {
  // Check ALL posts that don't have a TikTok URL yet (not just drafts)
  const needsCheck = rows.filter(
    (r) => r.postId && r.postId !== '-' && (!r.tiktokUrl || r.tiktokUrl === '-'),
  );
  if (!needsCheck.length) return 0;

  let updated = 0;
  for (const row of needsCheck) {
    try {
      const data = await apiRequest<{
        status: string;
        publicUrl?: string;
        errorMessage?: string;
        result?: { url?: string; postId?: string };
      }>(
        'blotato',
        `/posts/${row.postId}`,
      );

      // Capture TikTok URL from publicUrl (Blotato's actual response field)
      const tiktokUrl = data.publicUrl || data.result?.url;

      if (data.status === 'published') {
        row.status = 'published';
        if (tiktokUrl && (!row.tiktokUrl || row.tiktokUrl === '-')) {
          row.tiktokUrl = tiktokUrl;
          log(`  URL: ${row.postId} → ${tiktokUrl}`);
        }
        updated++;
        log(`  Status: ${row.postId} → published`);
      } else if (data.status === 'failed' || data.status === 'error') {
        row.status = 'error';
        updated++;
        const errMsg = data.errorMessage ? ` — ${data.errorMessage}` : '';
        log(`  Status: ${row.postId} → error${errMsg}`);
        // Surface to the auto-fix system so terminal failures aren't silent.
        // Include Blotato's `errorMessage` (which often relays TikTok's exact
        // rejection reason, e.g. "Please update TikTok app") so the classifier
        // can match a specific catalog entry instead of falling through to the
        // generic blotato/post-status-error RETRY bucket.
        const synthetic = new Error(
          `Blotato post status returned ${data.status} for postId=${row.postId}${errMsg}`,
        );
        const classified = classifyError(synthetic, {
          source: 'blotato',
          url: `${config.blotato.baseUrl}/posts/${row.postId}`,
        });
        await logClassified(classified, { handled: 'pending' });
        await maybeNotify(classified);
      } else if (data.status === 'in-progress') {
        // Still processing — mark as in-progress if currently draft
        if (row.status.includes('draft')) {
          row.status = 'in-progress';
          updated++;
          log(`  Status: ${row.postId} → in-progress`);
        }
      }
    } catch {
      // Post may not exist yet or Blotato may not support status check for this ID
    }
  }

  return updated;
}

// ─── Write account dashboard ─────────────────────────────────

async function writeAccountDashboard(stats: AccountStats[]): Promise<void> {
  const now = new Date().toISOString();
  const dashPath = join(config.paths.memory, 'ACCOUNT-STATS.md');

  let existing = '';
  try { existing = await readFile(dashPath, 'utf-8'); } catch {}

  // Extract only data rows from history (skip repeated headers)
  const historyMatch = existing.match(/## History\n([\s\S]*)/);
  const rawHistory = historyMatch ? historyMatch[1].trim() : '';
  const existingHistory = rawHistory
    .split('\n')
    .filter((l) => l.startsWith('| 2') || l.startsWith('| 1')) // only date rows like "| 2026-..."
    .join('\n');

  const rows = stats.map((s) =>
    `| ${s.name} | ${s.followers} | ${s.totalLikes} | ${s.views} | ${s.recentLikes} | ${s.recentComments} | ${s.recentShares} | ${s.videos} |`
  ).join('\n');

  const historyEntry = `| ${now.slice(0, 10)} | ${stats.map((s) => `${s.name}: ${s.followers}f/${s.videos}v`).join(' · ')} |`;

  const content = `# Account Stats Dashboard

_Last updated: ${now}_

## Current
| Account | Followers | Total Likes | Views | Recent Likes | Recent Comments | Recent Shares | Videos |
|---------|-----------|-------------|-------|-------------|-----------------|---------------|--------|
${rows}

## History
| Date | Summary |
|------|---------|
${historyEntry}
${existingHistory}
`;

  await writeFile(dashPath, content);
  log(`Updated ACCOUNT-STATS.md`);
}

// ─── Tier-Fetch Application ──────────────────────────────────

/**
 * Apply videos fetched by the tier scheduler to tracker rows.
 * Matching strategy:
 *   1. If row's TikTok URL contains an aweme_id that's in the fetched set → direct match.
 *   2. Else if row lacks URL: hashtag overlap (≥2) + ±3-day date proximity → tentative match.
 *      Tentative matches lock in aweme_id so future runs use direct matching.
 */
function applyTierVideos(
  rows: TrackerRow[],
  videosByAccount: Map<string, ProfileVideo[]>,
): { urlsResolved: number; metricsUpdated: number } {
  let urlsResolved = 0;
  let metricsUpdated = 0;

  // Index all fetched videos by aweme_id for O(1) direct match
  const byAwemeId = new Map<string, { video: ProfileVideo; handle: string }>();
  for (const [handle, videos] of videosByAccount) {
    for (const v of videos) byAwemeId.set(v.aweme_id, { video: v, handle });
  }

  // Track aweme_ids already claimed by a tracker row to prevent duplicate binding
  const claimed = new Set<string>();
  for (const row of rows) {
    const m = row.tiktokUrl?.match(/\/(?:video|photo)\/(\d+)/);
    if (m) claimed.add(m[1]);
  }

  const applyMetrics = (row: TrackerRow, v: ProfileVideo) => {
    const s = v.statistics;
    row.views = String(s.play_count || 0);
    row.likes = String(s.digg_count || 0);
    row.saves = String(s.collect_count || 0);
    row.shares = String(s.share_count || 0);
    row.comments = String(s.comment_count || 0);
    row.saveRate =
      s.play_count > 0 ? `${((s.collect_count / s.play_count) * 100).toFixed(2)}%` : '0%';
  };

  // Pass 1: direct aweme_id match for rows with URLs
  for (const row of rows) {
    const m = row.tiktokUrl?.match(/\/(?:video|photo)\/(\d+)/);
    if (!m) continue;
    const hit = byAwemeId.get(m[1]);
    if (!hit) continue;
    applyMetrics(row, hit.video);
    metricsUpdated++;
  }

  // Pass 2: hashtag + date proximity match for rows without URLs
  for (const row of rows) {
    if (row.tiktokUrl && /\/(?:video|photo)\/\d+/.test(row.tiktokUrl)) continue;
    if (row.status !== 'published' && !row.status.startsWith('published')) continue;

    // Figure out which account this row belongs to
    const accountHandle = config.tiktokAccounts.find((a) =>
      row.status.toLowerCase().includes(a.handle.toLowerCase()) ||
      row.status.toLowerCase().includes(a.name.toLowerCase()),
    )?.handle;
    if (!accountHandle) continue;

    const candidates = videosByAccount.get(accountHandle) || [];
    const hashtagList = row.hashtags
      .toLowerCase()
      .split(/[,#]\s*/)
      .map((h) => h.trim())
      .filter((h) => h.length > 2);
    if (hashtagList.length < 2) continue;

    const rowDate = new Date(row.date).getTime();
    let best: { video: ProfileVideo; matches: number } | null = null;

    for (const v of candidates) {
      if (claimed.has(v.aweme_id)) continue;
      const ageDays = Math.abs((rowDate - v.create_time * 1000) / (24 * 60 * 60 * 1000));
      if (ageDays > 3) continue;
      const desc = (v.desc || '').toLowerCase();
      const matches = hashtagList.filter((h) => desc.includes(h)).length;
      if (matches >= 2 && (!best || matches > best.matches)) best = { video: v, matches };
    }

    if (best) {
      const url = `https://www.tiktok.com/@${accountHandle}/photo/${best.video.aweme_id}`;
      row.tiktokUrl = url;
      claimed.add(best.video.aweme_id);
      applyMetrics(row, best.video);
      urlsResolved++;
      metricsUpdated++;
      log(`  Matched: ${row.postId} → ${url} (${best.matches} hashtags, ±${3}d)`);
    }
  }

  return { urlsResolved, metricsUpdated };
}

// ─── Main Export ─────────────────────────────────────────────

export async function measurePerformance(): Promise<PostMetrics[]> {
  log('=== ANALYTICS PHASE ===');

  const trackerPath = join(config.paths.memory, 'POST-TRACKER.md');
  const trackerContent = await readFile(trackerPath, 'utf-8').catch(() => '');
  const rows = parseTracker(trackerContent);

  if (!rows.length) {
    log('No posts to analyze yet');
    return [];
  }

  // Step 1: Check post statuses via Blotato
  log('--- Checking post statuses via Blotato ---');
  const statusUpdates = await checkBlotPostStatus(rows);
  log(`Status sync: ${statusUpdates} updates`);

  // Step 2: Tiered bulk fetch via ScrapeCreators /v3/profile/videos
  log('--- Tiered bulk analytics (ScrapeCreators v3) ---');
  const { tiersFired, videosByAccount, statsByAccount, creditsUsed } = await runTieredFetch();

  // Step 3: Apply fetched videos to tracker rows (direct + hashtag+date match)
  let urlsResolved = 0;
  let metricsUpdated = 0;
  if (videosByAccount.size > 0) {
    const applied = applyTierVideos(rows, videosByAccount);
    urlsResolved = applied.urlsResolved;
    metricsUpdated = applied.metricsUpdated;
    log(`Applied tier data: ${urlsResolved} URLs resolved, ${metricsUpdated} metrics updated`);
  }

  // Step 4: Write updated tracker
  await writeFile(trackerPath, serializeTracker(rows));
  log(`Updated POST-TRACKER.md (${rows.length} total posts, ${creditsUsed} credits used, tiers: ${tiersFired.join(',') || 'none'})`);

  // Step 5: Account dashboard — update if stats tier fired this run
  if (statsByAccount.size > 0) {
    log('--- Writing account dashboard (stats tier) ---');
    const accountStatsList: AccountStats[] = [];
    for (const account of config.tiktokAccounts) {
      const s = statsByAccount.get(account.handle);
      if (s) {
        accountStatsList.push({
          name: account.name,
          followers: s.followers,
          totalLikes: s.totalLikes,
          views: 0,
          recentLikes: 0,
          recentComments: 0,
          recentShares: 0,
          videos: s.videos,
        });
      }
    }
    if (accountStatsList.length) await writeAccountDashboard(accountStatsList);
  }

  log('=== ANALYTICS COMPLETE ===');

  return rows
    .filter((r) => r.views !== '-' && r.views !== '0' && parseInt(r.views) > 0)
    .map((r) => ({
      postId: r.postId,
      views: parseInt(r.views) || 0,
      likes: parseInt(r.likes) || 0,
      saves: parseInt(r.saves) || 0,
      shares: parseInt(r.shares) || 0,
      comments: parseInt(r.comments) || 0,
      saveRate: parseFloat(r.saveRate.replace('%', '')) || 0,
    }));
}

// Allow running standalone: npm run analytics
if (process.argv[1]?.endsWith('pull_analytics.ts')) {
  measurePerformance().catch(console.error);
}
