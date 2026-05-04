/**
 * PROPOSE-tier executor — for code changes that *should* be auto-applied but
 * need a human eyeball first. Differs from auto_fix_executor in that, even
 * after verify passes, we do NOT leave the change in place. Instead:
 *
 *   1. Snapshot original file contents
 *   2. Apply the fix (mutates files)
 *   3. Verify (tsc + canary)
 *   4a. If verify fails  → restore originals + log gave-up
 *   4b. If verify passes → copy mutated files into a shadow dir, restore
 *                          originals, write a unified diff, notify the human
 *
 * The proposal then waits in `data/proposals/` until the user runs:
 *   npx tsx scripts/auto_fix_proposals.ts approve <id>     → shadow → working tree
 *   npx tsx scripts/auto_fix_proposals.ts reject  <id>     → discarded
 *
 * Same circuit-breaker and tier-gate logic as auto_fix_executor.
 */

import { readFile, writeFile, rm, mkdir } from 'fs/promises';
import { dirname } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { logClassified, updateHandled } from './audit_logger.js';
import { recordAttempt, isTripped } from './circuit_breaker.js';
import { verify, formatResult, type VerifyResult } from './verifier.js';
import { maybeNotify } from './notifier.js';
import {
  ensureProposalsDir,
  writeMetadata,
  shadowCapture,
  PATHS,
  type ProposalMetadata,
} from './proposals.js';
import type { ClassifiedError } from './classifier.js';

const execFileP = promisify(execFile);

// ─── Types ────────────────────────────────────────────────────

export interface ProposeCandidate {
  files: string[];
  apply: () => Promise<void>;
  canary?: () => Promise<void>;
  description: string;
}

export type ProposeOutcome =
  | { result: 'proposed'; id: string; verify: VerifyResult; description: string }
  | { result: 'rolled-back'; verify: VerifyResult; description: string; reason: string }
  | { result: 'skipped-tripped'; reason: string }
  | { result: 'skipped-tier'; reason: string };

// ─── Snapshot / restore ──────────────────────────────────────

async function snapshot(paths: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const p of paths) {
    try { out.set(p, await readFile(p, 'utf-8')); } catch { out.set(p, null); }
  }
  return out;
}

async function restore(snap: Map<string, string | null>): Promise<void> {
  for (const [p, original] of snap) {
    if (original == null) {
      try { await rm(p); } catch {}
    } else {
      await mkdir(dirname(p), { recursive: true });
      await writeFile(p, original);
    }
  }
}

// ─── Diff generation (no extra dependencies) ─────────────────

async function unifiedDiff(
  filePath: string,
  before: string | null,
  after: string,
): Promise<string> {
  // Use plain `diff -u` against temp files. Available everywhere we run.
  const beforeTmp = `/tmp/auto-fix-before-${process.pid}-${randomUUID().slice(0, 8)}`;
  const afterTmp = `/tmp/auto-fix-after-${process.pid}-${randomUUID().slice(0, 8)}`;
  await writeFile(beforeTmp, before ?? '');
  await writeFile(afterTmp, after);
  let stdout = '';
  try {
    const r = await execFileP('diff', ['-u', '--label', `a/${filePath}`, '--label', `b/${filePath}`, beforeTmp, afterTmp]);
    stdout = r.stdout;
  } catch (err: any) {
    // diff exits 1 when files differ — that's fine, we still want the output
    if (typeof err.stdout === 'string') stdout = err.stdout;
    else stdout = `(diff failed for ${filePath}: ${err})`;
  } finally {
    try { await rm(beforeTmp); } catch {}
    try { await rm(afterTmp); } catch {}
  }
  return stdout;
}

async function buildDiff(
  snap: Map<string, string | null>,
  files: string[],
): Promise<string> {
  const chunks: string[] = [];
  for (const f of files) {
    const before = snap.get(f) ?? null;
    let after: string;
    try { after = await readFile(f, 'utf-8'); } catch { after = ''; }
    if ((before ?? '') === after) continue;
    chunks.push(await unifiedDiff(f, before, after));
  }
  return chunks.join('\n');
}

// ─── Main entry point ────────────────────────────────────────

export async function applyPropose(
  classified: ClassifiedError,
  candidate: ProposeCandidate,
): Promise<ProposeOutcome> {
  if (classified.tier !== 'PROPOSE') {
    return { result: 'skipped-tier', reason: `tier ${classified.tier} not eligible for PROPOSE` };
  }

  if (await isTripped(classified.signature)) {
    return { result: 'skipped-tripped', reason: `circuit breaker TRIPPED for ${classified.signature}` };
  }
  await recordAttempt(classified.signature);

  const snap = await snapshot(candidate.files);

  // 1. Apply
  try {
    await candidate.apply();
  } catch (err) {
    await restore(snap);
    const reason = `apply() threw: ${err}`;
    await updateHandled(classified.signature, 'gave-up');
    return {
      result: 'rolled-back',
      verify: { ok: false, errors: [reason], preExisting: [], durationMs: 0 },
      description: candidate.description,
      reason,
    };
  }

  // 2. Verify
  const v = await verify({ canary: candidate.canary });
  console.log(formatResult(v));
  if (!v.ok) {
    await restore(snap);
    await updateHandled(classified.signature, 'gave-up');
    return {
      result: 'rolled-back',
      verify: v,
      description: candidate.description,
      reason: `verify failed — ${v.errors[0] ?? 'no detail'}`,
    };
  }

  // 3. Capture mutated files into shadow, then restore working tree
  await ensureProposalsDir();
  const id = `${new Date().toISOString().slice(0, 10)}-${randomUUID().slice(0, 8)}`;
  for (const f of candidate.files) {
    try { await shadowCapture(id, f); } catch {} // missing files are fine
  }
  const diff = await buildDiff(snap, candidate.files);
  await writeFile(PATHS.diffPath(id), diff);

  // 4. Restore working tree to pre-fix state (so user's working tree is untouched)
  await restore(snap);

  const meta: ProposalMetadata = {
    id,
    signature: classified.signature,
    description: candidate.description,
    createdAt: new Date().toISOString(),
    files: candidate.files,
    status: 'pending',
    reason: classified.action,
  };
  await writeMetadata(meta);
  await updateHandled(classified.signature, 'proposed');

  // 5. Notify human (Slack / file fallback). We send only the catalog action +
  // a pointer to the proposal id, since diffs can be large.
  await maybeNotify({
    ...classified,
    action:
      `PROPOSE ${id}: ${candidate.description}\n` +
      `Approve: \`npx tsx scripts/auto_fix_proposals.ts approve ${id}\`\n` +
      `Reject:  \`npx tsx scripts/auto_fix_proposals.ts reject ${id}\``,
    tier: 'ASK',
  });

  return { result: 'proposed', id, verify: v, description: candidate.description };
}

// ─── Formatting helper ───────────────────────────────────────

export function formatProposeOutcome(o: ProposeOutcome): string {
  switch (o.result) {
    case 'proposed':
      return `📋 PROPOSE staged as ${o.id}: ${o.description} (verify ${o.verify.durationMs}ms)`;
    case 'rolled-back':
      return `✗ PROPOSE rolled back: ${o.description}\n  ${o.reason}`;
    case 'skipped-tripped':
      return `⏸  PROPOSE skipped — ${o.reason}`;
    case 'skipped-tier':
      return `⏭  PROPOSE skipped — ${o.reason}`;
  }
}
