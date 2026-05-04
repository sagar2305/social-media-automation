/**
 * Error catalog — the source of truth for classifying errors we've encountered
 * in production runs. Each entry maps a recognisable error signature to:
 *   - its upstream source (which API emitted it)
 *   - an action tier (determines what the auto-fixer does next)
 *   - a short human-readable suggested action
 *   - a pointer to the relevant doc (so the fixer can re-read / refresh it)
 *
 * This file grows over time as we encounter new errors. Every new production
 * error should result in a PR that adds an entry here and, where applicable,
 * a new tier action handler.
 */

// ─── Types ────────────────────────────────────────────────────

export type ErrorSource =
  | 'blotato'
  | 'gemini'
  | 'scrapeCreators'
  | 'virlo'
  | 'tmpfiles'
  | 'catbox'
  | 'tiktok'
  | 'local'
  | 'unknown';

/**
 * Action tier — determines how the auto-fixer responds.
 *   AUTO-FIX   — pure string/config change from a documented value; apply and
 *                commit without prompting.
 *   PROPOSE    — code change ≤10 lines in one file; stage on a branch and
 *                surface to the human for a thumbs-up.
 *   ASK        — architectural / multi-file / touches billing or auth; never
 *                proceed without explicit human confirmation.
 *   HUMAN-ONLY — auto-fix impossible (billing cap, account ban, upstream
 *                outage); log + notify and stop.
 *   RETRY      — transient failure; back off and try again on the current
 *                request. Does NOT modify code.
 */
export type ActionTier = 'AUTO-FIX' | 'PROPOSE' | 'ASK' | 'HUMAN-ONLY' | 'RETRY';

export interface CatalogEntry {
  /** Human-friendly id (stable across runs — used for circuit-breaker state). */
  id: string;
  source: ErrorSource;
  /** Matches against the error message or response body text. */
  match: RegExp;
  /** Optional additional match: exact HTTP status (if known). */
  status?: number;
  tier: ActionTier;
  /** One-line human-readable fix suggestion. */
  action: string;
  /** Relative path to the local doc section that covers this error. */
  docs?: string;
  /** Optional retry knobs (only honoured when tier === 'RETRY'). */
  retry?: {
    maxAttempts: number;
    backoffMs: number;
  };
  notes?: string;
}

// ─── Entries ──────────────────────────────────────────────────

export const ERROR_CATALOG: CatalogEntry[] = [
  // ─── Gemini ────────────────────────────────────────────────

  {
    id: 'gemini/monthly-spending-cap',
    source: 'gemini',
    match: /exceeded its monthly spending cap/i,
    status: 429,
    tier: 'HUMAN-ONLY',
    action: 'Raise the Gemini project spending cap at https://ai.studio/spend, or wait for the calendar month to roll over.',
    docs: 'docs/gemini-imagen-api.md',
    notes:
      'Hit 2026-04-23 mid-cycle. Billing ceiling, not a rate limit. No retry will succeed until the cap is raised.',
  },
  {
    id: 'gemini/resource-exhausted-transient',
    source: 'gemini',
    match: /RESOURCE_EXHAUSTED/i,
    status: 429,
    tier: 'RETRY',
    action: 'Short-term quota burst — back off and retry.',
    retry: { maxAttempts: 3, backoffMs: 2_000 },
    notes:
      'Only fire this entry when the message does NOT mention "monthly spending cap" — catalog ordering matters.',
  },
  {
    id: 'gemini/fetch-failed',
    source: 'gemini',
    match: /TypeError: fetch failed/i,
    tier: 'RETRY',
    action: 'Transient network error to generativelanguage.googleapis.com — retry with backoff.',
    retry: { maxAttempts: 3, backoffMs: 3_000 },
    notes:
      'Seen intermittently. If retries fail 3x, escalate to HUMAN-ONLY (network outage or cap ramp).',
  },

  // ─── Blotato ───────────────────────────────────────────────

  {
    id: 'blotato/tiktok-3-account-cap',
    source: 'blotato',
    match: /maximum number of 3 unique accounts/i,
    tier: 'HUMAN-ONLY',
    action:
      'Blotato Starter plan limit: 3 unique TikTok accounts per 24h. Skip the 4th account today (rotation handles this), or upgrade the Blotato plan.',
    docs: 'docs/blotato-api.md',
    notes:
      'We should never hit this now that main.ts proactively drops the 4th account. If we see it again, rotation logic broke.',
  },
  {
    id: 'blotato/media-conversion-failed',
    source: 'blotato',
    match: /Media conversion failed/i,
    tier: 'RETRY',
    action: 'Blotato failed to convert a slide — transient. Retry via retry_handler on next cycle.',
    docs: 'docs/blotato-api.md',
    retry: { maxAttempts: 3, backoffMs: 0 },
    notes:
      'retry_handler already reuses archived slides on the next cycle, so no in-line retry here.',
  },
  {
    id: 'blotato/internal-typeerror-status',
    source: 'blotato',
    match: /Cannot read properties of undefined \(reading 'status'\)/i,
    tier: 'RETRY',
    action:
      "Blotato's backend crashed parsing a TikTok response. Per their docs, retry after a short wait.",
    docs: 'docs/blotato-api.md',
    retry: { maxAttempts: 3, backoffMs: 60_000 },
    notes:
      "Confirmed transient per Blotato support docs: 'If a social platform fails to return a response, it is often a temporary issue that can be resolved by retrying after a short wait.'",
  },
  {
    id: 'blotato/rate-limit-generic',
    source: 'blotato',
    match: /Rate limit exceeded/i,
    status: 429,
    tier: 'RETRY',
    action: 'Back off (30s global, 10 req/min for /v2/media) and retry.',
    docs: 'docs/blotato-api.md',
    retry: { maxAttempts: 3, backoffMs: 30_000 },
  },
  {
    id: 'blotato/no-tiktok-account',
    source: 'blotato',
    match: /no TikTok account found for/i,
    tier: 'ASK',
    action:
      'Blotato does not have this TikTok handle connected. Either reconnect it at my.blotato.com or remove from config.tiktokAccounts.',
    notes: 'Config/env problem, not fixable in code without user consent.',
  },
  {
    id: 'blotato/tiktok-app-outdated',
    source: 'blotato',
    match: /update (?:their |the )?TikTok to the latest version/i,
    tier: 'HUMAN-ONLY',
    action:
      "TikTok rejected the upload because the TikTok app on the user's device is too old to support this post type (typically photo carousels with isAiGenerated=true on a draft). The fix is OFF-CODE: open the TikTok app on the phone where the failing account is logged in and update it from the App Store / Play Store. Retrying without updating will fail again.",
    docs: 'docs/blotato-api.md',
    notes:
      "First seen 2026-05-02 on @miniutewise_thomas (post e485634a). Same account's direct post on the same run succeeded — confirming this is a draft/finalize-flow gate, not an account/auth issue. Place this entry BEFORE blotato/post-status-error so it wins the regex match.",
  },
  {
    id: 'blotato/post-status-error',
    source: 'blotato',
    match: /Blotato post status returned (failed|error)/i,
    tier: 'RETRY',
    action:
      'Blotato accepted the submit but TikTok publish failed (status=failed). Synthesised by pull_analytics on status poll. retry_handler reuses archived slides on the next cycle.',
    docs: 'docs/blotato-api.md',
    retry: { maxAttempts: 3, backoffMs: 0 },
    notes:
      'Not raised by apiRequest — pull_analytics constructs this Error so the classifier sees terminal-status outcomes (otherwise they were silent). retry_handler picks up the postId from POST-TRACKER on the next cycle. Catch-all — order more-specific blotato status errors (e.g. tiktok-app-outdated) ABOVE this entry.',
  },

  // ─── ScrapeCreators ────────────────────────────────────────

  {
    id: 'scrapeCreators/out-of-credits',
    source: 'scrapeCreators',
    match: /out of credits|Looks like you're out of credits/i,
    status: 402,
    tier: 'HUMAN-ONLY',
    action:
      'ScrapeCreators account out of credits. Top up at https://scrapecreators.com/dashboard.',
    docs: 'docs/scrapecreators-api.md',
  },
  {
    id: 'scrapeCreators/v1-endpoint-suspended',
    source: 'scrapeCreators',
    match: /v1\/tiktok\/profile\/videos.*suspended|endpoint.*suspended/i,
    tier: 'AUTO-FIX',
    action:
      'Replace every `/v1/tiktok/profile/videos` call with `/v3/tiktok/profile/videos`. Response shape differs: iterate `aweme_list` instead of `data`.',
    docs: 'docs/scrapecreators-api.md',
    notes:
      'We already migrated everything to v3. This entry exists so any regression is caught fast.',
  },
  {
    id: 'scrapeCreators/cursor-pagination-stuck',
    source: 'scrapeCreators',
    match: /pagination returned identical|same page repeatedly|cursor.*ignored/i,
    tier: 'AUTO-FIX',
    action:
      'The `/v3/tiktok/profile/videos` cursor param is `max_cursor`, not `cursor`. Update request builder.',
    docs: 'docs/scrapecreators-api.md',
    notes:
      'Docs were wrong before. We fixed it 2026-04-20. Keep this entry to auto-detect a regression.',
  },

  // ─── Image hosts (deprecated — kept for regression detection) ──

  {
    id: 'tmpfiles/5xx',
    source: 'tmpfiles',
    match: /tmpfiles upload failed: 5\d\d/i,
    tier: 'AUTO-FIX',
    action:
      'tmpfiles.org is unreliable. Use Blotato /v2/media with base64 data URLs instead — already the active uploader.',
    docs: 'docs/blotato-api.md',
    notes:
      'Active uploader switched to Blotato base64 on 2026-04-19. This entry fires only if someone re-introduces tmpfiles.',
  },
  {
    id: 'catbox/empty-response',
    source: 'catbox',
    match: /catbox returned non-URL/i,
    tier: 'AUTO-FIX',
    action:
      'catbox.moe silently rate-limits with empty 200 responses. Switch uploader to Blotato /v2/media base64.',
    docs: 'docs/blotato-api.md',
  },

  // ─── Local: filesystem ─────────────────────────────────────

  {
    id: 'local/posts-folder-vanished',
    source: 'local',
    match: /ENOENT: no such file or directory,? open '?posts\//i,
    tier: 'HUMAN-ONLY',
    action:
      'Slide file vanished mid-run. Almost always means two posters ran concurrently on the same archive folder (one deleted it while the other was still uploading). Verify daily_runner mutex is in place; check data/.daily-runner.lock.',
    notes:
      'Hit 2026-04-30: three ENOENTs on flow2/flow3 archives during overlapping primary+catchup launchd firings. Fix landed: mkdir-based lock in scripts/daily_runner.sh.',
  },
  {
    id: 'local/file-not-found',
    source: 'local',
    match: /\bENOENT\b.*no such file or directory/i,
    tier: 'PROPOSE',
    action:
      'A file the script needed is missing. Common causes: a script renamed or moved a path without updating callers, a config file was removed, or a generated artifact was cleaned up. Inspect the path in the error and the caller.',
    notes:
      'Generic ENOENT — fires when the more specific posts-folder match does not. Order: posts-specific first, generic last.',
  },
  {
    id: 'local/permission-denied',
    source: 'local',
    match: /\bEACCES\b|permission denied/i,
    tier: 'HUMAN-ONLY',
    action:
      'Filesystem permission denied. Likely cause: a file was created by a different user (e.g. root via sudo) or the parent directory lost write permission. chmod/chown the path and rerun.',
  },
  {
    id: 'local/disk-full',
    source: 'local',
    match: /\bENOSPC\b|no space left on device/i,
    tier: 'HUMAN-ONLY',
    action:
      'Disk is full. Free up space — start with posts/raw_*.png (Gemini outputs accumulate at ~1.5 MB each), then data/cycle-logs/ archives.',
    notes:
      'Risk grows with batch count: 6 posts × 6 slides × ~1.5 MB ≈ 54 MB per cycle, daily.',
  },
  {
    id: 'local/too-many-open-files',
    source: 'local',
    match: /\bEMFILE\b|too many open files/i,
    tier: 'RETRY',
    action:
      'Too many open files — usually a file-descriptor leak in concurrent uploads. Retry with backoff; if it recurs, raise ulimit -n or audit unclosed streams.',
    retry: { maxAttempts: 3, backoffMs: 5_000 },
  },
  {
    id: 'local/file-busy',
    source: 'local',
    match: /\bEBUSY\b|resource busy or locked/i,
    tier: 'RETRY',
    action:
      'File or resource locked by another process — typically a brief race during writes. Retry shortly.',
    retry: { maxAttempts: 3, backoffMs: 2_000 },
  },

  // ─── Local: parse / module / env ──────────────────────────

  {
    id: 'local/json-parse-error',
    source: 'local',
    match: /SyntaxError.*JSON|Unexpected token.*in JSON|JSON\.parse/i,
    tier: 'PROPOSE',
    action:
      'A JSON file or API response failed to parse. If from a data/*.json file, the file was probably hand-edited or truncated mid-write. If from an API body, log the raw response and decide whether to add a defensive parse.',
  },
  {
    id: 'local/module-not-found',
    source: 'local',
    match: /Cannot find module|ERR_MODULE_NOT_FOUND|MODULE_NOT_FOUND/i,
    tier: 'PROPOSE',
    action:
      'A required module is missing — npm install probably did not run after a dependency was added, or a relative import path is wrong. Run npm ci and verify the import path.',
  },
  {
    id: 'local/env-var-missing',
    source: 'local',
    match: /(VIRLO_API_KEY|GEMINI_API_KEY|BLOTATO_API_KEY|SCRAPECREATORS_API_KEY).*(undefined|not set|missing|required)/i,
    tier: 'HUMAN-ONLY',
    action:
      'Required API key is missing from .env.local. Open .env.local and add the key — see CLAUDE.md "Environment Variables" for the full list.',
    notes:
      'Failing fast at startup is preferable to silent 401/403 from the API later.',
  },
  {
    id: 'local/subprocess-failed',
    source: 'local',
    match: /Command failed:|spawn .* ENOENT|child process exited with code/i,
    tier: 'PROPOSE',
    action:
      'A shell subprocess failed (likely scripts/overlay-text.py or another tsx call). Check the error stderr for the underlying cause: missing python3, missing pip dep, or non-zero exit from the wrapped script.',
    notes:
      'Most common offender: scripts/overlay-text.py — needs Pillow installed in the python3 environment used by the spawn.',
  },
  {
    id: 'local/timeout',
    source: 'local',
    match: /\b(?:operation|request) timed out|ETIMEDOUT|deadline exceeded\b/i,
    tier: 'RETRY',
    action:
      'Operation timed out. For external APIs, prefer the per-source RETRY entry. This is a fallback for local I/O timeouts (subprocess, file reads on slow disks).',
    retry: { maxAttempts: 3, backoffMs: 5_000 },
  },

  // ─── Network / filesystem ──────────────────────────────────

  {
    id: 'network/fetch-failed-generic',
    source: 'unknown',
    match: /^TypeError: fetch failed$/i,
    tier: 'RETRY',
    action: 'Low-level network error. Retry with modest backoff.',
    retry: { maxAttempts: 3, backoffMs: 5_000 },
    notes:
      'Catch-all for fetch failures not attributed to a specific API. Order this entry AFTER per-source fetch-failed entries.',
  },
];

// ─── Helpers ──────────────────────────────────────────────────

/**
 * Find the first catalog entry that matches this error. Returns null if none.
 * Caller is responsible for providing an ErrorSource hint — the catalog will
 * still match cross-source in case the hint is wrong (e.g. 'unknown').
 */
export function lookupCatalogEntry(params: {
  message: string;
  source?: ErrorSource;
  status?: number;
}): CatalogEntry | null {
  const { message, source, status } = params;
  for (const entry of ERROR_CATALOG) {
    if (entry.status && status && entry.status !== status) continue;
    if (source && source !== 'unknown' && entry.source !== source && entry.source !== 'unknown') continue;
    if (entry.match.test(message)) return entry;
  }
  return null;
}

/** Stable signature for circuit-breaker state. */
export function signatureFor(entry: CatalogEntry | null, message: string): string {
  if (entry) return entry.id;
  const trimmed = message.slice(0, 120).replace(/\s+/g, ' ').trim();
  return `unknown:${trimmed}`;
}
