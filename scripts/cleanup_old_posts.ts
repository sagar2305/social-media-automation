/**
 * Cleanup old generated assets in posts/ to keep disk usage bounded.
 *
 * What gets cleaned:
 *   1. posts/raw_*.png and posts/slide_*.png at the top level — Gemini
 *      intermediate outputs older than RETENTION_DAYS.
 *   2. posts/flow{1,2,3}/ archive folders that are older than RETENTION_DAYS.
 *
 * What is PRESERVED unconditionally:
 *   - posts/unposted/  (queue waiting to be posted — touching this loses content)
 *   - posts/cta/       (the static CTA image used by every post)
 *   - any folder whose mtime is within RETENTION_DAYS
 *
 * Defaults to dry-run. Pass `--force` to actually delete.
 *
 *   npm run cleanup:posts            # dry run, prints what WOULD be removed
 *   npm run cleanup:posts -- --force # actually delete
 */

import { readdir, stat, rm } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(__dirname, '..');
const POSTS_DIR = join(REPO_DIR, 'posts');

const RETENTION_DAYS = 14;
const DRY_RUN = !process.argv.includes('--force');

const PRESERVE_DIRS = new Set(['unposted', 'cta']);

interface Stats {
  scanned: number;
  removed: number;
  bytesFreed: number;
  preserved: number;
}

async function ageDays(path: string): Promise<number> {
  const s = await stat(path);
  return (Date.now() - s.mtimeMs) / 86_400_000;
}

async function dirSize(path: string): Promise<number> {
  let total = 0;
  try {
    const entries = await readdir(path, { withFileTypes: true });
    for (const e of entries) {
      const p = join(path, e.name);
      if (e.isDirectory()) total += await dirSize(p);
      else {
        const s = await stat(p);
        total += s.size;
      }
    }
  } catch { /* path vanished mid-scan — fine */ }
  return total;
}

async function maybeRemove(path: string, isDir: boolean, stats: Stats): Promise<void> {
  const age = await ageDays(path);
  stats.scanned++;
  if (age <= RETENTION_DAYS) return;

  let size = 0;
  try {
    size = isDir ? await dirSize(path) : (await stat(path)).size;
  } catch { /* skip */ }

  if (DRY_RUN) {
    console.log(`  [dry-run] would remove ${isDir ? 'dir ' : 'file'} ${path} (age=${age.toFixed(1)}d, ${(size / 1_048_576).toFixed(1)} MB)`);
  } else {
    await rm(path, { recursive: true, force: true });
    console.log(`  removed ${isDir ? 'dir ' : 'file'} ${path} (age=${age.toFixed(1)}d, ${(size / 1_048_576).toFixed(1)} MB)`);
  }
  stats.removed++;
  stats.bytesFreed += size;
}

async function main() {
  console.log(`Cleanup mode: ${DRY_RUN ? 'DRY-RUN (pass --force to delete)' : 'FORCE (deleting)'}`);
  console.log(`Retention: ${RETENTION_DAYS} days`);
  console.log(`Posts dir: ${POSTS_DIR}\n`);

  const stats: Stats = { scanned: 0, removed: 0, bytesFreed: 0, preserved: 0 };

  let entries;
  try {
    entries = await readdir(POSTS_DIR, { withFileTypes: true });
  } catch (err) {
    console.error('Could not read posts dir:', err);
    process.exit(1);
  }

  for (const entry of entries) {
    const path = join(POSTS_DIR, entry.name);

    // Preserve unposted queue + cta unconditionally
    if (entry.isDirectory() && PRESERVE_DIRS.has(entry.name)) {
      stats.preserved++;
      continue;
    }

    if (entry.isFile() && /^(raw_|slide_).*\.png$/i.test(entry.name)) {
      await maybeRemove(path, false, stats);
    } else if (entry.isDirectory() && /^flow[123]$/.test(entry.name)) {
      // Recurse one level: each subdir is a per-post archive folder.
      const subEntries = await readdir(path, { withFileTypes: true });
      for (const sub of subEntries) {
        if (sub.isDirectory()) await maybeRemove(join(path, sub.name), true, stats);
      }
    }
  }

  console.log(`\nScanned: ${stats.scanned}`);
  console.log(`${DRY_RUN ? 'Would remove' : 'Removed'}: ${stats.removed} (${(stats.bytesFreed / 1_048_576).toFixed(1)} MB)`);
  console.log(`Preserved: ${stats.preserved} unconditional dirs (${[...PRESERVE_DIRS].join(', ')})`);
  if (DRY_RUN && stats.removed > 0) {
    console.log(`\nRe-run with --force to actually delete.`);
  }
}

main().catch(err => {
  console.error('Cleanup failed:', err);
  process.exit(1);
});
