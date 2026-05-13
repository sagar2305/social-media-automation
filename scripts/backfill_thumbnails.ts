/**
 * Backfill posts.thumbnail_url for posts that have a tiktok_url but
 * no cached thumbnail yet.
 *
 * Source: TikTok's oembed endpoint.
 *   https://www.tiktok.com/oembed?url=<post_url>
 * Returns JSON with thumbnail_url pointing at TikTok's CDN. This is
 * the only public-facing way to resolve a slide thumbnail without
 * scraping; it's rate-limited so we throttle ~1 req/s.
 *
 * Idempotent — re-running just picks up posts that still have null.
 *
 * Usage:
 *   npx tsx scripts/backfill_thumbnails.ts            # all eligible
 *   npx tsx scripts/backfill_thumbnails.ts --campaign=minutewise
 *   npx tsx scripts/backfill_thumbnails.ts --limit=20  # quick smoke
 */

import { createClient } from '@supabase/supabase-js';
import { config as dotenvConfig } from 'dotenv';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '..', '.env.local'), override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(2);
}

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

async function fetchOembed(postUrl: string): Promise<string | null> {
  try {
    const res = await fetch(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(postUrl)}`,
      { headers: { 'user-agent': 'MinuteWiseAutomation/1.0' } },
    );
    if (!res.ok) return null;
    const body = (await res.json()) as { thumbnail_url?: string };
    return body.thumbnail_url ?? null;
  } catch {
    return null;
  }
}

async function main() {
  const args = process.argv.slice(2);
  const campaignArg = args.find((a) => a.startsWith('--campaign='))?.split('=')[1];
  const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1];
  const limit = limitArg ? parseInt(limitArg, 10) : 500;

  // Eligible: published, has tiktok_url, no thumbnail yet, URL contains
  // /photo/<id> or /video/<id> (otherwise oembed returns 404).
  let q = sb
    .from('posts')
    .select('id, tiktok_url, campaign_id')
    .eq('status', 'published')
    .is('thumbnail_url', null)
    .not('tiktok_url', 'is', null)
    .neq('tiktok_url', '-')
    .like('tiktok_url', '%/photo/%')
    .order('views', { ascending: false })
    .limit(limit);

  if (campaignArg) {
    const { data: campaign } = await sb
      .from('campaigns')
      .select('id')
      .eq('slug', campaignArg)
      .maybeSingle();
    if (!campaign) {
      console.error(`Campaign "${campaignArg}" not found`);
      process.exit(2);
    }
    q = q.eq('campaign_id', campaign.id);
  }

  const { data, error } = await q;
  if (error) {
    console.error('Read failed:', error.message);
    process.exit(1);
  }
  const posts = data ?? [];
  if (posts.length === 0) {
    console.log('Nothing to backfill — every eligible post already has a thumbnail.');
    return;
  }

  console.log(`Backfilling ${posts.length} thumbnail(s)…`);
  let ok = 0;
  let miss = 0;
  for (let i = 0; i < posts.length; i++) {
    const p = posts[i];
    if (!p.tiktok_url) { miss++; continue; }
    const url = await fetchOembed(p.tiktok_url);
    if (url) {
      await sb.from('posts').update({ thumbnail_url: url }).eq('id', p.id);
      ok++;
      process.stdout.write('.');
    } else {
      miss++;
      process.stdout.write('x');
    }
    // ~1 req/s throttle. TikTok blocks burst traffic on oembed.
    await new Promise((r) => setTimeout(r, 1100));
    if ((i + 1) % 50 === 0) process.stdout.write(` [${i + 1}/${posts.length}]\n`);
  }
  console.log(`\nDone — ${ok} resolved, ${miss} missing/blocked`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
