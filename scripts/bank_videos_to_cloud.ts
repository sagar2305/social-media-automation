/**
 * Ingest ready-made VIDEOS into the Content Bank.
 *
 * Videos land as ordinary `posts` rows with status='banked', so they inherit
 * everything the bank already does for slideshows: the atomic banked→posting
 * claim, the 3-slots-a-day scheduler, the Blotato rate throttle, and the
 * slot-collision guard. Nothing about the slideshow path changes; the only
 * difference is `mediaType: "video"` in the row's meta JSON, which the posting
 * routes branch on.
 *
 * Two input modes:
 *
 *   1. Manifest CSV (use this for Google Drive):
 *        npx tsx scripts/bank_videos_to_cloud.ts --manifest=videos.csv
 *      Columns (header row required, order-independent):
 *        url      — Drive share link, or any public https URL
 *        account  — TikTok handle without @, e.g. yournotetaker
 *        topic    — what the video is about (feeds the Gemini caption)
 *
 *   2. Local directory:
 *        npx tsx scripts/bank_videos_to_cloud.ts --dir=./videos --account=yournotetaker
 *      Every video file is uploaded to Blotato's media store.
 *
 * Local files (either mode) get their caption from Gemini WATCHING the video
 * via the Files API — filenames are usually production labels ("1.mp4",
 * "roastai CAPTIONED.mp4") that say nothing about the content. Pass an explicit
 * `topic` column to skip that and caption from text alone.
 *
 * Drive files are NOT downloaded. The link is rewritten to Blotato's required
 * direct-download form (docs/blotato-api.md:434) and handed to Blotato at post
 * time, so a 200MB video never round-trips through this machine.
 *
 * Flags: --dry-run (plan only, writes nothing) · --limit=N · --campaign=<slug>
 */

import { createClient } from '@supabase/supabase-js';
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

import { readFile, readdir } from 'fs/promises';
import { basename, extname, join, resolve } from 'path';
import { createHash } from 'crypto';
import { setCampaignSlug } from './lib/campaign-paths.js';
import { flagValue, positiveIntFlag } from './lib/cli-args.js';
import { toDirectMediaUrl, isDriveUrl } from './lib/drive-url.js';
import { generateVideoCaption, generateVideoCaptionFromFile } from './lib/video-caption.js';
import { apiRequest } from './api-client.js';

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPA_URL || !SUPA_KEY) {
  console.error(
    'Missing env: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY).',
  );
  process.exit(1);
}
const sb = createClient(SUPA_URL, SUPA_KEY);

/**
 * Container formats TikTok accepts (docs/tiktok-api.md:114).
 *
 * .mp3 is deliberately absent: it is an AUDIO-ONLY container with no picture
 * track, so TikTok cannot publish it as a video post. Files with this extension
 * are reported and skipped rather than uploaded, because the failure would
 * otherwise surface much later as an opaque Blotato media-conversion error.
 */
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.webm']);
const AUDIO_ONLY_EXTS = new Set(['.mp3', '.wav', '.m4a', '.aac']);

/**
 * Ceiling for a LOCAL (base64) upload to Blotato's /v2/media.
 *
 * docs/blotato-api.md quotes 1GB, but that applies to media Blotato fetches
 * from a URL. Base64 bodies are capped far lower — probed against the live API:
 * 18MB of base64 accepted, 20MB → 422 "Base64 data is too large", 32MB → 413.
 * Base64 inflates by 4/3, so ~13.5MB of binary is the true ceiling; 12MB keeps
 * headroom for the JSON envelope. Anything larger must be hosted and passed as
 * a URL instead.
 */
const MAX_LOCAL_UPLOAD_BYTES = 12_000_000;

const MIME_BY_EXT: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
};

// ─── CLI ─────────────────────────────────────────────────────

const MANIFEST = flagValue('manifest');
const DIR = flagValue('dir');
const ACCOUNT_FLAG = flagValue('account');
const CAMPAIGN_FLAG = flagValue('campaign');
const DRY_RUN = process.argv.includes('--dry-run');
// Must be a positive integer — see positiveIntFlag for why a bad value would
// otherwise silently change how many rows get banked instead of failing.
const LIMIT = positiveIntFlag('limit', Infinity);

interface VideoInput {
  /** Drive link / public URL, or an absolute local path when `local` is true. */
  source: string;
  account: string;
  topic: string;
  local: boolean;
  /**
   * Optional local copy of the same video, used ONLY so Gemini can watch it
   * when writing the caption.
   *
   * This exists because the media source and the caption source have different
   * constraints. Blotato's /v2/media caps base64 uploads at ~13.5MB (verified:
   * 18MB of base64 accepted, 20MB rejected "Base64 data is too large", 32MB
   * → 413) — but has no such limit when it fetches from a URL. Gemini's Files
   * API, meanwhile, takes 2GB. So a large video posts from its Drive URL at
   * full original quality while Gemini reads the local copy to caption it.
   */
  captionFrom?: string;
}

// ─── Input parsing ───────────────────────────────────────────

/** Minimal CSV row splitter — handles quoted fields containing commas. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** "5-study-hacks_final_v2.mp4" → "5 study hacks final v2" */
function filenameToTopic(file: string): string {
  return basename(file, extname(file))
    .replace(/[_-]+/g, ' ')
    .replace(/\b(final|v\d+|copy|export|render|draft)\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function readManifest(path: string): Promise<VideoInput[]> {
  const raw = await readFile(path, 'utf-8');
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new Error(`Manifest "${path}" is empty`);

  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const iUrl = header.indexOf('url');
  const iAccount = header.indexOf('account');
  const iTopic = header.indexOf('topic');
  const iCaptionFrom = header.indexOf('caption_from');
  if (iUrl === -1 || iAccount === -1) {
    throw new Error(`Manifest "${path}" needs at least "url" and "account" columns. Found: ${header.join(', ')}`);
  }

  const rows: VideoInput[] = [];
  for (let n = 1; n < lines.length; n++) {
    const cells = splitCsvLine(lines[n]);
    const url = cells[iUrl];
    const account = cells[iAccount]?.replace('@', '').toLowerCase();
    if (!url || !account) {
      console.log(`  row ${n + 1}: missing url or account — skipped`);
      continue;
    }
    // A row that isn't an http(s) URL is a local file path. This is how the
    // bulk-ingest manifest addresses files on disk while still allowing Drive
    // links in the same file.
    const local = !/^https?:\/\//i.test(url);
    const captionFromCell = iCaptionFrom >= 0 ? cells[iCaptionFrom] : '';
    // A remote row can name a local copy for Gemini to watch. Topic defaults to
    // that filename rather than the opaque Drive URL.
    const topicSource = captionFromCell || url;
    const topic = (iTopic >= 0 ? cells[iTopic] : '') || filenameToTopic(topicSource);
    rows.push({
      source: local ? resolve(url) : url,
      account,
      topic,
      local,
      captionFrom: captionFromCell ? resolve(captionFromCell) : undefined,
    });
  }
  return rows;
}

async function readDir(dir: string, account: string): Promise<VideoInput[]> {
  const files = await readdir(dir);
  const rows: VideoInput[] = [];
  for (const f of files.sort()) {
    const ext = extname(f).toLowerCase();
    if (AUDIO_ONLY_EXTS.has(ext)) {
      console.log(`  SKIP ${f} — ${ext} is audio-only and cannot be posted as a TikTok video.`);
      continue;
    }
    if (!VIDEO_EXTS.has(ext)) continue;
    // resolve(), not join(): the row id is a hash of `source`, so an unresolved
    // path would give the same file a different id depending on how --dir was
    // spelled (./videos vs videos vs an absolute path) and bank it twice.
    // Matches the manifest path, which already resolves.
    rows.push({ source: resolve(dir, f), account, topic: filenameToTopic(f), local: true });
  }
  return rows;
}

// ─── Preflight ───────────────────────────────────────────────

/**
 * Confirm a remote URL actually serves video bytes.
 *
 * A Drive file that isn't shared as "Anyone with the link" returns an HTML
 * sign-in page with HTTP 200. Blotato would happily store that HTML and the
 * post would fail later with a meaningless conversion error, so catch it here
 * where the fix ("open sharing") is obvious.
 */
async function checkRemote(url: string): Promise<{ ok: true } | { ok: false; reason: string }> {
  // Drive intermittently drops these connections ("fetch failed") — observed on
  // 4 of 31 videos across two runs, every one of which succeeded on retry. A
  // single attempt would silently drop those videos from the schedule, so
  // network-level errors are retried. A definitive HTTP answer (403, an HTML
  // sign-in page, wrong content-type) is NOT retried: that is a real
  // misconfiguration and retrying only delays the report.
  const MAX_ATTEMPTS = 4;
  let lastErr = 'unreachable';
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      // Drive ignores HEAD on the download endpoint; a ranged GET fetches only
      // the first bytes, which is enough to read the content-type.
      const res = await fetch(url, { headers: { Range: 'bytes=0-1023' } });
      if (!res.ok && res.status !== 206) return { ok: false, reason: `HTTP ${res.status}` };
      const type = res.headers.get('content-type') ?? '';
      if (type.includes('text/html')) {
        return {
          ok: false,
          reason: 'served an HTML page, not a file — set Drive sharing to "Anyone with the link"',
        };
      }
      if (type && !type.startsWith('video/') && !type.includes('octet-stream')) {
        return { ok: false, reason: `unexpected content-type "${type}"` };
      }
      return { ok: true };
    } catch (e) {
      lastErr = e instanceof Error ? e.message : 'unreachable';
      if (attempt < MAX_ATTEMPTS) {
        const wait = 2 ** (attempt - 1) * 2000; // 2s, 4s, 8s
        console.log(`      drive fetch failed (${lastErr}) — retry ${attempt}/${MAX_ATTEMPTS - 1} in ${wait / 1000}s`);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
  }
  return { ok: false, reason: `${lastErr} (after ${MAX_ATTEMPTS} attempts)` };
}

// ─── Main ────────────────────────────────────────────────────

(async () => {
  if (!MANIFEST && !DIR) {
    console.error('Usage: --manifest=videos.csv   OR   --dir=./videos --account=<handle>');
    process.exit(1);
  }
  if (DIR && !ACCOUNT_FLAG) {
    console.error('--dir mode requires --account=<handle> (which account these videos post to).');
    process.exit(1);
  }

  let inputs: VideoInput[];
  try {
    inputs = MANIFEST
      ? await readManifest(MANIFEST)
      : await readDir(DIR!, ACCOUNT_FLAG!.replace('@', '').toLowerCase());
  } catch (e) {
    console.error(`FATAL: ${e instanceof Error ? e.message : e}`);
    process.exit(1);
  }

  if (!inputs.length) {
    console.log('No video files found. Nothing to do.');
    return;
  }
  console.log(`Found ${inputs.length} video(s).${DRY_RUN ? '  [DRY RUN — nothing will be written]' : ''}\n`);

  // Resolve each handle to its account row + campaign. Doing this from the DB
  // (rather than a hardcoded handle→campaign map) means a video can never be
  // banked against a campaign the account doesn't belong to.
  const { data: accountRows, error: accErr } = await sb
    .from('accounts')
    .select('handle, campaign_id, active');
  if (accErr) {
    console.error(`FATAL: could not read accounts table — ${accErr.message}`);
    process.exit(1);
  }
  const accountMap = new Map(
    (accountRows ?? []).map((a) => [String(a.handle).toLowerCase(), a]),
  );

  const { data: campaignRows } = await sb.from('campaigns').select('id, slug');
  const slugById = new Map((campaignRows ?? []).map((c) => [c.id as string, c.slug as string]));

  // Never re-bank an id that already exists in any status — flipping a posted
  // row back to 'banked' would invite a duplicate publish.
  //
  // Scoped to `video_%` on purpose: an unfiltered select() is silently capped by
  // PostgREST (1000 rows by default) once the posts table grows, and a
  // truncated set means `have` misses ids that DO exist. Ids generated here are
  // always `video_<account>_<hash>`, so this filter is both complete and small.
  // The error is fatal rather than ignored — an empty `have` from a failed read
  // looks identical to "nothing banked yet" and would re-post live videos.
  const { data: existing, error: existErr } = await sb
    .from('posts')
    .select('id')
    .like('id', 'video_%');
  if (existErr) {
    console.error(`FATAL: could not read existing post ids — ${existErr.message}`);
    process.exit(1);
  }
  const have = new Set((existing ?? []).map((r) => r.id as string));

  let banked = 0;
  let skipped = 0;
  let failed = 0;

  for (const input of inputs) {
    if (banked >= LIMIT) break;

    // A Drive link's basename is junk ("view?usp=sharing"), so remote rows are
    // labelled by topic instead — that's what identifies the video to a human.
    const label = (input.local ? basename(input.source) : input.topic || input.source).slice(0, 60);

    // Reject audio-only inputs that came in via the manifest, where there is
    // no readdir filter to catch them.
    const ext = extname(input.source.split('?')[0]).toLowerCase();
    if (AUDIO_ONLY_EXTS.has(ext)) {
      console.log(`SKIP  ${label} — ${ext} is audio-only, TikTok needs a video track.`);
      skipped++;
      continue;
    }

    const account = accountMap.get(input.account);
    if (!account) {
      console.log(`SKIP  ${label} — no account "${input.account}" in the accounts table.`);
      skipped++;
      continue;
    }
    if (!account.active) {
      console.log(`SKIP  ${label} — account "${input.account}" is inactive.`);
      skipped++;
      continue;
    }

    // Stable id: same source + account always yields the same id, so re-running
    // the script is idempotent rather than creating duplicate bank entries.
    const hash = createHash('sha1').update(`${input.source}|${input.account}`).digest('hex').slice(0, 10);
    const id = `video_${input.account}_${hash}`;
    if (have.has(id)) {
      console.log(`SKIP  ${label} — already banked (${id}).`);
      skipped++;
      continue;
    }

    // Scope caption generation to this account's campaign so hashtags and tone
    // come from the right HASHTAG-BANK.md and campaign record.
    const slug = CAMPAIGN_FLAG ?? slugById.get(account.campaign_id as string);
    if (!slug) {
      console.log(`SKIP  ${label} — account "${input.account}" has no campaign attached.`);
      skipped++;
      continue;
    }
    setCampaignSlug(slug);

    const mime = MIME_BY_EXT[ext] ?? 'video/mp4';

    try {
      // 1. Caption FIRST, so --dry-run produces reviewable captions without
      //    uploading a single byte to Blotato. For a local file Gemini watches
      //    the video itself; filenames like "1.mp4" carry no topic, and a
      //    caption invented from the filename would be confidently wrong.
      //    A remote row can point at a local copy via `caption_from`, which is
      //    the normal setup for Drive-hosted video: Blotato posts the full
      //    quality original from Drive, Gemini reads the local copy to caption
      //    it. Gemini's Files API takes 2GB, so size is never a problem here.
      const watchPath = input.captionFrom ?? (input.local ? input.source : undefined);
      const { title, caption, hashtags } = watchPath
        ? await generateVideoCaptionFromFile(watchPath, mime, input.topic)
        : await generateVideoCaption(input.topic);

      // 2. Resolve the media URL Blotato will post from.
      //
      //    Local files are pushed straight to Blotato's own media store rather
      //    than Supabase Storage: there is no service-role key in .env.local,
      //    the bucket's per-file size limit is unverifiable from here, and
      //    Blotato (1GB limit) is where the bytes have to end up regardless.
      //    Caching the hosted URL as blotatoUrls[0] means posting time does
      //    zero re-upload — prepareVideoUrl() short-circuits on it.
      let videoUrl: string;
      let blotatoHosted = false;
      if (input.local) {
        const buf = await readFile(input.source);
        // Fail with the actual cause and the fix, not a bare 413 from Blotato.
        if (buf.length > MAX_LOCAL_UPLOAD_BYTES) {
          throw new Error(
            `${(buf.length / 1e6).toFixed(1)}MB exceeds Blotato's ~${(MAX_LOCAL_UPLOAD_BYTES / 1e6).toFixed(0)}MB ` +
              `base64 upload cap. Host it (Google Drive, "Anyone with the link") and put that URL in the manifest ` +
              `instead — Blotato fetches URLs server-side with no size limit — or re-encode the file smaller.`,
          );
        }
        if (DRY_RUN) {
          console.log(`      would upload ${(buf.length / 1e6).toFixed(1)}MB → Blotato /media`);
          videoUrl = '(dry-run — not uploaded)';
        } else {
          console.log(`      uploading ${(buf.length / 1e6).toFixed(1)}MB → Blotato /media…`);
          const dataUrl = `data:${mime};base64,${buf.toString('base64')}`;
          const res = await apiRequest<{ url?: string }>('blotato', '/media', {
            method: 'POST',
            body: { url: dataUrl },
          });
          if (!res.url) throw new Error('Blotato /media returned no url');
          videoUrl = res.url;
          blotatoHosted = true;
        }
      } else {
        videoUrl = toDirectMediaUrl(input.source);
        const check = await checkRemote(videoUrl);
        if (!check.ok) throw new Error(check.reason);
        if (isDriveUrl(input.source)) console.log('      drive link OK (direct-download form)');
      }

      // 3. Bank row. `mediaType: "video"` is what the posting routes branch on;
      //    rows without it are treated as slideshows exactly as before.
      const meta = {
        mediaType: 'video' as const,
        videoUrl,
        blotatoUrls: blotatoHosted ? [videoUrl] : undefined,
        title,
        caption,
        sourceUrl: input.source,
        topic: input.topic,
      };
      const row = {
        id,
        status: 'banked',
        account: input.account,
        flow: 'video',
        campaign_id: account.campaign_id,
        thumbnail_url: null,
        hashtags,
        format: 'video',
        hook_style: null,
        date: new Date().toISOString().slice(0, 10),
        failure_resolution_note: JSON.stringify(meta),
      };

      if (DRY_RUN) {
        console.log(`PLAN  ${label} → @${input.account} (${slug})`);
        console.log(`      TITLE: ${title}`);
        console.log(caption.split('\n').filter(Boolean).map((l) => `      | ${l}`).join('\n'));
      } else {
        // insert, NOT upsert: an upsert with status:'banked' would overwrite an
        // already-posted row back to banked and republish a live video. A
        // unique-violation here means the id is already banked, which is a
        // skip, not a failure.
        const { error } = await sb.from('posts').insert(row);
        if (error) {
          if (error.code === '23505') {
            console.log(`SKIP  ${label} — already banked (${id}).`);
            have.add(id);
            skipped++;
            continue;
          }
          throw new Error(error.message);
        }
        console.log(`BANK  ${label} → @${input.account} (${slug}) — "${title}"`);
      }
      have.add(id);
      banked++;
    } catch (e) {
      console.log(`FAIL  ${label} — ${e instanceof Error ? e.message : e}`);
      failed++;
    }
  }

  console.log(
    `\nDONE. ${DRY_RUN ? 'planned' : 'banked'}=${banked} skipped=${skipped} failed=${failed}`,
  );
  if (!DRY_RUN && banked > 0) {
    console.log('Open the dashboard → Content Bank to post or schedule them.');
  }
})().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.message : e);
  process.exit(1);
});
