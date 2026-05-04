/**
 * Refresh queue — when classifier hits an UNKNOWN error from a known source
 * AND that source's docs are stale, we queue a refresh request here.
 *
 * Why a queue and not auto-fetch? The context7 docs API is exposed as a
 * Claude Code MCP tool, not as a public HTTP API callable from Node. So we
 * record what NEEDS refreshing; the actual fetch + write is performed by
 * Claude (or a human) running:
 *
 *   npx tsx scripts/docs_refresh.ts queue        # show pending requests
 *   npx tsx scripts/docs_refresh.ts mark <src>   # clear after refresh
 *
 * State: data/docs-refresh-queue.json
 *   { [source]: { reason, signature, queuedAt, count } }
 *
 * Each source has at most one entry; subsequent UNKNOWN errors increment
 * `count` and update `queuedAt` so we don't bloat the file.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';
import type { ErrorSource } from './error_catalog.js';

const QUEUE_PATH = 'data/docs-refresh-queue.json';

export interface QueueEntry {
  reason: string;
  /** Last signature that triggered this entry. */
  signature: string;
  queuedAt: string;
  count: number;
}

export type RefreshQueue = Partial<Record<ErrorSource, QueueEntry>>;

async function loadQueue(): Promise<RefreshQueue> {
  try {
    return JSON.parse(await readFile(QUEUE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

async function saveQueue(q: RefreshQueue): Promise<void> {
  await mkdir(dirname(QUEUE_PATH), { recursive: true });
  await writeFile(QUEUE_PATH, JSON.stringify(q, null, 2));
}

/**
 * Add or bump a refresh request for `source`. Idempotent: same source
 * triggered repeatedly just increments `count` and refreshes `queuedAt`.
 */
export async function enqueue(
  source: ErrorSource,
  signature: string,
  reason: string,
): Promise<void> {
  const q = await loadQueue();
  const existing = q[source];
  if (existing) {
    existing.count += 1;
    existing.queuedAt = new Date().toISOString();
    existing.signature = signature;
    existing.reason = reason;
  } else {
    q[source] = {
      reason,
      signature,
      queuedAt: new Date().toISOString(),
      count: 1,
    };
  }
  await saveQueue(q);
}

/** Remove a source from the queue (called by docs_refresh.ts mark <source>). */
export async function clear(source: ErrorSource): Promise<void> {
  const q = await loadQueue();
  delete q[source];
  await saveQueue(q);
}

/** Snapshot for CLI / dashboard use. */
export async function list(): Promise<Array<{ source: ErrorSource } & QueueEntry>> {
  const q = await loadQueue();
  return (Object.entries(q) as [ErrorSource, QueueEntry][]).map(([source, entry]) => ({
    source,
    ...entry,
  }));
}
