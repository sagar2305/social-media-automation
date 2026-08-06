/**
 * Caption + title + hashtags for a VIDEO post.
 *
 * Slideshow posts get this from text_overlay.generateContent(), which is
 * inseparable from slide generation — it returns 5-8 slides of overlay copy and
 * runs the A/B hook-style experiment machinery. A video already exists, so none
 * of that applies; only the caption half is wanted.
 *
 * Rather than fork the caption logic, this module reuses the two pure helpers
 * from text_overlay (pickHashtags, buildCaption), so a video caption is shaped
 * exactly like a slideshow caption and draws from the same 20-tag tiering and
 * the same per-campaign HASHTAG-BANK.md. Only the Gemini prompt is new — it
 * asks for a hook + body about a video topic instead of slide copy.
 *
 * Two paths, in order of preference:
 *   generateVideoCaptionFromFile() — the primary one. Uploads the video via the
 *     Gemini Files API so Gemini WATCHES it and writes from what is on screen.
 *   generateVideoCaption()         — text-only fallback. Writes from the topic
 *     string supplied at ingest, so a wrong topic yields a confident, wrong
 *     caption. Used when there is no local copy, or when the Files API fails.
 */

import { readFile, stat } from 'fs/promises';
import { basename } from 'path';
import { config } from '../../config/config.js';
import { log } from '../api-client.js';
import { dataPath, getCampaignSlug } from './campaign-paths.js';
import { getCampaign } from './campaigns.js';
import { pickHashtags, buildCaption } from '../text_overlay.js';

export interface VideoCaption {
  /**
   * TikTok post title. TikTok itself allows 2200 chars on video, but Blotato
   * rejects anything over 90 for both photo and video (docs/blotato-api.md), so
   * callers truncate at 90. The full text goes out in `caption`.
   */
  title: string;
  /** Full caption body: hook 💡 / body / hashtags. */
  caption: string;
  hashtags: string[];
}

async function readMemoryFile(filename: string): Promise<string> {
  try {
    return await readFile(dataPath(filename), 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Ask Gemini for a hook + 2-4 sentence body describing this video.
 * Returns null on any failure — the caller falls back to the topic itself,
 * so a Gemini outage degrades the caption rather than blocking the post.
 */
async function askGemini(
  topic: string,
  campaignName: string,
  brandLine: string,
  toneLine: string,
  trendSnippet: string,
): Promise<{ title: string; body: string } | null> {
  if (!config.gemini.apiKey) {
    log('[video-caption] Gemini API key not set — using topic as caption');
    return null;
  }

  const prompt = `You are a TikTok creator writing the caption for a VIDEO post for the ${campaignName} campaign.

${brandLine}
${toneLine}

WHAT THE VIDEO IS ABOUT:
${topic}

TRENDING CONTEXT (optional inspiration, ignore if irrelevant):
${trendSnippet}

Write:
- "title": a scroll-stopping hook line for this video. Max 100 characters. No hashtags, no quotes.
- "body": 2-4 short sentences expanding the hook and giving real value. Conversational, no corporate tone. No hashtags.

Return ONLY JSON: {"title": "...", "body": "..."}`;

  const MAX_ATTEMPTS = 3;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    try {
      const res = await fetch(
        `${config.gemini.baseUrl}/models/gemini-2.5-flash:generateContent?key=${config.gemini.apiKey}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { responseMimeType: 'application/json' },
          }),
        },
      );
      if (!res.ok) {
        log(`[video-caption] Gemini ${res.status} (attempt ${attempt}/${MAX_ATTEMPTS})`);
        continue;
      }
      const data = await res.json();
      const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) {
        log(`[video-caption] empty Gemini response (attempt ${attempt}/${MAX_ATTEMPTS})`);
        continue;
      }
      const parsed = JSON.parse(text);
      if (typeof parsed?.title !== 'string' || !parsed.title.trim()) {
        log(`[video-caption] Gemini JSON missing title (attempt ${attempt}/${MAX_ATTEMPTS})`);
        continue;
      }
      return {
        title: parsed.title.trim(),
        body: typeof parsed.body === 'string' ? parsed.body.trim() : '',
      };
    } catch (err) {
      log(`[video-caption] attempt ${attempt}/${MAX_ATTEMPTS} failed: ${err}`);
    }
  }
  return null;
}

// ─── Gemini Files API (video understanding) ──────────────────
//
// Filenames like "1.mp4" or "roastai CAPTIONED.mp4" carry no topic, so a
// caption written from the filename alone would be confident and wrong. The
// Files API lets Gemini watch the video itself and write from what actually
// happens in it.
//
// Contract (verified against ai.google.dev/gemini-api/docs/files and
// /video-understanding): resumable upload → poll until ACTIVE → reference the
// returned file_uri from a normal generateContent call. Free to use, 2GB per
// file, 20GB per project, files auto-delete after 48h — we consume them
// immediately, so retention is irrelevant.

/** Upload host differs from the API host: /upload/v1beta/files, not /v1beta. */
const GEMINI_UPLOAD_BASE = 'https://generativelanguage.googleapis.com/upload/v1beta/files';
const GEMINI_FILES_BASE = 'https://generativelanguage.googleapis.com/v1beta';

/** Poll budget. Processing a ~30s clip is quick; this is a generous ceiling. */
const FILE_ACTIVE_TIMEOUT_MS = 5 * 60_000;
const FILE_POLL_INTERVAL_MS = 5_000;

interface UploadedFile {
  uri: string;
  name: string;
}

/** Two-step resumable upload. Returns the file_uri to reference in prompts. */
async function uploadToGeminiFiles(
  localPath: string,
  mimeType: string,
  apiKey: string,
): Promise<UploadedFile> {
  const { size } = await stat(localPath);

  // Step 1 — start the resumable session. The upload URL comes back in a
  // header, not the body.
  const startRes = await fetch(GEMINI_UPLOAD_BASE, {
    method: 'POST',
    headers: {
      'x-goog-api-key': apiKey,
      'X-Goog-Upload-Protocol': 'resumable',
      'X-Goog-Upload-Command': 'start',
      'X-Goog-Upload-Header-Content-Length': String(size),
      'X-Goog-Upload-Header-Content-Type': mimeType,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ file: { display_name: basename(localPath) } }),
  });
  if (!startRes.ok) {
    throw new Error(`Files API start failed (${startRes.status}): ${(await startRes.text()).slice(0, 200)}`);
  }
  const uploadUrl = startRes.headers.get('x-goog-upload-url');
  if (!uploadUrl) throw new Error('Files API start returned no x-goog-upload-url header');

  // Step 2 — send the bytes and finalize in one shot. Read into memory only
  // here; the largest file in play is 162MB, well within a Node heap.
  const bytes = await readFile(localPath);
  const upRes = await fetch(uploadUrl, {
    method: 'POST',
    headers: {
      'Content-Length': String(size),
      'X-Goog-Upload-Offset': '0',
      'X-Goog-Upload-Command': 'upload, finalize',
    },
    body: new Uint8Array(bytes),
  });
  if (!upRes.ok) {
    throw new Error(`Files API upload failed (${upRes.status}): ${(await upRes.text()).slice(0, 200)}`);
  }
  const json = (await upRes.json()) as { file?: { uri?: string; name?: string } };
  const uri = json?.file?.uri;
  const name = json?.file?.name;
  if (!uri || !name) throw new Error('Files API upload returned no file uri/name');
  return { uri, name };
}

/** Poll until the uploaded video finishes processing. */
async function waitUntilActive(fileName: string, apiKey: string): Promise<void> {
  const deadline = Date.now() + FILE_ACTIVE_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const res = await fetch(`${GEMINI_FILES_BASE}/${fileName}`, {
      headers: { 'x-goog-api-key': apiKey },
    });
    if (!res.ok) throw new Error(`Files API status check failed (${res.status})`);
    const { state } = (await res.json()) as { state?: string };
    if (state === 'ACTIVE') return;
    if (state === 'FAILED') throw new Error('Gemini failed to process the video');
    await new Promise((r) => setTimeout(r, FILE_POLL_INTERVAL_MS));
  }
  throw new Error(`video still PROCESSING after ${FILE_ACTIVE_TIMEOUT_MS / 1000}s`);
}

/** Ask Gemini to watch the uploaded video and write the hook + body. */
async function askGeminiAboutVideo(
  file: UploadedFile,
  mimeType: string,
  apiKey: string,
  campaignName: string,
  brandLine: string,
  toneLine: string,
): Promise<{ title: string; body: string; topical: string[] }> {
  const prompt = `You are a TikTok creator writing the caption for this VIDEO, for the ${campaignName} campaign.

${brandLine}
${toneLine}

WATCH THE VIDEO and write a caption about what ACTUALLY happens in it. Do not invent details that are not on screen.

Return ONLY JSON:
{
  "title": "scroll-stopping hook line drawn from what happens in the video. Max 100 characters. No hashtags, no quotes.",
  "body": "2-4 short conversational sentences expanding the hook and giving real value. No hashtags.",
  "summary": "one plain sentence describing what happens in the video, for the operator to sanity-check against",
  "hashtags": ["6-8 hashtags SPECIFIC to what this video is about and the product it shows. Single words, no spaces, no '#' prefix. Topical only — no generic reach tags like fyp/viral/foryou, and no celebrity or news tags."]
}`;

  const res = await fetch(
    `${config.gemini.baseUrl}/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          { parts: [{ file_data: { file_uri: file.uri, mime_type: mimeType } }, { text: prompt }] },
        ],
        generationConfig: { responseMimeType: 'application/json' },
      }),
    },
  );
  if (!res.ok) {
    throw new Error(`Gemini video generateContent failed (${res.status}): ${(await res.text()).slice(0, 200)}`);
  }
  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('Gemini returned an empty response for the video');
  const parsed = JSON.parse(text);
  if (typeof parsed?.title !== 'string' || !parsed.title.trim()) {
    throw new Error('Gemini video response had no title');
  }
  if (typeof parsed?.summary === 'string' && parsed.summary.trim()) {
    log(`[video-caption]   saw: ${parsed.summary.trim()}`);
  }
  return {
    title: parsed.title.trim(),
    body: typeof parsed.body === 'string' ? parsed.body.trim() : '',
    topical: Array.isArray(parsed.hashtags)
      ? parsed.hashtags.filter((h: unknown): h is string => typeof h === 'string')
      : [],
  };
}

/**
 * Caption a video by having Gemini WATCH it.
 *
 * Falls back to the topic-only path on any failure, so one unreadable video
 * degrades to a filename-derived caption instead of aborting a 16-video batch.
 */
export async function generateVideoCaptionFromFile(
  localPath: string,
  mimeType: string,
  fallbackTopic: string,
): Promise<VideoCaption> {
  const apiKey = config.gemini.apiKey;
  if (!apiKey) {
    log('[video-caption] no Gemini key — falling back to topic-only caption');
    return generateVideoCaption(fallbackTopic);
  }

  try {
    const campaign = await getCampaign(getCampaignSlug());
    const campaignName = campaign?.name ?? 'MinuteWise';
    const brandLine = campaign
      ? `BRAND: ${campaign.name}${campaign.description ? ' — ' + campaign.description : ''}`
      : 'BRAND: MinuteWise — AI note-taker app for students.';
    const toneLine = campaign?.tone_of_voice ? `TONE OF VOICE: ${campaign.tone_of_voice}` : '';

    log(`[video-caption] uploading ${basename(localPath)} to Gemini for viewing…`);
    const file = await uploadToGeminiFiles(localPath, mimeType, apiKey);
    await waitUntilActive(file.name, apiKey);
    const { title, body, topical } = await askGeminiAboutVideo(
      file,
      mimeType,
      apiKey,
      campaignName,
      brandLine,
      toneLine,
    );

    // Gemini's per-video tags ride in as `tracked` — tier 2 of pickHashtags,
    // right after branded and ahead of the generic bank. That gives each video
    // hashtags about its own content without touching pickHashtags itself.
    // Needed because the Virlo bank is a global trending list with almost
    // nothing topical in it once the off-topic entities are denylisted.
    const hashtagBank = await readMemoryFile('HASHTAG-BANK.md');
    const hashtags = pickHashtags(
      hashtagBank,
      campaign?.branded_hashtags ?? null,
      [...topical, ...(campaign?.tracked_hashtags ?? [])],
    );
    const caption = buildCaption(title, hashtags, body);
    log(`[video-caption] "${title}" (${hashtags.length} hashtags) [watched]`);
    return { title, caption, hashtags };
  } catch (err) {
    log(
      `[video-caption] video understanding failed (${err instanceof Error ? err.message : err}) ` +
        `— falling back to topic-only caption`,
    );
    return generateVideoCaption(fallbackTopic);
  }
}

/**
 * Build the caption for one video.
 *
 * `topic` is whatever describes the video — a filename turned into words, or an
 * explicit topic column from the manifest.
 */
export async function generateVideoCaption(topic: string): Promise<VideoCaption> {
  const campaign = await getCampaign(getCampaignSlug());
  const campaignName = campaign?.name ?? 'MinuteWise';

  const brandLine = campaign
    ? `BRAND: ${campaign.name}${campaign.description ? ' — ' + campaign.description : ''}`
    : 'BRAND: MinuteWise — AI note-taker app for students.';
  const toneLine = campaign?.tone_of_voice ? `TONE OF VOICE: ${campaign.tone_of_voice}` : '';

  const [hashtagBank, trendingNow] = await Promise.all([
    readMemoryFile('HASHTAG-BANK.md'),
    readMemoryFile('TRENDING-NOW.md'),
  ]);

  const ai = await askGemini(topic, campaignName, brandLine, toneLine, trendingNow.slice(0, 500));

  // Fallback: the topic IS the hook. Never blocks the post on a Gemini failure.
  const title = ai?.title ?? topic;
  const body = ai?.body ?? '';

  const hashtags = pickHashtags(
    hashtagBank,
    campaign?.branded_hashtags ?? null,
    campaign?.tracked_hashtags ?? null,
  );

  const caption = buildCaption(title, hashtags, body);
  log(`[video-caption] "${title}" (${hashtags.length} hashtags)${ai ? '' : ' [fallback — Gemini unavailable]'}`);

  return { title, caption, hashtags };
}
