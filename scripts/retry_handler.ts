/**
 * Retry handler — reuses archived slides from failed posts instead of
 * regenerating, saving Gemini image credits + API time.
 *
 * Flow:
 *   1. Every successful archive writes a `meta.json` sidecar (caption, title,
 *      metadata, attempts counter, latest Blotato postId).
 *   2. Before a cycle generates new content, we scan POST-TRACKER for rows
 *      with `status = error` and match them to archives via postId → meta.json.
 *   3. For each (flow, accountIndex) slot the cycle is about to generate, if a
 *      retryable archive exists, we reuse its slides instead of calling Gemini.
 *   4. After submission, meta.json is updated with the new postId + attempts++.
 *      Original tracker row is marked `retried → <new-postId>`.
 *   5. After 3 attempts, archives are skipped (treated as permanently failed).
 */

import { readFile, writeFile, mkdir, copyFile, readdir } from 'fs/promises';
import { join } from 'path';
import { log } from './api-client.js';

export const MAX_RETRY_ATTEMPTS = 3;
const POSTS_DIR = 'posts';
const TRACKER_PATH = 'data/POST-TRACKER.md';
const META_FILENAME = 'meta.json';

export type FlowType = 'photorealistic' | 'animated' | 'emoji_overlay';

function flowToFolder(flow: FlowType): 'flow1' | 'flow2' | 'flow3' {
  return flow === 'photorealistic' ? 'flow1' : flow === 'animated' ? 'flow2' : 'flow3';
}

function folderToFlow(folder: string): FlowType {
  return folder === 'flow1' ? 'photorealistic' : folder === 'flow2' ? 'animated' : 'emoji_overlay';
}

export interface ArchiveMeta {
  flow: FlowType;
  accountIndex: number;
  accountName: string;
  caption: string;
  title: string;
  // deliberately `any` — PostMetadata comes from text_overlay.ts and mutates as
  // we add experiment fields; pinning a type here would couple retry_handler
  // to that shape and break whenever it evolves.
  metadata: any;
  useCta: boolean;
  createdAt: string;
  postId: string | null;
  attempts: number;
  lastAttemptAt: string | null;
}

export interface RetryablePost {
  slidePaths: string[];
  caption: string;
  title: string;
  metadata: any;
  useCta: boolean;
  accountIndex: number;
  archiveDir: string;
  originalPostId: string;
  attempts: number;
}

/**
 * Archive generated slides + write meta.json sidecar. Returns archive directory.
 */
export async function archivePostWithMeta(
  slidePaths: string[],
  flow: FlowType,
  accountName: string,
  accountIndex: number,
  content: { caption: string; title: string; metadata: any; useCta: boolean },
): Promise<string> {
  const now = new Date();
  const folderName = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}_${accountName}`;
  const archiveDir = join(POSTS_DIR, flowToFolder(flow), folderName);
  await mkdir(archiveDir, { recursive: true });

  for (let i = 0; i < slidePaths.length; i++) {
    await copyFile(slidePaths[i], join(archiveDir, `slide_${i + 1}.png`));
  }

  const meta: ArchiveMeta = {
    flow,
    accountIndex,
    accountName,
    caption: content.caption,
    title: content.title,
    metadata: content.metadata,
    useCta: content.useCta,
    createdAt: now.toISOString(),
    postId: null,
    attempts: 0,
    lastAttemptAt: null,
  };
  await writeFile(join(archiveDir, META_FILENAME), JSON.stringify(meta, null, 2));

  log(`  Archived ${slidePaths.length} slides + meta.json to ${archiveDir}`);
  return archiveDir;
}

/**
 * Update an archive's meta.json after a submission attempt (success or failure).
 * Stores the latest Blotato postId and increments attempts.
 */
export async function recordAttempt(archiveDir: string, postId: string): Promise<void> {
  const metaPath = join(archiveDir, META_FILENAME);
  try {
    const raw = await readFile(metaPath, 'utf-8');
    const meta = JSON.parse(raw) as ArchiveMeta;
    meta.postId = postId;
    meta.attempts += 1;
    meta.lastAttemptAt = new Date().toISOString();
    await writeFile(metaPath, JSON.stringify(meta, null, 2));
  } catch (err) {
    log(`  recordAttempt failed for ${archiveDir}: ${err}`);
  }
}

/**
 * Parse POST-TRACKER.md and return the set of postIds whose latest status is
 * an error (retryable) AND have not been superseded by a `retried` marker.
 */
async function getErrorPostIds(): Promise<Set<string>> {
  const failed = new Set<string>();
  try {
    const content = await readFile(TRACKER_PATH, 'utf-8');
    const lines = content
      .split('\n')
      .filter((l) => l.startsWith('|') && !l.includes('Post ID') && !l.includes('---'));
    for (const line of lines) {
      const cols = line.split('|').map((c) => c.trim()).filter(Boolean);
      const postId = cols[0];
      const status = (cols[11] || '').toLowerCase();
      if (!postId) continue;
      if (status === 'error' || status.startsWith('error')) failed.add(postId);
    }
  } catch {
    // tracker missing → no retries
  }
  return failed;
}

/**
 * Scan every archive folder for a meta.json, return those whose latest
 * postId matches a `status=error` row in POST-TRACKER and have attempts
 * below the retry cap.
 */
async function scanArchivesForRetries(): Promise<(ArchiveMeta & { archiveDir: string })[]> {
  const errorIds = await getErrorPostIds();
  if (errorIds.size === 0) return [];

  const retries: (ArchiveMeta & { archiveDir: string })[] = [];
  for (const flowFolder of ['flow1', 'flow2', 'flow3']) {
    const baseDir = join(POSTS_DIR, flowFolder);
    let entries: string[];
    try {
      entries = await readdir(baseDir);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const archiveDir = join(baseDir, entry);
      const metaPath = join(archiveDir, META_FILENAME);
      let meta: ArchiveMeta;
      try {
        meta = JSON.parse(await readFile(metaPath, 'utf-8')) as ArchiveMeta;
      } catch {
        continue;
      }
      if (!meta.postId) continue;
      if (!errorIds.has(meta.postId)) continue;
      if (meta.attempts >= MAX_RETRY_ATTEMPTS) continue;
      retries.push({ ...meta, archiveDir });
    }
  }
  return retries;
}

/**
 * Build a lookup of retryable posts keyed by `${flow}:${accountIndex}`.
 * If multiple retries match the same slot, the oldest is chosen (gives
 * long-stranded failures priority).
 */
export async function findRetries(): Promise<Map<string, RetryablePost>> {
  const all = await scanArchivesForRetries();
  const byKey = new Map<string, RetryablePost>();

  // Sort oldest first
  all.sort((a, b) => a.createdAt.localeCompare(b.createdAt));

  for (const m of all) {
    const key = `${m.flow}:${m.accountIndex}`;
    if (byKey.has(key)) continue;

    // Reconstruct slide paths from archive
    const slidePaths: string[] = [];
    for (let i = 1; i <= 20; i++) {
      const slidePath = join(m.archiveDir, `slide_${i}.png`);
      try {
        await readFile(slidePath); // just check existence
        slidePaths.push(slidePath);
      } catch {
        break;
      }
    }
    if (!slidePaths.length) continue;

    byKey.set(key, {
      slidePaths,
      caption: m.caption,
      title: m.title,
      metadata: m.metadata,
      useCta: m.useCta,
      accountIndex: m.accountIndex,
      archiveDir: m.archiveDir,
      originalPostId: m.postId!,
      attempts: m.attempts,
    });
  }

  return byKey;
}

/**
 * After a retry's new Blotato post is submitted, mark the *original* tracker
 * row as `retried → <newPostId>` so it won't be picked up again.
 */
export async function markTrackerRowRetried(originalPostId: string, newPostId: string): Promise<void> {
  try {
    const content = await readFile(TRACKER_PATH, 'utf-8');
    const lines = content.split('\n');
    let changed = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!line.startsWith('|') || !line.includes(originalPostId)) continue;
      const cols = line.split('|').map((c) => c.trim()).filter(Boolean);
      if (cols[0] !== originalPostId) continue;
      cols[11] = `retried → ${newPostId}`;
      lines[i] = `| ${cols.join(' | ')} |`;
      changed = true;
      break;
    }
    if (changed) {
      await writeFile(TRACKER_PATH, lines.join('\n'));
      log(`  Marked ${originalPostId} as retried → ${newPostId}`);
    }
  } catch (err) {
    log(`  markTrackerRowRetried failed: ${err}`);
  }
}

// Keep folderToFlow exported for any future debugging tools
export { folderToFlow, flowToFolder };
