import sharp from "sharp";

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
let lastCallAt = 0;

/** Serialise Blotato calls so media uploads and posts share one rate budget. */
async function throttle() {
  const wait = lastCallAt + MIN_INTERVAL_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCallAt = Date.now();
}

async function blotatoFetch(path: string, apiKey: string, init?: RequestInit): Promise<Response> {
  await throttle();
  return fetch(`${BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", "blotato-api-key": apiKey, ...(init?.headers ?? {}) },
  });
}

// ─── Account resolution ──────────────────────────────────────

interface AccountsResponse {
  items: { id: string; platform: string; username?: string; fullname?: string }[];
}

let accountCache: { at: number; map: Map<string, string> } | null = null;
const ACCOUNT_TTL_MS = 5 * 60_000;

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
  let lastErr = "";
  for (let attempt = 1; attempt <= UPLOAD_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await blotatoFetch("/media", apiKey, {
        method: "POST",
        body: JSON.stringify({ url: dataUrl }),
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
