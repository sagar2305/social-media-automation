/**
 * AUTO-FIX executor — applies a candidate fix safely.
 *
 * Lifecycle for every fix:
 *   1. Snapshot — read current contents of the files we're about to touch
 *   2. Apply   — caller-supplied function mutates files
 *   3. Verify  — run TS type-check (and optional canary)
 *   4. Commit  — if verify passes: leave changes in place + log success
 *      Rollback — if verify fails: restore original file contents + log failure
 *
 * The executor does NOT make a git commit on its own. Why?
 *   - Auto-committing inside the cycle pollutes the history with churn.
 *   - We already snapshot in-memory; rollback is a write, not a `git checkout`.
 *   - The human can `git diff` after a successful fix and commit on their
 *     own schedule (or the dashboard can surface the diff).
 *
 * Circuit breaker is consulted before every fix attempt — repeated failed
 * fixes for the same signature get blocked at THRESHOLD attempts in 24h.
 */

import { readFile, writeFile } from 'fs/promises';
import { logClassified, updateHandled } from './audit_logger.js';
import { recordAttempt, isTripped } from './circuit_breaker.js';
import { verify, formatResult, type VerifyResult } from './verifier.js';
import type { ClassifiedError } from './classifier.js';

// ─── Types ────────────────────────────────────────────────────

export interface FixCandidate {
  /** Files this fix will touch (snapshotted before apply). */
  files: string[];
  /** Apply the fix — should mutate the files listed above. */
  apply: () => Promise<void>;
  /** Optional canary to validate the fix worked end-to-end. */
  canary?: () => Promise<void>;
  /** Short human-readable description, written into the audit log. */
  description: string;
}

export type FixOutcome =
  | { result: 'applied'; verify: VerifyResult; description: string }
  | { result: 'rolled-back'; verify: VerifyResult; description: string; reason: string }
  | { result: 'skipped-tripped'; reason: string }
  | { result: 'skipped-tier'; reason: string };

// ─── Snapshot helpers ────────────────────────────────────────

async function snapshotFiles(paths: string[]): Promise<Map<string, string | null>> {
  const out = new Map<string, string | null>();
  for (const p of paths) {
    try {
      out.set(p, await readFile(p, 'utf-8'));
    } catch {
      out.set(p, null); // file didn't exist before
    }
  }
  return out;
}

async function restoreFiles(snap: Map<string, string | null>): Promise<void> {
  const { rm } = await import('fs/promises');
  for (const [p, original] of snap) {
    if (original == null) {
      try { await rm(p); } catch {}
    } else {
      await writeFile(p, original);
    }
  }
}

// ─── Public entry point ──────────────────────────────────────

/**
 * Run a fix against a classified error. Returns a structured outcome.
 *
 * Only applies if classified.tier === 'AUTO-FIX'. Other tiers fall through
 * with `skipped-tier` so the caller knows to take a different path
 * (PROPOSE → branch + diff, HUMAN-ONLY → just notify).
 */
export async function applyAutoFix(
  classified: ClassifiedError,
  fix: FixCandidate,
): Promise<FixOutcome> {
  // Tier gate
  if (classified.tier !== 'AUTO-FIX') {
    return {
      result: 'skipped-tier',
      reason: `tier ${classified.tier} not eligible for auto-fix`,
    };
  }

  // Circuit-breaker gate — never auto-fix the same signature too many times.
  if (await isTripped(classified.signature)) {
    return {
      result: 'skipped-tripped',
      reason: `circuit breaker TRIPPED for ${classified.signature}`,
    };
  }
  await recordAttempt(classified.signature);

  // Snapshot
  const snap = await snapshotFiles(fix.files);

  // Apply
  try {
    await fix.apply();
  } catch (err) {
    // Apply itself blew up — roll back and bail.
    await restoreFiles(snap);
    const reason = `apply() threw: ${err}`;
    await logClassified(classified, { handled: 'gave-up' });
    return {
      result: 'rolled-back',
      verify: { ok: false, errors: [reason], preExisting: [], durationMs: 0 },
      description: fix.description,
      reason,
    };
  }

  // Verify
  const verifyResult = await verify({ canary: fix.canary });
  console.log(formatResult(verifyResult));

  if (!verifyResult.ok) {
    await restoreFiles(snap);
    const reason = `verify failed — rolled back. ${verifyResult.errors[0] ?? ''}`;
    await updateHandled(classified.signature, 'gave-up');
    return {
      result: 'rolled-back',
      verify: verifyResult,
      description: fix.description,
      reason,
    };
  }

  await updateHandled(classified.signature, 'auto-fixed');
  return {
    result: 'applied',
    verify: verifyResult,
    description: fix.description,
  };
}

/** Format a FixOutcome for logs/Slack. */
export function formatOutcome(o: FixOutcome): string {
  switch (o.result) {
    case 'applied':
      return `✓ AUTO-FIX applied: ${o.description} (${o.verify.durationMs}ms verify)`;
    case 'rolled-back':
      return `✗ AUTO-FIX rolled back: ${o.description}\n  reason: ${o.reason}`;
    case 'skipped-tripped':
      return `⏸  AUTO-FIX skipped — ${o.reason}`;
    case 'skipped-tier':
      return `⏭  AUTO-FIX skipped — ${o.reason}`;
  }
}
