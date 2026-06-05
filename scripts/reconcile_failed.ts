/**
 * Reconcile failed posts — Blotato is the source of truth.
 *
 * Some posts fail ASYNCHRONOUSLY: they submit fine (real postSubmissionId,
 * tracker row = `pending`/`scheduled`), then Blotato marks them `failed` later
 * during publishing. Blotato support confirmed the common cause is a transient
 * TikTok-side hiccup ("the platform did not return a response" → their
 * "Cannot read properties of undefined (reading 'status')" error) and the fix
 * is simply to retry. retry_handler.ts only catches SYNCHRONOUS submit failures
 * (tracker = `error`), so it misses these.
 *
 * This script closes that gap:
 *   1. Read the active campaign's POST-TRACKER for non-terminal rows
 *      (pending / scheduled / in-progress / error).
 *   2. Ask Blotato for each post's real status (GET /v2/posts/:id).
 *   3. For ones that are `failed`/`error` with a RETRYABLE message, find the
 *      archived slides (via meta.json postId) and re-post them, reusing the exact
 *      same content — no Gemini regeneration. Defaults to a TikTok DRAFT (project
 *      convention); pass --path=direct to publish the recovered post live.
 *   4. Bump the archive's attempts counter (cap = MAX_RETRY_ATTEMPTS) and mark
 *      the original tracker row `retried → <new-postId>`.
 *
 * Run:  npm run reconcile -- --campaign=minutewise              (re-post as drafts)
 *       npm run reconcile -- --campaign=roastai --path=direct   (re-publish live)
 *       npm run reconcile -- --campaign=roastai --dry-run       (report only)
 * (campaign also honours the CAMPAIGN_SLUG env var, then defaults to minutewise)
 */

import { readFile, writeFile, readdir } from 'fs/promises';
import { join } from 'path';
import { config } from '../config/config.js';
import { apiRequest, log } from './api-client.js';
import { getCampaignSlug, dataPath } from './lib/campaign-paths.js';
import { getCampaign } from './lib/campaigns.js';
import { loadAccountsIntoConfig } from './account_loader.js';
import { postSlideshow } from './post_to_tiktok.js';
import {
  MAX_RETRY_ATTEMPTS,
  recordAttempt,
  type ArchiveMeta,
} from './retry_handler.js';

const POSTS_DIR = 'posts';
const META_FILENAME = 'meta.json';

// Tracker statuses that are NOT a terminal success — worth re-checking against
// Blotato. `published`, `retried → …` and `draft` are skipped.
const NON_TERMINAL = ['pending', 'scheduled', 'in-progress', 'error'];

// Blotato/TikTok messages for transient publish failures that re-posting fixes.
// Confirmed by Blotato support: the `reading 'status'` error means TikTok
// returned no response (temporary). The "after N retries" / "unknown reason"
// family is TikTok briefly rejecting the publish.
const RETRYABLE_PATTERNS: RegExp[] = [
  /cannot read properties of undefined/i,
  /internal error/i,
  /did not return a response/i,
  /after \d+ retries/i,
  /unknown error/i,
  /connection error/i,
  /timeout|timed out/i,
  /\b5\d\d\b/, // 5xx
];

function isRetryable(msg: string): boolean {
  return !!msg && RETRYABLE_PATTERNS.some((re) => re.test(msg));
}

interface BlotatoStatus {
  status?: string;
  publicUrl?: string;
  errorMessage?: string;
}

/** Read postIds from non-terminal tracker rows for the active campaign. */
async function nonTerminalPostIds(): Promise<string[]> {
  const trackerPath = dataPath('POST-TRACKER.md');
  const ids: string[] = [];
  let content: string;
  try {
    content = await readFile(trackerPath, 'utf-8');
  } catch {
    return ids;
  }
  for (const line of content.split('\n')) {
    if (!line.startsWith('|') || line.includes('Post ID') || line.includes('---')) continue;
    // slice(1,-1) drops only the empty cells from the surrounding table pipes,
    // keeping interior empty cells so column indexes stay aligned (filter(Boolean)
    // would shift them and read the wrong status column).
    const cols = line.split('|').slice(1, -1).map((c) => c.trim());
    const postId = cols[0];
    const status = (cols[11] || '').toLowerCase();
    if (!postId || postId.startsWith('FAILED')) continue; // FAILED_* never reached Blotato
    if (NON_TERMINAL.some((s) => status.startsWith(s))) ids.push(postId);
  }
  return ids;
}

/** Locate the archive whose meta.json points at this Blotato postId. */
async function findArchiveByPostId(
  postId: string,
): Promise<(ArchiveMeta & { archiveDir: string }) | null> {
  for (const folder of ['flow1', 'flow2', 'flow3']) {
    const base = join(POSTS_DIR, folder);
    let entries: string[];
    try {
      entries = await readdir(base);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const archiveDir = join(base, entry);
      try {
        const meta = JSON.parse(
          await readFile(join(archiveDir, META_FILENAME), 'utf-8'),
        ) as ArchiveMeta;
        if (meta.postId === postId) return { ...meta, archiveDir };
      } catch {
        continue;
      }
    }
  }
  return null;
}

/** Reconstruct ordered slide paths from an archive dir. */
async function slidePathsFor(archiveDir: string): Promise<string[]> {
  return (await readdir(archiveDir).catch(() => []))
    .filter((f) => /^slide_[1-9]\d*\.png$/.test(f))
    .sort((a, b) => parseInt(a.match(/\d+/)![0], 10) - parseInt(b.match(/\d+/)![0], 10))
    .map((f) => join(archiveDir, f));
}

/**
 * Mark the original failed row `retried → <newPostId>` in the ACTIVE campaign's
 * tracker so it isn't reconciled again. Campaign-aware via dataPath (unlike
 * retry_handler's hardcoded path, which only works for the minutewise symlink).
 */
async function markRetried(originalPostId: string, newPostId: string): Promise<void> {
  const trackerPath = dataPath('POST-TRACKER.md');
  try {
    const lines = (await readFile(trackerPath, 'utf-8')).split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith('|') || !line.includes(originalPostId)) continue;
      // slice(1,-1) preserves interior empty cells so cols[11] is the real
      // status column and the rejoin doesn't drop/shift any field.
      const cols = line.split('|').slice(1, -1).map((c) => c.trim());
      if (cols[0] !== originalPostId) continue;
      cols[11] = `retried → ${newPostId}`;
      lines[i] = `| ${cols.join(' | ')} |`;
      await writeFile(trackerPath, lines.join('\n'));
      return;
    }
  } catch (err) {
    log(`  markRetried failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function reconcile(): Promise<void> {
  // Shared resolver — honours --campaign=, then CAMPAIGN_SLUG env, then default.
  const slug = getCampaignSlug();
  const dryRun = process.argv.includes('--dry-run');
  // Default to drafts (project convention: never auto-publish live). The
  // operator opts into live publishing with --path=direct.
  const postingPath = process.argv.includes('--path=direct') ? 'direct' : 'draft';
  const accountCount = await loadAccountsIntoConfig(slug);
  const campaign = await getCampaign(slug);
  log(`=== RECONCILE FAILED POSTS — campaign "${slug}" (${accountCount} accounts) [path=${postingPath}${dryRun ? ', DRY-RUN' : ''}] ===`);
  if (!campaign) {
    log(`[reconcile] WARNING: campaign "${slug}" not loaded from Supabase — using back-compat account list`);
  }

  const ids = await nonTerminalPostIds();
  if (ids.length === 0) {
    log('[reconcile] no non-terminal posts in tracker — nothing to check');
    return;
  }
  log(`[reconcile] checking ${ids.length} non-terminal post(s) against Blotato...`);

  // 1) Query Blotato (source of truth) for each.
  const toRetry: { postId: string; err: string }[] = [];
  let stillPending = 0;
  let published = 0;
  for (const id of ids) {
    let st: BlotatoStatus;
    try {
      st = await apiRequest<BlotatoStatus>('blotato', `/posts/${id}`);
    } catch (e) {
      log(`[reconcile] status check failed for ${id}: ${e instanceof Error ? e.message : String(e)}`);
      continue;
    }
    const status = (st.status || '').toLowerCase();
    if (status === 'published') {
      published++;
      continue;
    }
    if (status === 'failed' || status === 'error') {
      const msg = st.errorMessage || '';
      if (isRetryable(msg)) {
        toRetry.push({ postId: id, err: msg });
        log(`[reconcile] RETRYABLE failure ${id}: ${msg.slice(0, 90)}`);
      } else {
        log(`[reconcile] non-retryable failure ${id}: ${msg.slice(0, 90)} — leaving as-is`);
      }
    } else {
      stillPending++; // scheduled / in-progress — not failed yet, leave it
    }
  }
  log(`[reconcile] ${toRetry.length} retryable, ${published} already published, ${stillPending} still pending/scheduled`);

  if (toRetry.length === 0) return;

  // 2) Re-post each retryable failure from its archive.
  let reposted = 0;
  let dryRunCount = 0;
  for (const { postId } of toRetry) {
    const archive = await findArchiveByPostId(postId);
    if (!archive) {
      log(`[reconcile] no archive found for ${postId} — cannot re-post (skipping)`);
      continue;
    }
    if (archive.attempts >= MAX_RETRY_ATTEMPTS) {
      log(`[reconcile] ${postId} (${archive.accountName}) hit ${MAX_RETRY_ATTEMPTS}-attempt cap — skipping`);
      continue;
    }
    // Resolve the account index from the CURRENTLY loaded (campaign-scoped)
    // config — never trust the stored index, since campaign scoping can
    // reorder accounts. A non-match means the archive belongs to a different
    // campaign than the one we're reconciling, so skip it.
    const acctIdx = config.tiktokAccounts.findIndex((a) => a.name === archive.accountName);
    if (acctIdx < 0) {
      log(`[reconcile] account "${archive.accountName}" not in campaign "${slug}" — skipping ${postId}`);
      continue;
    }
    const slidePaths = await slidePathsFor(archive.archiveDir);
    if (slidePaths.length === 0) {
      log(`[reconcile] no slide images in ${archive.archiveDir} — skipping ${postId}`);
      continue;
    }
    if (dryRun) {
      log(`[reconcile] DRY-RUN: would re-post ${postId} (${archive.accountName}, ${archive.flow}, ${slidePaths.length} slides, path=${postingPath}) — attempt ${archive.attempts + 1}/${MAX_RETRY_ATTEMPTS}`);
      dryRunCount++;
      continue;
    }
    try {
      log(`[reconcile] re-posting ${postId} (${archive.accountName}, ${archive.flow}) [${postingPath}] — attempt ${archive.attempts + 1}/${MAX_RETRY_ATTEMPTS}`);
      const result = await postSlideshow(
        slidePaths,
        archive.caption,
        archive.title,
        archive.metadata,
        archive.useCta,
        acctIdx,
        postingPath, // draft by default; --path=direct to publish live
      );
      await recordAttempt(archive.archiveDir, result.postId);
      await markRetried(postId, result.postId);
      reposted++;
      log(`[reconcile] ✓ re-posted ${postId} → ${result.postId}`);
    } catch (e) {
      log(`[reconcile] re-post FAILED for ${postId}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (dryRun) {
    log(`=== RECONCILE COMPLETE [DRY-RUN] — ${dryRunCount}/${toRetry.length} would be re-posted (path=${postingPath}) ===`);
  } else {
    log(`=== RECONCILE COMPLETE — ${reposted}/${toRetry.length} re-posted (path=${postingPath}) ===`);
  }
}

reconcile().catch((err) => {
  log(`Reconcile crashed: ${err instanceof Error ? err.stack : String(err)}`);
  process.exit(1);
});
