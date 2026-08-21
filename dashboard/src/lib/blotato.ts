import sharp from "sharp";
import { readFile } from "node:fs/promises";

/**
 * Blotato helpers shared by the Content Bank routes.
 *
 * Two things here exist because of bugs found by preflighting the bank against
 * the live API:
 *
 *  1. Account ids MUST be resolved live. The ids in config/config.ts are stale —
 *     @yournotetaker is 36969 upstream, not the `cmm…` id checked into config —
 *     so any hardcoded map silently fails for that account. The engine
 *     (scripts/post_to_tiktok.ts) has always resolved by username at runtime;
 *     these routes now do the same.
 *
 *  2. Slides must be compressed and pushed through /v2/media before posting.
 *     Bank slides are 2-3MB PNGs (median 1.98MB, max 3.09MB across 342 slides),
 *     and heavy PNGs have intermittently tripped Blotato's "Media conversion
 *     failed". The engine compresses to JPEG q85 first; so do we.
 */

const BASE = "https://backend.blotato.com/v2";

/** Blotato allows 30 req/min per user, across every endpoint. */
const MIN_INTERVAL_MS = 2_100;
let nextSlotAt = 0;

/**
 * Serialise Blotato calls so media uploads and posts share one rate budget.
 *
 * The slot is reserved SYNCHRONOUSLY, before any await: two concurrent callers
 * that both need to wait would otherwise read the same timestamp, compute the
 * same delay, and fire together — which is exactly the burst this is meant to
 * prevent. Advancing `nextSlotAt` up front makes each caller queue behind the
 * previous one instead.
 */
async function throttle() {
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + MIN_INTERVAL_MS;
  const wait = slot - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function blotatoFetch(path: string, apiKey: string, init?: RequestInit): Promise<Response> {
  await throttle();
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "blotato-api-key": apiKey, ...(init?.headers ?? {}) },
  });
}

// ─── Account resolution ──────────────────────────────────────

export type BlotatoAccount = {
  id: string;
  platform: string;
  username?: string;
  fullname?: string;
};

interface AccountsResponse {
  items: BlotatoAccount[];
}

let accountCache: { at: number; map: Map<string, string> } | null = null;
const ACCOUNT_TTL_MS = 5 * 60_000;

/** Read-only list of live connections. Never creates, updates, or posts. */
export async function listBlotatoAccounts(apiKey: string): Promise<BlotatoAccount[]> {
  const res = await blotatoFetch("/users/me/accounts", apiKey);
  if (!res.ok) throw new Error(`Blotato accounts lookup failed (${res.status})`);
  const json = (await res.json()) as AccountsResponse;
  return (json.items ?? []).map((item) => ({ ...item, id: String(item.id) }));
}

/** handle (no @, case-insensitive) → live Blotato account id. */
export async function getTiktokAccounts(apiKey: string): Promise<Map<string, string>> {
  if (accountCache && Date.now() - accountCache.at < ACCOUNT_TTL_MS) return accountCache.map;

  const res = await blotatoFetch("/users/me/accounts?platform=tiktok", apiKey);
  if (!res.ok) throw new Error(`Blotato accounts lookup failed (${res.status})`);
  const json = (await res.json()) as AccountsResponse;

  const map = new Map<string, string>();
  for (const a of json.items ?? []) {
    if (a.platform !== "tiktok") continue;
    if (a.username) map.set(a.username.toLowerCase(), a.id);
    if (a.fullname) map.set(a.fullname.toLowerCase(), a.id);
  }
  accountCache = { at: Date.now(), map };
  return map;
}

// ─── Media preparation ───────────────────────────────────────

/** PNGs above this get re-encoded; small ones are already safe. */
const COMPRESS_ABOVE_BYTES = 600_000;
const JPEG_QUALITY = 85;
const UPLOAD_ATTEMPTS = 3;

/**
 * Fetch a slide, compress it if it's a heavy PNG, and hand it to Blotato's
 * media store. Returns the Blotato-hosted URL to use as a mediaUrl.
 *
 * Compression failure is never fatal — it falls back to the original bytes,
 * exactly like the engine's `loadForUpload`.
 */
async function prepareOne(url: string, apiKey: string): Promise<string> {
  const srcRes = await fetch(url);
  if (!srcRes.ok) throw new Error(`slide unreachable (HTTP ${srcRes.status})`);
  const original = Buffer.from(await srcRes.arrayBuffer());
  const srcType = srcRes.headers.get("content-type") ?? "image/png";

  let body: Buffer = original;
  let mime = srcType;
  if (srcType.includes("png") && original.length > COMPRESS_ABOVE_BYTES) {
    try {
      const jpg = Buffer.from(await sharp(original).jpeg({ quality: JPEG_QUALITY }).toBuffer());
      if (jpg.length > 0 && jpg.length < original.length) {
        body = jpg;
        mime = "image/jpeg";
      }
    } catch {
      /* fall back to the original bytes — worst case is previous behaviour */
    }
  }

  const dataUrl = `data:${mime};base64,${body.toString("base64")}`;
  return uploadToBlotatoMedia(dataUrl, apiKey);
}

async function prepareBytes(original: Buffer, srcType: string, apiKey: string): Promise<string> {
  let body: Buffer = original;
  let mime = srcType;
  if (srcType.includes("png") && original.length > COMPRESS_ABOVE_BYTES) {
    try {
      const jpg = Buffer.from(await sharp(original).jpeg({ quality: JPEG_QUALITY }).toBuffer());
      if (jpg.length > 0 && jpg.length < original.length) {
        body = jpg;
        mime = "image/jpeg";
      }
    } catch {
      /* retain the original image */
    }
  }
  return uploadToBlotatoMedia(`data:${mime};base64,${body.toString("base64")}`, apiKey);
}

/** Upload already-validated local slideshow files for a Creddy post. */
export async function prepareLocalImageFiles(paths: string[], apiKey: string): Promise<string[]> {
  const out: string[] = [];
  for (let index = 0; index < paths.length; index += 1) {
    try {
      out.push(await prepareBytes(await readFile(paths[index]), "image/png", apiKey));
    } catch (error) {
      throw new Error(`slide ${index + 1}: ${error instanceof Error ? error.message : error}`);
    }
  }
  return out;
}

/**
 * Hand one URL to Blotato's media store and return the hosted URL.
 *
 * Accepts either a base64 `data:` URL (images, uploaded inline) or a plain
 * public URL that Blotato fetches server-side (videos — see prepareVideoUrl).
 * Extracted from prepareOne so both media kinds share one retry policy.
 */
async function uploadToBlotatoMedia(payloadUrl: string, apiKey: string): Promise<string> {
  let lastErr = "";
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await blotatoFetch("/media", apiKey, {
        method: "POST",
        body: JSON.stringify({ url: payloadUrl }),
      });
    } catch (e) {
      lastErr = e instanceof Error ? e.message : "network error";
      if (attempt < UPLOAD_ATTEMPTS) {
        await new Promise((r) => setTimeout(r, 2 ** (attempt - 1) * 1000));
        continue;
      }
      break;
    }
    if (res.ok) {
      const j = (await res.json().catch(() => ({}))) as { url?: string };
      if (j.url) return j.url;
      lastErr = "Blotato /media returned no url";
      break;
    }
    lastErr = `Blotato /media ${res.status}`;
    // Retry anything transient: rate limits, server errors, and the timeout
    // family — 408 (request timeout) and 499 (nginx "client closed request",
    // which Blotato returns when a large upload stalls). A genuine 4xx body
    // error is not retried.
    const transient =
      res.status === 429 || res.status === 408 || res.status === 499 || res.status >= 500;
    if (transient && attempt < UPLOAD_ATTEMPTS) {
      await new Promise((r) => setTimeout(r, 2 ** (attempt - 1) * 1000));
      continue;
    }
    break;
  }
  throw new Error(lastErr || "media upload failed");
}

/**
 * Prepare every slide of a post. Sequential on purpose: parallel uploads would
 * blow the 30 req/min ceiling and start returning 429s.
 */
export async function prepareMediaUrls(slideUrls: string[], apiKey: string): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < slideUrls.length; i++) {
    try {
      out.push(await prepareOne(slideUrls[i], apiKey));
    } catch (e) {
      throw new Error(`slide ${i + 1}: ${e instanceof Error ? e.message : e}`);
    }
  }
  return out;
}

/** True when a stored url already points at Blotato's media store. */
export function isBlotatoMediaUrl(url: string): boolean {
  return url.includes("database.blotato.io") || url.includes("blotato.com");
}

/**
 * Host a VIDEO on Blotato's media store, returning the hosted URL.
 *
 * Unlike slides, the bytes are never pulled through this server: the public
 * source URL is handed to Blotato and it fetches server-side. Videos routinely
 * run to hundreds of MB, and the slide path's base64 data URL would inflate
 * that by ~33% and hold it all in memory inside a JSON string — enough to kill
 * a serverless function. `/v2/media` accepts a plain public URL and video/mp4
 * up to 1GB (docs/blotato-api.md:399-435), so passthrough is both simpler and
 * the documented route.
 *
 * No re-encoding happens here. The video is published exactly as supplied.
 */
export async function prepareVideoUrl(videoUrl: string, apiKey: string): Promise<string> {
  // Already hosted by Blotato (cached from an earlier attempt) — reuse it
  // rather than paying for a second upload.
  if (isBlotatoMediaUrl(videoUrl)) return videoUrl;
  return uploadToBlotatoMedia(videoUrl, apiKey);
}

// ─── Payload construction ────────────────────────────────────

/**
 * Title limit.
 *
 * docs/tiktok-api.md:339 records TikTok's own limits as 90 chars for photo and
 * 2200 for video — but Blotato validates its OWN 90-char ceiling for BOTH and
 * rejects anything longer with:
 *   400 body.post.target.title must NOT have more than 90 characters
 * (hit for real on a scheduled video post). So 90 applies across the board;
 * the caption body still carries the full text.
 */
const TITLE_MAX = 90;

/**
 * Build the /v2/posts body for a TikTok post.
 *
 * Shared by the "post now" and "schedule" routes so the two can never drift.
 * The slideshow branch reproduces the payload both routes already sent, byte
 * for byte; `isVideo` selects the three documented differences:
 *
 *   - autoAddMusic is a PHOTO-post feature (docs/blotato-api.md:89). Verified
 *     against the live API: setting it on a video is silently ignored, so it is
 *     omitted for video rather than sent and disregarded.
 *   - mediaUrls carries exactly one .mp4 URL rather than N image URLs.
 *
 * The title cap is the SAME for both (see TITLE_MAX) — Blotato rejects >90
 * chars on video posts even though TikTok itself allows 2200.
 */
export function buildTikTokPostBody(opts: {
  accountId: string;
  caption: string;
  mediaUrls: string[];
  title: string;
  isVideo: boolean;
  /** ISO 8601. Omit for immediate publish. */
  scheduledTime?: string;
  /** Deliver to TikTok's app inbox for manual completion instead of publishing. */
  isDraft?: boolean;
}): Record<string, unknown> {
  const target: Record<string, unknown> = {
    targetType: "tiktok",
    privacyLevel: "PUBLIC_TO_EVERYONE",
    disabledComments: false,
    disabledDuet: false,
    disabledStitch: false,
    isBrandedContent: false,
    isYourBrand: false,
    // TikTok requires AI-generated content to be disclosed. Every post this
    // system makes is AI-assisted, so this stays true for video too.
    isAiGenerated: true,
    // Direct publish, not a TikTok draft. The bank exists to run the accounts
    // autonomously — a scheduled post that lands in the drafts folder never
    // goes out. Matches the engine's --path=direct.
    isDraft: opts.isDraft ?? false,
    title: opts.title.slice(0, TITLE_MAX),
  };
  if (!opts.isVideo) target.autoAddMusic = true;

  const body: Record<string, unknown> = {
    post: {
      accountId: opts.accountId,
      content: { text: opts.caption, mediaUrls: opts.mediaUrls, platform: "tiktok" },
      target,
    },
  };
  // scheduledTime lives at the ROOT, not inside `post` (docs/blotato-api.md:74).
  if (opts.scheduledTime) body.scheduledTime = opts.scheduledTime;
  return body;
}

export function buildInstagramPostBody(opts: {
  accountId: string;
  caption: string;
  mediaUrls: string[];
  scheduledTime?: string;
}): Record<string, unknown> {
  const body: Record<string, unknown> = {
    post: {
      accountId: opts.accountId,
      content: { text: opts.caption, mediaUrls: opts.mediaUrls, platform: "instagram" },
      // Blotato infers image vs carousel from mediaUrls. `mediaType` is not a
      // documented Instagram target field and can make an otherwise valid
      // carousel fail schema validation.
      target: { targetType: "instagram" },
    },
  };
  if (opts.scheduledTime) body.scheduledTime = opts.scheduledTime;
  return body;
}

// ─── Post submission ─────────────────────────────────────────

/**
 * Submit a post. Goes through the same throttle as media uploads so a batch
 * can't breach the shared 30 req/min budget.
 */
export async function submitPost(
  payload: unknown,
  apiKey: string
): Promise<{ ok: true; submissionId: string | null } | { ok: false; error: string }> {
  let res: Response;
  try {
    res = await blotatoFetch("/posts", apiKey, { method: "POST", body: JSON.stringify(payload) });
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error reaching Blotato" };
  }
  const j = (await res.json().catch(() => ({}))) as {
    message?: string;
    error?: string;
    postSubmissionId?: string;
    submissionId?: string;
    id?: string;
  };
  if (!res.ok) {
    return { ok: false, error: j?.message || j?.error || `Blotato error ${res.status}` };
  }
  return { ok: true, submissionId: j.postSubmissionId ?? j.submissionId ?? j.id ?? null };
}

export type BlotatoPostStatus = {
  status: "in-progress" | "queued" | "scheduled" | "published" | "failed";
  url?: string;
  error?: string;
};

export type BlotatoListedPost = {
  id: string;
  accountId?: string;
  platform?: string;
  text?: string;
  mediaUrls: string[];
  postTime?: string;
  state: { type: string; postUrl?: string };
};

/** Read-only reconciliation call for a submission already accepted by Blotato. */
export async function getBlotatoPostStatus(submissionId: string, apiKey: string): Promise<BlotatoPostStatus> {
  const res = await blotatoFetch(`/posts/${encodeURIComponent(submissionId)}`, apiKey);
  const json = (await res.json().catch(() => ({}))) as {
    status?: BlotatoPostStatus["status"];
    errorMessage?: string;
    result?: { url?: string };
  };
  if (!res.ok) throw new Error(json.errorMessage || `Blotato status lookup failed (${res.status})`);
  if (!json.status || !["in-progress", "queued", "scheduled", "published", "failed"].includes(json.status)) {
    throw new Error("Blotato returned an unknown post status");
  }
  return { status: json.status, url: json.result?.url, error: json.errorMessage };
}

/**
 * Read the live Blotato queue/calendar. Blotato's list endpoint uses numeric
 * post ids rather than submission UUIDs, so callers must correlate only on
 * strong evidence (a stored remote id or one unique platform/time match).
 */
export async function listBlotatoPosts(apiKey: string): Promise<BlotatoListedPost[]> {
  const posts: BlotatoListedPost[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  for (let page = 0; page < 10; page += 1) {
    const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
    const res = await blotatoFetch(`/posts${query}`, apiKey);
    const json = (await res.json().catch(() => ({}))) as {
      items?: Array<{
        id?: string | number;
        accountId?: string | number;
        platform?: string;
        text?: string;
        mediaUrls?: string[];
        postTime?: string;
        state?: { type?: string; postUrl?: string };
      }>;
      cursor?: string;
      errorMessage?: string;
    };
    if (!res.ok) throw new Error(json.errorMessage || `Blotato posts list failed (${res.status})`);
    for (const item of json.items ?? []) {
      if (item.id === undefined || !item.state?.type) continue;
      posts.push({
        id: String(item.id),
        accountId: item.accountId === undefined ? undefined : String(item.accountId),
        platform: item.platform,
        text: item.text,
        mediaUrls: item.mediaUrls ?? [],
        postTime: item.postTime,
        state: { type: item.state.type, postUrl: item.state.postUrl },
      });
    }
    cursor = json.cursor?.trim() || undefined;
    if (!cursor || seenCursors.has(cursor)) break;
    seenCursors.add(cursor);
  }
  return posts;
}
