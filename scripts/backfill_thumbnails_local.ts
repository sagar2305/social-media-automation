/**
 * Backfill posts.thumbnail_url from the local slide archives.
 *
 * Every cycle stores its generated slides under
 *   posts/flow{1,2,3}/<date>_<time>_@<account>/{meta.json, slide_*.png}
 * and `meta.json` carries the postId. So we can map slide_1.png back to
 * the matching posts row and ship the actual first-slide image into
 * Supabase Storage as the post thumbnail.
 *
 * Why we need this even though post_to_tiktok now saves mediaUrls[0]
 * (Phase 17b): the 245 posts that pre-date that change have no
 * thumbnail_url yet, and Blotato URLs aren't recoverable after the
 * fact. Local slide files ARE recoverable — they're sitting in the
 * archive directory. This script walks them once.
 *
 * Idempotent — re-running just picks up posts that still have null.
 *
 * Storage layout: campaign-assets/post-thumbs/<postId>.png  (public).
 *
 * Usage:
 *   npx tsx scripts/backfill_thumbnails_local.ts            # all
 *   npx tsx scripts/backfill_thumbnails_local.ts --limit=20 # smoke
 *   npx tsx scripts/backfill_thumbnails_local.ts --dry-run  # report only
 */

import { readFile, readdir } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(__dirname, '..');
dotenvConfig({ path: resolve(REPO_DIR, '.env.local'), override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(2);
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

const FLOWS = ['flow1', 'flow2', 'flow3'] as const;

interface ArchiveEntry {
  postId: string;
  slidePath: string;
}

async function discoverArchives(): Promise<ArchiveEntry[]> {
  const out: ArchiveEntry[] = [];
  for (const flow of FLOWS) {
    const flowDir = join(REPO_DIR, 'posts', flow);
    let dirs: string[];
    try {
      dirs = (await readdir(flowDir, { withFileTypes: true }))
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      continue;
    }
    for (const d of dirs) {
      const metaPath = join(flowDir, d, 'meta.json');
      const slidePath = join(flowDir, d, 'slide_1.png');
      try {
        const meta = JSON.parse(await readFile(metaPath, 'utf-8')) as { postId?: string };
        if (!meta.postId) continue;
        // confirm slide exists
        try { await readFile(slidePath); } catch { continue; }
        out.push({ postId: meta.postId, slidePath });
      } catch {
        // missing/corrupt meta.json — skip silently
      }
    }
  }
  return out;
}

async function uploadOne(entry: ArchiveEntry): Promise<string | null> {
  const buffer = await readFile(entry.slidePath);
  const path = `post-thumbs/${entry.postId}.png`;
  const { error } = await sb.storage
    .from('campaign-assets')
    .upload(path, buffer, {
      upsert: true,
      contentType: 'image/png',
      cacheControl: '31536000',
    });
  if (error) {
    console.error(`  upload failed for ${entry.postId}:`, error.message);
    return null;
  }
  const { data } = sb.storage.from('campaign-assets').getPublicUrl(path);
  return data.publicUrl;
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit='))?.split('=')[1];
  const limit = limitArg ? parseInt(limitArg, 10) : Infinity;

  console.log('Scanning posts/flow{1,2,3}/ for local slide archives…');
  const archives = await discoverArchives();
  console.log(`Found ${archives.length} archive(s) with postId + slide_1.png`);

  // Filter to posts that exist in DB and don't have a thumbnail yet.
  const postIds = archives.map((a) => a.postId);
  const inChunks: string[] = [];
  for (let i = 0; i < postIds.length; i += 100) {
    const chunk = postIds.slice(i, i + 100);
    const { data } = await sb
      .from('posts')
      .select('id')
      .in('id', chunk)
      .is('thumbnail_url', null);
    for (const r of data ?? []) inChunks.push(r.id as string);
  }
  const eligibleIds = new Set(inChunks);
  const eligible = archives.filter((a) => eligibleIds.has(a.postId)).slice(0, limit);

  console.log(`${eligible.length} eligible (DB row exists + thumbnail_url is null).`);
  if (dryRun) {
    eligible.slice(0, 5).forEach((e) => console.log(`  would upload ${e.postId} from ${e.slidePath}`));
    if (eligible.length > 5) console.log(`  …and ${eligible.length - 5} more.`);
    return;
  }
  if (eligible.length === 0) return;

  let ok = 0;
  let fail = 0;
  for (let i = 0; i < eligible.length; i++) {
    const e = eligible[i];
    const url = await uploadOne(e);
    if (!url) { fail++; continue; }
    const { error } = await sb.from('posts').update({ thumbnail_url: url }).eq('id', e.postId);
    if (error) {
      console.error(`  DB update failed for ${e.postId}:`, error.message);
      fail++;
      continue;
    }
    ok++;
    process.stdout.write('.');
    if ((i + 1) % 50 === 0) process.stdout.write(` [${i + 1}/${eligible.length}]\n`);
  }
  console.log(`\nDone — ${ok} thumbnails uploaded, ${fail} failed`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
