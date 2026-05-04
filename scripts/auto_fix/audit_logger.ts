/**
 * Audit logger — persistent trail of every error the classifier saw, what tier
 * it was, and (later, once the fixer is wired in) what the system did about it.
 *
 * The log lives at data/auto-fix-log.md as a human-readable markdown table,
 * newest-first so a quick cat/less shows recent activity without scrolling.
 *
 * Concurrency note: every call is a full read-modify-write on a single file.
 * Safe in our pipeline (the cycle is sequential) but not if multiple scripts
 * begin writing in parallel. If that changes, swap to append-only with a
 * sidecar index.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { ClassifiedError } from './classifier.js';

const LOG_PATH = 'data/auto-fix-log.md';
const MAX_DATA_ROWS = 500; // roll off anything older

const HEADER = [
  '# Auto-Fix Audit Log',
  '',
  'Every error classified by the auto-fixer is recorded here. Newest first.',
  '',
  '| Timestamp (UTC) | Tier | Source | Status | Signature | Action | Handled |',
  '|-----------------|------|--------|--------|-----------|--------|---------|',
  '',
].join('\n');

export interface LogContext {
  /** What the system ultimately did with this error, if anything. */
  handled?: 'pending' | 'retried' | 'auto-fixed' | 'proposed' | 'escalated' | 'gave-up';
}

function formatRow(c: ClassifiedError, ctx: LogContext = {}, staleHint = ''): string {
  const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
  const tier = c.tier;
  const source = c.source;
  const status = c.status == null ? '-' : String(c.status);
  const sig = `\`${c.signature}\``;
  // Escape pipe chars inside the cell contents
  const baseAction = c.action.replace(/\|/g, '\\|').slice(0, 140);
  const action = staleHint ? `${baseAction} ${staleHint}` : baseAction;
  const handled = ctx.handled ?? 'pending';
  return `| ${ts} | ${tier} | ${source} | ${status} | ${sig} | ${action} | ${handled} |`;
}

async function readOrInit(): Promise<{ dataRows: string[] }> {
  try {
    const raw = await readFile(LOG_PATH, 'utf-8');
    const lines = raw.split('\n');
    const dataRows = lines.filter((l) => l.startsWith('| 20')); // rows start with "| 2026-..."
    return { dataRows };
  } catch {
    return { dataRows: [] };
  }
}

async function writeAll(dataRows: string[]): Promise<void> {
  await mkdir(dirname(LOG_PATH), { recursive: true });
  // Cap at MAX_DATA_ROWS (newest-first means "oldest = last")
  const capped = dataRows.slice(0, MAX_DATA_ROWS);
  const body = capped.join('\n') + (capped.length ? '\n' : '');
  await writeFile(LOG_PATH, HEADER + body);
}

/** Append a classified error to the log (newest-first). */
export async function logClassified(
  c: ClassifiedError,
  ctx: LogContext = {},
): Promise<void> {
  // If the error is UNKNOWN but came from a source we DO have docs for, and
  // those docs are stale, flag that in the log AND enqueue a refresh request
  // so the operator (or Claude in next session) knows to fetch fresh docs.
  let staleHint = '';
  if (c.tier === 'UNKNOWN' && c.source !== 'unknown') {
    try {
      const { isStale, docPathFor } = await import('./docs_freshness.js');
      if (docPathFor(c.source) && (await isStale(c.source))) {
        staleHint = `⚠ docs stale — run \`npx tsx scripts/docs_refresh.ts queue\``;
        const { enqueue } = await import('./refresh_queue.js');
        await enqueue(
          c.source,
          c.signature,
          `UNKNOWN error with stale docs — refresh and re-classify`,
        );
      }
    } catch {
      // freshness/queue are non-critical; don't let them break logging
    }
  }

  const { dataRows } = await readOrInit();
  const newRow = formatRow(c, ctx, staleHint);
  // Prepend → newest first
  dataRows.unshift(newRow);
  await writeAll(dataRows);
}

/**
 * Update the `Handled` column on the most recent matching signature.
 * Used by later tiers (retry / auto-fix / escalate) to close the loop.
 */
export async function updateHandled(
  signature: string,
  handled: LogContext['handled'],
): Promise<void> {
  const { dataRows } = await readOrInit();
  for (let i = 0; i < dataRows.length; i++) {
    const row = dataRows[i];
    if (!row.includes(`\`${signature}\``)) continue;
    // Only the most recent pending entry gets updated
    if (!/\|\s*pending\s*\|$/.test(row)) continue;
    dataRows[i] = row.replace(/\|\s*pending\s*\|$/, `| ${handled ?? 'pending'} |`);
    await writeAll(dataRows);
    return;
  }
}

/** Quick stats — used by downstream alerting / a future dashboard page. */
export async function getLogStats(): Promise<{
  total: number;
  bySignature: Record<string, number>;
  last24hBySignature: Record<string, number>;
}> {
  const { dataRows } = await readOrInit();
  const now = Date.now();
  const dayAgo = now - 24 * 60 * 60 * 1000;
  const bySignature: Record<string, number> = {};
  const last24hBySignature: Record<string, number> = {};
  for (const row of dataRows) {
    const sigMatch = row.match(/`([^`]+)`/);
    if (!sigMatch) continue;
    const sig = sigMatch[1];
    bySignature[sig] = (bySignature[sig] || 0) + 1;

    const tsMatch = row.match(/\|\s*(\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2})\s*\|/);
    if (tsMatch) {
      const ts = Date.parse(tsMatch[1].replace(' ', 'T') + 'Z');
      if (!isNaN(ts) && ts >= dayAgo) {
        last24hBySignature[sig] = (last24hBySignature[sig] || 0) + 1;
      }
    }
  }
  return { total: dataRows.length, bySignature, last24hBySignature };
}
