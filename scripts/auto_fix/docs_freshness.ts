/**
 * Docs freshness tracker.
 *
 * When classifier returns UNKNOWN for a *known* source, it's often because our
 * local docs no longer describe the error shape (the Blotato "no separate
 * upload endpoint" mistake on Apr 19 is the canonical example). This module
 * flags stale docs so a human knows to refresh them.
 *
 * State: data/docs-freshness.json  →  { [sourceName]: lastRefreshedIso }
 *
 * Manual refresh flow (until Day 3 automates it via context7):
 *   1. `npx tsx scripts/docs_refresh.ts list`   →  show stale docs
 *   2. Refresh the markdown file manually (or via Claude)
 *   3. `npx tsx scripts/docs_refresh.ts mark blotato`   →  stamp it fresh
 */

import { readFile, writeFile, mkdir, stat } from 'fs/promises';
import { dirname } from 'path';
import type { ErrorSource } from './error_catalog.js';

const STATE_PATH = 'data/docs-freshness.json';
const STALE_THRESHOLD_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

// Maps each source to its local doc file. Sources without a doc file are omitted.
const DOC_FILE_BY_SOURCE: Partial<Record<ErrorSource, string>> = {
  blotato: 'docs/blotato-api.md',
  gemini: 'docs/gemini-imagen-api.md',
  scrapeCreators: 'docs/scrapecreators-api.md',
  virlo: 'docs/virlo-api.md',
  tiktok: 'docs/tiktok-api.md',
};

// ─── State I/O ───────────────────────────────────────────────

interface FreshnessState {
  [source: string]: string; // ISO timestamp of last refresh
}

async function loadState(): Promise<FreshnessState> {
  try {
    return JSON.parse(await readFile(STATE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

async function saveState(state: FreshnessState): Promise<void> {
  await mkdir(dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

// ─── Public API ─────────────────────────────────────────────

/**
 * Returns the doc path for a source, or null if no doc is tracked for it.
 */
export function docPathFor(source: ErrorSource): string | null {
  return DOC_FILE_BY_SOURCE[source] ?? null;
}

/**
 * When was this source's doc last refreshed? Falls back to the file's mtime
 * if no explicit marker exists (gracefully handles pre-existing docs).
 */
export async function lastRefreshed(source: ErrorSource): Promise<Date | null> {
  const state = await loadState();
  if (state[source]) {
    const d = new Date(state[source]);
    if (!isNaN(d.getTime())) return d;
  }
  const path = docPathFor(source);
  if (!path) return null;
  try {
    const s = await stat(path);
    return s.mtime;
  } catch {
    return null;
  }
}

/** True if the source's doc is older than STALE_THRESHOLD_MS (or missing). */
export async function isStale(source: ErrorSource): Promise<boolean> {
  const last = await lastRefreshed(source);
  if (!last) return true;
  return Date.now() - last.getTime() > STALE_THRESHOLD_MS;
}

/**
 * Mark a source's doc as just-refreshed. Call after editing the .md file.
 */
export async function markFresh(source: ErrorSource): Promise<void> {
  const state = await loadState();
  state[source] = new Date().toISOString();
  await saveState(state);
}

/**
 * List every tracked source with its freshness status. Used by the CLI
 * (scripts/docs_refresh.ts) and can also feed the dashboard later.
 */
export async function listFreshness(): Promise<
  Array<{ source: ErrorSource; path: string; lastRefreshed: Date | null; stale: boolean }>
> {
  const rows = [] as Array<{ source: ErrorSource; path: string; lastRefreshed: Date | null; stale: boolean }>;
  for (const [source, path] of Object.entries(DOC_FILE_BY_SOURCE) as [ErrorSource, string][]) {
    const last = await lastRefreshed(source);
    const stale = last ? Date.now() - last.getTime() > STALE_THRESHOLD_MS : true;
    rows.push({ source, path, lastRefreshed: last, stale });
  }
  return rows;
}

export { STALE_THRESHOLD_MS };
