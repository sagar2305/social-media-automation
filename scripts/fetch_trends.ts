import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { config } from '../config/config.js';
import { apiRequest, log } from './api-client.js';

interface OrbitResponse {
  orbit_id: string;
  status: string;
}

interface OrbitStatusResponse {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  analysis?: string;
  results?: { total_videos: number; videos: Video[]; trends: unknown[] };
}

interface Video {
  id: string;
  url: string;
  platform: string;
  views: number;
  likes: number;
  comments: number;
  publish_date: string;
  hashtags: string[];
  thumbnail_url: string;
  author: { username: string; followers: number; verified: boolean };
}

interface OutlierCreator {
  outlier_ratio: number;
  avg_views: number;
  videos_analyzed: number;
  videos: Video[];
}

interface HashtagData {
  hashtag: string;
  count: number;
  total_views: number;
}

interface HashtagPerformance {
  data: {
    hashtag: string;
    video_count: number;
    total_views: number;
    avg_views: number;
    total_likes: number;
    avg_likes: number;
    total_comments: number;
    avg_comments: number;
  };
}

interface TrendDigest {
  data: { title: string; trends: { ranking: number; trend: { name: string; description: string } }[] }[];
}

interface VideoDigest {
  url: string;
  type: string;
  views: number;
  number_of_likes: number;
  number_of_comments: number;
  duration: number;
  transcript_raw: string;
  description: string;
  hashtags: string[];
}

function dateStr(daysAgo: number = 0): string {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString().slice(0, 10);
}

async function createOrbit(): Promise<string> {
  log('Creating Virlo Orbit search...');
  const res = await apiRequest<{ data: OrbitResponse }>('virlo', '/orbit', {
    method: 'POST',
    body: {
      name: `niche-research-${dateStr()}`,
      keywords: config.niche.keywords,
      platforms: ['tiktok'],
      time_period: 'this_week',
      min_views: config.niche.minViews,
      run_analysis: true,
    },
  });
  const orbitId = res.data?.orbit_id;
  if (!orbitId) throw new Error(`Orbit creation returned no orbit_id: ${JSON.stringify(res)}`);
  log(`Orbit created: ${orbitId}`);
  return orbitId;
}

async function pollOrbit(orbitId: string, timeoutMs: number = 15 * 60 * 1000): Promise<OrbitStatusResponse> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const res = await apiRequest<{ data: OrbitStatusResponse }>('virlo', `/orbit/${orbitId}?order_by=views&sort=desc`);
    const orbit = res.data;
    if (orbit.status === 'completed') {
      log('Orbit completed');
      return orbit;
    }
    if (orbit.status === 'failed') {
      throw new Error('Orbit search failed');
    }
    log(`Orbit status: ${orbit.status}, polling again in 30s...`);
    await new Promise((r) => setTimeout(r, 30_000));
  }
  throw new Error('Orbit timed out after 15 minutes');
}

async function getTopVideos(orbitId: string): Promise<Video[]> {
  const res = await apiRequest<{ data: { videos: Video[] } }>(
    'virlo',
    `/orbit/${orbitId}/videos?limit=20&order_by=views&sort=desc&platforms=tiktok`,
  );
  return res.data?.videos || [];
}

async function getOutliers(orbitId: string): Promise<OutlierCreator[]> {
  const res = await apiRequest<{ data: { outliers: OutlierCreator[] } }>(
    'virlo',
    `/orbit/${orbitId}/creators/outliers?platform=tiktok&order_by=outlier_ratio&sort=desc&limit=20`,
  );
  return res.data?.outliers || [];
}

async function getTrendingHashtags(): Promise<HashtagData[]> {
  const res = await apiRequest<{ data: HashtagData[] }>(
    'virlo',
    `/tiktok/hashtags?start_date=${dateStr(7)}&end_date=${dateStr()}&limit=30&order_by=views&sort=desc`,
  );
  return res.data;
}

async function getTrendDigest(): Promise<TrendDigest> {
  return apiRequest<TrendDigest>('virlo', '/trends/digest');
}

async function getVideoDigest(): Promise<VideoDigest[]> {
  const res = await apiRequest<{ data: VideoDigest[] }>('virlo', '/videos/digest');
  return res.data || [];
}

function formatTrendingNow(
  analysis: string | undefined,
  topVideos: Video[],
  trends: TrendDigest,
  videoDigest: VideoDigest[],
): string {
  const lines: string[] = ['# Trending Now', '', `_Last updated: ${new Date().toISOString()}_`, ''];

  if (analysis) {
    lines.push('## AI Analysis', '', analysis, '');
  }

  if (trends.data?.length) {
    lines.push('## Trending Topics');
    for (const group of trends.data.slice(0, 10)) {
      lines.push(`\n### ${group.title}`);
      for (const t of group.trends) {
        lines.push(`- **${t.trend.name}** (rank ${t.ranking}): ${t.trend.description}`);
      }
    }
    lines.push('');
  }

  lines.push('## Top Performing Videos');
  for (const v of topVideos.slice(0, 15)) {
    const views = (v.views || 0).toLocaleString();
    const username = v.author?.username || 'unknown';
    const followers = (v.author?.followers || 0).toLocaleString();
    lines.push(`- **${views} views** | @${username} (${followers} followers)`);
    lines.push(`  ${v.url}`);
    if (v.hashtags?.length) lines.push(`  Tags: ${v.hashtags.join(', ')}`);
  }
  lines.push('');

  if (videoDigest?.length) {
    lines.push('## 48h Video Digest (Top Performers)');
    for (const v of videoDigest.slice(0, 10)) {
      const views = v.views?.toLocaleString() || '0';
      const likes = (v.number_of_likes || 0).toLocaleString();
      lines.push(`- ${views} views | ${likes} likes | ${v.hashtags?.join(', ') || 'no tags'}`);
      if (v.transcript_raw) lines.push(`  Hook: "${v.transcript_raw.slice(0, 100)}..."`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

function formatHashtagBank(hashtags: HashtagData[], existing: string): string {
  const lines: string[] = [
    '# Hashtag Bank',
    '',
    `_Last updated: ${new Date().toISOString()}_`,
    '',
    '## Top Performers (from Virlo)',
    '| Hashtag | Video Count | Total Views | Avg Views | Last Checked |',
    '|---------|------------|-------------|-----------|-------------|',
  ];

  for (const h of hashtags) {
    const avgViews = h.count > 0 ? Math.round(h.total_views / h.count) : 0;
    lines.push(
      `| ${h.hashtag} | ${h.count.toLocaleString()} | ${h.total_views.toLocaleString()} | ${avgViews.toLocaleString()} | ${dateStr()} |`,
    );
  }

  lines.push('', '## Niche Hashtags');
  lines.push('- #studytips');
  lines.push('- #studyhacks');
  lines.push('- #studentlife');
  lines.push('- #aitoolsforstudents');
  lines.push('- #ainotetaker');
  lines.push('- #studywithme');
  lines.push('- #productivityhacks');
  lines.push('- #minutewise');

  return lines.join('\n') + '\n';
}

function updateFormatWinners(outliers: OutlierCreator[], existing: string): string {
  if (!outliers.length) return existing;

  const lines: string[] = [
    '# Format Winners',
    '',
    `_Last updated: ${new Date().toISOString()}_`,
    '',
    '## Outlier Creators (high views relative to followers)',
  ];

  for (const o of outliers.slice(0, 10)) {
    lines.push(
      `- **${o.outlier_ratio.toFixed(1)}x outlier ratio** | ${o.avg_views.toLocaleString()} avg views | ${o.videos_analyzed} videos analyzed`,
    );
  }

  // Preserve existing format rankings if they exist
  const rankingSection = existing.match(/## Format Rankings[\s\S]*/);
  if (rankingSection) {
    lines.push('', rankingSection[0]);
  } else {
    lines.push('', '## Format Rankings');
    lines.push('_Will be populated after A/B testing begins._');
  }

  return lines.join('\n') + '\n';
}

export async function runResearch(): Promise<void> {
  log('=== RESEARCH PHASE ===');
  const memDir = config.paths.memory;

  let orbitData: OrbitStatusResponse | null = null;
  let topVideos: Video[] = [];
  let outliers: OutlierCreator[] = [];

  // Run Orbit search (async, takes 2-10 min)
  try {
    const orbitId = await createOrbit();
    orbitData = await pollOrbit(orbitId);
    topVideos = await getTopVideos(orbitId);
    outliers = await getOutliers(orbitId);
  } catch (err) {
    log(`Orbit failed, falling back to hashtags + digest only: ${err}`);
  }

  // These can run even if Orbit fails
  let hashtags: HashtagData[] = [];
  let trends: TrendDigest = { data: [] };
  let videoDigest: VideoDigest[] = [];

  const [hashRes, trendRes, videoRes] = await Promise.allSettled([
    getTrendingHashtags(),
    getTrendDigest(),
    getVideoDigest(),
  ]);
  if (hashRes.status === 'fulfilled') hashtags = hashRes.value;
  else log(`Hashtags fetch failed: ${hashRes.reason}`);
  if (trendRes.status === 'fulfilled') trends = trendRes.value;
  else log(`Trend digest fetch failed: ${trendRes.reason}`);
  if (videoRes.status === 'fulfilled') videoDigest = videoRes.value;
  else log(`Video digest fetch failed: ${videoRes.reason}`);

  // Write TRENDING-NOW.md
  const trendingContent = formatTrendingNow(orbitData?.analysis, topVideos, trends, videoDigest);
  await writeFile(join(memDir, 'TRENDING-NOW.md'), trendingContent);
  log('Updated TRENDING-NOW.md');

  // Update HASHTAG-BANK.md
  if (hashtags.length) {
    const existingHashtags = await readFile(join(memDir, 'HASHTAG-BANK.md'), 'utf-8').catch(() => '');
    const hashtagContent = formatHashtagBank(hashtags, existingHashtags);
    await writeFile(join(memDir, 'HASHTAG-BANK.md'), hashtagContent);
    log('Updated HASHTAG-BANK.md');
  }

  // Update FORMAT-WINNERS.md with outlier data
  if (outliers.length) {
    const existingFormats = await readFile(join(memDir, 'FORMAT-WINNERS.md'), 'utf-8').catch(() => '');
    const formatContent = updateFormatWinners(outliers, existingFormats);
    await writeFile(join(memDir, 'FORMAT-WINNERS.md'), formatContent);
    log('Updated FORMAT-WINNERS.md');
  }

  log('=== RESEARCH COMPLETE ===');
}

// Allow running standalone: npm run research
if (process.argv[1]?.endsWith('fetch_trends.ts')) {
  runResearch().catch(console.error);
}
