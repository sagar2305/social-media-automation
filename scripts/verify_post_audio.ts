/**
 * Post-publish audio check for video posts.
 *
 * Confirms that what TikTok actually SERVES to viewers contains an audible
 * audio track. Metadata is not trusted for this: `music.play_url` from
 * ScrapeCreators is empty on some perfectly healthy posts (verified on two
 * @miniutewise_thomas videos that both play sound), so it is useless as a
 * signal. The only reliable test is to fetch the real video file from TikTok's
 * CDN and measure it with ffprobe/ffmpeg.
 *
 * Two ways a post can be silent:
 *   1. no audio stream at all — the transcoder dropped it
 *   2. an audio stream that is digital silence — worse, because every metadata
 *      check looks healthy
 * Both are caught here; mean volume is measured, not just stream presence.
 *
 * Requires ffmpeg/ffprobe on PATH.
 *
 * Usage:
 *   npx tsx scripts/verify_post_audio.ts                 # all posted videos
 *   npx tsx scripts/verify_post_audio.ts --limit=5
 */

import { createClient } from '@supabase/supabase-js';
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

import { execFile } from 'child_process';
import { promisify } from 'util';
import { writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';
import { positiveIntFlag } from './lib/cli-args.js';

const execFileAsync = promisify(execFile);

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SC_KEY = process.env.SCRAPECREATORS_API_KEY;
const BLOTATO_KEY = process.env.BLOTATO_API_KEY;
if (!SUPA_URL || !SUPA_KEY || !SC_KEY || !BLOTATO_KEY) {
  console.error('Missing env: Supabase URL/key, SCRAPECREATORS_API_KEY, BLOTATO_API_KEY.');
  process.exit(1);
}
const sb = createClient(SUPA_URL, SUPA_KEY);

/**
 * Below this mean volume the track is effectively silent. Real speech in these
 * videos measures around -18 to -20 dB, so -50 dB is far below anything
 * audible while still tolerating a quiet intro.
 */
const SILENCE_THRESHOLD_DB = -50;

// Must be a positive integer — slice(0, NaN) yields an empty array, so a typo'd
// --limit would print "Checking audio on 0 posts", exit 0, and look like a pass.
const LIMIT = positiveIntFlag('limit', Infinity);

/** Resolve the live TikTok URL for a Blotato submission. */
async function publicUrlFor(submissionId: string): Promise<string | null> {
  const res = await fetch(`https://backend.blotato.com/v2/posts/${submissionId}`, {
    headers: { 'blotato-api-key': BLOTATO_KEY! },
  });
  if (!res.ok) return null;
  const j = (await res.json().catch(() => ({}))) as { publicUrl?: string };
  return j.publicUrl ?? null;
}

/** Fetch the CDN url of the video TikTok serves for a post. */
async function cdnUrlFor(tiktokUrl: string): Promise<string | null> {
  const res = await fetch(
    `https://api.scrapecreators.com/v2/tiktok/video?url=${encodeURIComponent(tiktokUrl)}`,
    { headers: { 'x-api-key': SC_KEY! } },
  );
  if (!res.ok) return null;
  const j = (await res.json().catch(() => ({}))) as Record<string, any>;
  const a = j.aweme_detail ?? j;
  return a?.video?.play_addr?.url_list?.[0] ?? null;
}

interface AudioReport {
  hasAudioStream: boolean;
  meanDb: number | null;
}

async function measureAudio(cdnUrl: string): Promise<AudioReport> {
  const tmp = join(tmpdir(), `ttaudio_${process.pid}_${Math.abs(Date.now() % 1e9)}.mp4`);
  try {
    const res = await fetch(cdnUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0', Referer: 'https://www.tiktok.com/' },
    });
    if (!res.ok) throw new Error(`CDN fetch ${res.status}`);
    await writeFile(tmp, Buffer.from(await res.arrayBuffer()));

    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=codec_name',
      '-of', 'csv=p=0', tmp,
    ]);
    const hasAudioStream = stdout.trim().length > 0;
    if (!hasAudioStream) return { hasAudioStream: false, meanDb: null };

    // ffmpeg writes volumedetect output to stderr, and exits non-zero on some
    // inputs even when the measurement succeeded — read stderr either way.
    let stderr = '';
    try {
      const r = await execFileAsync('ffmpeg', ['-hide_banner', '-i', tmp, '-af', 'volumedetect', '-f', 'null', '-']);
      stderr = r.stderr;
    } catch (e: any) {
      stderr = e?.stderr ?? '';
    }
    const m = stderr.match(/mean_volume:\s*(-?[\d.]+) dB/);
    return { hasAudioStream: true, meanDb: m ? parseFloat(m[1]) : null };
  } finally {
    await unlink(tmp).catch(() => {});
  }
}

(async () => {
  const { data, error } = await sb
    .from('posts')
    .select('id, account, failure_resolution_note')
    .like('id', 'video_%')
    .eq('status', 'posted');
  if (error) {
    console.error(`Failed to load posts: ${error.message}`);
    process.exit(1);
  }

  const rows = (data ?? []).slice(0, LIMIT);
  console.log(`Checking audio on ${rows.length} published video post(s)…\n`);

  let ok = 0;
  const bad: string[] = [];

  for (const row of rows) {
    let meta: { submissionId?: string; title?: string } = {};
    try {
      meta = JSON.parse(row.failure_resolution_note || '{}');
    } catch {
      /* ignore */
    }
    const label = `@${row.account} ${(meta.title ?? row.id).slice(0, 44)}`;
    if (!meta.submissionId) {
      console.log(`  ?    ${label} — no submissionId recorded, cannot check`);
      continue;
    }
    try {
      const tiktokUrl = await publicUrlFor(meta.submissionId);
      if (!tiktokUrl) {
        console.log(`  ?    ${label} — not published yet`);
        continue;
      }
      const cdn = await cdnUrlFor(tiktokUrl);
      if (!cdn) {
        console.log(`  ?    ${label} — no CDN url from ScrapeCreators`);
        continue;
      }
      const { hasAudioStream, meanDb } = await measureAudio(cdn);
      if (!hasAudioStream) {
        console.log(`  FAIL ${label} — NO AUDIO STREAM`);
        bad.push(tiktokUrl);
      } else if (meanDb !== null && meanDb < SILENCE_THRESHOLD_DB) {
        console.log(`  FAIL ${label} — audio present but SILENT (${meanDb} dB)`);
        bad.push(tiktokUrl);
      } else {
        console.log(`  OK   ${label} — ${meanDb ?? '?'} dB`);
        ok++;
      }
    } catch (e) {
      console.log(`  ?    ${label} — check failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  console.log(`\nDONE. ok=${ok} silent=${bad.length}`);
  if (bad.length) {
    console.log('\nThese posts have no audible audio and should be deleted in the TikTok app and re-posted:');
    bad.forEach((u) => console.log('  ' + u));
    process.exitCode = 1;
  }
})().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.message : e);
  process.exit(1);
});
