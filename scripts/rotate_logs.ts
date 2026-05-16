/**
 * Truncate cycle log files that exceed a size threshold, preserving the most
 * recent N KB of content so the trailing context stays useful. Without this,
 * scheduler-tick.log / jobs-poller.log / launchd-daily.log grow unbounded
 * (they're append-only, written by long-running launchd plists), eventually
 * filling the disk on a long-uptime Mac mini.
 *
 * Strategy:
 *   - For every *.log under data/cycle-logs/ that exceeds MAX_BYTES,
 *     keep the trailing KEEP_BYTES and discard everything before.
 *   - Same for data/auto-fix-log.md and data/auto-fix-alerts.md (markdown,
 *     but treated as append-only logs with the same growth pattern).
 *
 * Idempotent. Run via:
 *   npm run rotate:logs           # dry-run (default)
 *   npm run rotate:logs -- --force
 *
 * Wired into daily-refresh.ts so it runs every 6h alongside the sync.
 */

import { readdir, stat, open } from 'node:fs/promises';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_DIR = resolve(__dirname, '..');

const MAX_BYTES = 1 * 1024 * 1024;   // rotate when file exceeds 1 MB
const KEEP_BYTES = 256 * 1024;       // keep last 256 KB after rotation

const TARGETS: { path: string; truncatable: boolean }[] = [
  { path: 'data/auto-fix-log.md', truncatable: true },
  { path: 'data/auto-fix-alerts.md', truncatable: true },
];

async function rotateFile(absPath: string, force: boolean): Promise<{ rotated: boolean; oldSize: number; newSize: number }> {
  const st = await stat(absPath);
  if (st.size <= MAX_BYTES) return { rotated: false, oldSize: st.size, newSize: st.size };

  if (!force) {
    return { rotated: true, oldSize: st.size, newSize: KEEP_BYTES };
  }

  // Open file, read tail KEEP_BYTES, truncate, rewrite tail.
  // Atomic enough for our purposes — append-only writers will continue from
  // the new end-of-file. Brief race window where a writer might append while
  // we're truncating; worst case we lose a few KB of brand-new logs. The
  // alternative (snapshot-and-rename) breaks plist file handles.
  const fh = await open(absPath, 'r+');
  try {
    const buf = Buffer.allocUnsafe(KEEP_BYTES);
    const { bytesRead } = await fh.read(buf, 0, KEEP_BYTES, st.size - KEEP_BYTES);
    await fh.truncate(0);
    await fh.write(
      Buffer.concat([
        Buffer.from(`# ─── Rotated ${new Date().toISOString()} (kept last ${KEEP_BYTES} bytes of ${st.size}) ───\n`),
        buf.subarray(0, bytesRead),
      ]),
      0,
    );
  } finally {
    await fh.close();
  }
  const after = await stat(absPath);
  return { rotated: true, oldSize: st.size, newSize: after.size };
}

async function main() {
  const force = process.argv.includes('--force');
  console.log(`Log rotation: ${force ? 'FORCE' : 'DRY-RUN (pass --force to apply)'}`);
  console.log(`Threshold: rotate when > ${(MAX_BYTES / 1_048_576).toFixed(1)} MB; keep tail ${(KEEP_BYTES / 1024).toFixed(0)} KB\n`);

  // Discover cycle-logs/*.log dynamically
  const cycleDir = join(REPO_DIR, 'data', 'cycle-logs');
  try {
    const entries = await readdir(cycleDir, { withFileTypes: true });
    for (const e of entries) {
      if (e.isFile() && /\.(log|err)$/.test(e.name)) {
        TARGETS.push({ path: join('data/cycle-logs', e.name), truncatable: true });
      }
    }
  } catch { /* dir missing — first-run repo */ }

  let totalFreed = 0;
  let rotatedCount = 0;
  for (const t of TARGETS) {
    const abs = join(REPO_DIR, t.path);
    try {
      const result = await rotateFile(abs, force);
      if (result.rotated) {
        const freed = result.oldSize - result.newSize;
        totalFreed += freed;
        rotatedCount++;
        console.log(`  ${force ? 'rotated' : '[dry-run]'} ${t.path}  (${(result.oldSize / 1024).toFixed(0)} KB → ${(result.newSize / 1024).toFixed(0)} KB, freed ${(freed / 1024).toFixed(0)} KB)`);
      }
    } catch (err) {
      // Missing file is fine; permission errors etc print but don't abort
      const msg = err instanceof Error ? err.message : String(err);
      if (!msg.includes('ENOENT')) console.warn(`  could not rotate ${t.path}: ${msg}`);
    }
  }

  console.log(`\n${force ? 'Rotated' : 'Would rotate'} ${rotatedCount} file(s); ${force ? 'freed' : 'would free'} ${(totalFreed / 1024).toFixed(0)} KB`);
}

main().catch(err => {
  console.error('rotate_logs failed:', err);
  process.exit(1);
});
