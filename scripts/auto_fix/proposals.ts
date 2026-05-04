/**
 * Proposal state management for the PROPOSE tier.
 *
 * A "proposal" is a candidate code change that passed verification but is
 * waiting for human approval before being applied to the working tree.
 *
 * Data layout:
 *   data/proposals/<id>/                    — shadow copy of every modified file
 *     <relative/path/to/file>               — full mutated contents at proposal time
 *   data/proposals/<id>.json                — metadata
 *   data/proposals/<id>.diff                — unified diff vs current file state
 *
 * Lifecycle:
 *   created → applied (after `approve <id>`)
 *           → rejected (after `reject <id>`)
 *
 * This file owns READ helpers for proposals. The propose_executor writes new
 * proposals; the CLI tool consumes these helpers to list/approve/reject.
 */

import { readFile, writeFile, mkdir, readdir, rm, copyFile, stat } from 'fs/promises';
import { dirname, join, relative } from 'path';

const PROPOSALS_DIR = 'data/proposals';

export interface ProposalMetadata {
  id: string;
  signature: string;
  description: string;
  createdAt: string;
  /** Files this proposal touches, relative to the repo root. */
  files: string[];
  status: 'pending' | 'applied' | 'rejected';
  /** Set when status transitions away from 'pending'. */
  resolvedAt?: string;
  /** Reasoning for the proposal — usually the catalog `action` text. */
  reason: string;
}

// ─── Helpers ──────────────────────────────────────────────────

function metadataPath(id: string): string {
  return join(PROPOSALS_DIR, `${id}.json`);
}
function diffPath(id: string): string {
  return join(PROPOSALS_DIR, `${id}.diff`);
}
function shadowDir(id: string): string {
  return join(PROPOSALS_DIR, id);
}

async function exists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

// ─── Public API ───────────────────────────────────────────────

export async function ensureProposalsDir(): Promise<void> {
  await mkdir(PROPOSALS_DIR, { recursive: true });
}

/**
 * Persist a fresh proposal. Caller must have already populated the shadow
 * directory + diff file before calling this.
 */
export async function writeMetadata(meta: ProposalMetadata): Promise<void> {
  await ensureProposalsDir();
  await writeFile(metadataPath(meta.id), JSON.stringify(meta, null, 2));
}

export async function readMetadata(id: string): Promise<ProposalMetadata | null> {
  try {
    return JSON.parse(await readFile(metadataPath(id), 'utf-8'));
  } catch {
    return null;
  }
}

export async function readDiff(id: string): Promise<string> {
  try { return await readFile(diffPath(id), 'utf-8'); } catch { return ''; }
}

/**
 * Copy a single file from the working tree into the proposal's shadow dir,
 * preserving its relative path so we can copy it back on approval.
 */
export async function shadowCapture(id: string, filePath: string): Promise<void> {
  const dest = join(shadowDir(id), filePath);
  await mkdir(dirname(dest), { recursive: true });
  await copyFile(filePath, dest);
}

/** Copy every file from the shadow dir back over the working tree. */
export async function shadowApply(id: string): Promise<{ restored: number }> {
  const meta = await readMetadata(id);
  if (!meta) throw new Error(`proposal ${id} not found`);
  let restored = 0;
  for (const f of meta.files) {
    const src = join(shadowDir(id), f);
    if (!(await exists(src))) continue;
    await mkdir(dirname(f), { recursive: true });
    await copyFile(src, f);
    restored++;
  }
  return { restored };
}

/** Delete a proposal's shadow + metadata + diff. Idempotent. */
export async function purge(id: string): Promise<void> {
  await rm(shadowDir(id), { recursive: true, force: true });
  await rm(metadataPath(id), { force: true });
  await rm(diffPath(id), { force: true });
}

/** List every proposal on disk, newest-first. */
export async function listAll(): Promise<ProposalMetadata[]> {
  await ensureProposalsDir();
  let entries: string[];
  try { entries = await readdir(PROPOSALS_DIR); } catch { return []; }
  const metas: ProposalMetadata[] = [];
  for (const e of entries) {
    if (!e.endsWith('.json')) continue;
    const m = await readMetadata(e.replace(/\.json$/, ''));
    if (m) metas.push(m);
  }
  return metas.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function transition(
  id: string,
  status: 'applied' | 'rejected',
): Promise<ProposalMetadata | null> {
  const meta = await readMetadata(id);
  if (!meta) return null;
  meta.status = status;
  meta.resolvedAt = new Date().toISOString();
  await writeMetadata(meta);
  return meta;
}

export const PATHS = { PROPOSALS_DIR, metadataPath, diffPath, shadowDir };
