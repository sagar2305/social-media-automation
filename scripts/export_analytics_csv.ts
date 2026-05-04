/**
 * Export pages 1 + 2 of each active TikTok account to a CSV for manual analysis.
 * Uses /v3/tiktok/profile/videos with max_cursor pagination.
 * Cost: 1 credit/page × 4 accounts × 2 pages = 8 ScrapeCreators credits.
 *
 * Output: data/exports/post_analytics_page1_2_<timestamp>.csv
 *
 * Run: npx tsx scripts/export_analytics_csv.ts
 */

import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local', override: true });

import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { config } from '../config/config.js';
import { apiRequest, log } from './api-client.js';

interface ProfileVideo {
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
  aweme_list?: ProfileVideo[];
  max_cursor?: number;
  has_more?: number;
}

function csvEscape(s: string): string {
  if (s == null) return '';
  const needsQuote = /[,"\n\r]/.test(s);
  const escaped = s.replace(/"/g, '""');
  return needsQuote ? `"${escaped}"` : escaped;
}

async function fetchPage(handle: string, cursor?: number): Promise<ProfileVideosResponse> {
  const path = cursor
    ? `/v3/tiktok/profile/videos?handle=${handle}&max_cursor=${cursor}`
    : `/v3/tiktok/profile/videos?handle=${handle}`;
  return apiRequest<ProfileVideosResponse>('scrapeCreators', path);
}

async function main() {
  const rows: string[][] = [];
  rows.push([
    'account',
    'page',
    'aweme_id',
    'created_date',
    'views',
    'likes',
    'saves',
    'shares',
    'comments',
    'save_rate_pct',
    'engagement_rate_pct',
    'tiktok_url',
    'description',
  ]);

  for (const account of config.tiktokAccounts) {
    log(`=== @${account.handle} ===`);
    let cursor: number | undefined = undefined;
    for (let page = 1; page <= 2; page++) {
      const data = await fetchPage(account.handle, cursor);
      const videos = data.aweme_list || [];
      log(`  Page ${page}: ${videos.length} videos`);

      for (const v of videos) {
        const s = v.statistics;
        const saveRate = s.play_count > 0 ? (s.collect_count / s.play_count) * 100 : 0;
        const engagementRate =
          s.play_count > 0
            ? ((s.digg_count + s.collect_count + s.share_count + s.comment_count) / s.play_count) * 100
            : 0;
        rows.push([
          `@${account.handle}`,
          String(page),
          v.aweme_id,
          new Date((v.create_time || 0) * 1000).toISOString().slice(0, 10),
          String(s.play_count || 0),
          String(s.digg_count || 0),
          String(s.collect_count || 0),
          String(s.share_count || 0),
          String(s.comment_count || 0),
          saveRate.toFixed(2),
          engagementRate.toFixed(2),
          `https://www.tiktok.com/@${account.handle}/photo/${v.aweme_id}`,
          (v.desc || '').replace(/\s+/g, ' ').slice(0, 200),
        ]);
      }

      if (!data.has_more || !data.max_cursor || videos.length === 0) {
        log(`  has_more=false, stopping at page ${page}`);
        break;
      }
      cursor = data.max_cursor;
    }
  }

  const csv = rows.map((r) => r.map(csvEscape).join(',')).join('\n');
  const exportDir = 'data/exports';
  await mkdir(exportDir, { recursive: true });
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const outPath = join(exportDir, `post_analytics_page1_2_${ts}.csv`);
  await writeFile(outPath, csv);

  log(`\n✅ CSV exported: ${outPath}`);
  log(`   Rows: ${rows.length - 1} data rows + 1 header`);
  log(`   Columns: ${rows[0].join(', ')}`);
}

main().catch((err) => {
  log(`FATAL: ${err}`);
  process.exit(1);
});
