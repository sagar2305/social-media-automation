/**
 * Circuit breaker — prevents infinite auto-fix / auto-retry loops.
 *
 * Tracks recent attempts per error signature in a sliding 24h window. Once a
 * signature reaches THRESHOLD attempts within that window, the breaker is
 * "tripped" — subsequent calls return 'tripped' and the caller is expected
 * to escalate the error to HUMAN-ONLY (skip the retry / auto-fix, just log
 * and notify).
 *
 * State lives in data/auto-fix-circuit.json — a single file flat per signature:
 *   {
 *     "blotato/internal-typeerror-status": {
 *       "attempts": ["2026-04-25T09:31:12Z", "2026-04-25T09:35:50Z", ...],
 *       "tripped": false
 *     }
 *   }
 *
 * Self-cleaning: every read drops attempts older than WINDOW_MS, and untraced
 * signatures get pruned, so the file stays tiny.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { dirname } from 'path';

const STATE_PATH = 'data/auto-fix-circuit.json';
export const THRESHOLD = 3;
export const WINDOW_MS = 24 * 60 * 60 * 1000;

// ─── Types ────────────────────────────────────────────────────

interface SignatureState {
  /** ISO timestamps of recent attempts within the rolling window. */
  attempts: string[];
  /** True once attempts.length >= THRESHOLD. Stays true until reset() or window expiry. */
  tripped: boolean;
  /** First time this signature ever fired (informational, never expires). */
  firstSeen: string;
}

type CircuitState = Record<string, SignatureState>;

// ─── State I/O ────────────────────────────────────────────────

async function loadState(): Promise<CircuitState> {
  try {
    return JSON.parse(await readFile(STATE_PATH, 'utf-8'));
  } catch {
    return {};
  }
}

async function saveState(state: CircuitState): Promise<void> {
  await mkdir(dirname(STATE_PATH), { recursive: true });
  await writeFile(STATE_PATH, JSON.stringify(state, null, 2));
}

/**
 * Drops attempts outside the WINDOW_MS sliding window. If any state had its
 * attempts fully expire, also clears its `tripped` flag — fresh slate.
 * Mutates and returns the same object for caller convenience.
 */
function pruneState(state: CircuitState): CircuitState {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [sig, s] of Object.entries(state)) {
    s.attempts = s.attempts.filter((iso) => Date.parse(iso) >= cutoff);
    if (s.attempts.length === 0) {
      // Window fully cleared → un-trip and remove the entry entirely
      delete state[sig];
    } else if (s.attempts.length < THRESHOLD) {
      // Below threshold → reset the trip if it was set
      s.tripped = false;
    }
  }
  return state;
}

// ─── Public API ───────────────────────────────────────────────

export type CircuitDecision = 'allowed' | 'tripped';

/**
 * Records an attempt for the given signature. Returns:
 *   - 'allowed'  if the caller should proceed (attempt < THRESHOLD)
 *   - 'tripped'  if the caller should skip (this attempt pushed it over, or
 *                 it was already tripped)
 *
 * IMPORTANT: this is the *only* function that increments the attempt count.
 * `isTripped()` is a passive check that does not record anything.
 */
export async function recordAttempt(signature: string): Promise<CircuitDecision> {
  const state = pruneState(await loadState());
  const nowIso = new Date().toISOString();

  const existing = state[signature];
  if (!existing) {
    state[signature] = { attempts: [nowIso], tripped: false, firstSeen: nowIso };
    await saveState(state);
    return 'allowed';
  }

  // If already tripped within the window → return tripped, do NOT add another
  // attempt (otherwise we'd infinitely grow the array).
  if (existing.tripped) {
    await saveState(state);
    return 'tripped';
  }

  existing.attempts.push(nowIso);
  if (existing.attempts.length >= THRESHOLD) {
    existing.tripped = true;
    await saveState(state);
    return 'tripped';
  }

  await saveState(state);
  return 'allowed';
}

/**
 * Passive check — does not record an attempt. Use this in the retry planner
 * before deciding whether to retry. Use `recordAttempt()` for actions that
 * really did consume a try (the actual API call, the fix application, etc.).
 */
export async function isTripped(signature: string): Promise<boolean> {
  const state = pruneState(await loadState());
  return state[signature]?.tripped ?? false;
}

/** Manually clear the breaker for a signature (e.g. after a human intervened). */
export async function reset(signature: string): Promise<void> {
  const state = await loadState();
  delete state[signature];
  await saveState(state);
}

/** Snapshot for dashboards / CLI inspection. */
export async function getStats(): Promise<{
  tripped: string[];
  attemptsBySignature: Record<string, number>;
  total: number;
}> {
  const state = pruneState(await loadState());
  const tripped: string[] = [];
  const attemptsBySignature: Record<string, number> = {};
  for (const [sig, s] of Object.entries(state)) {
    if (s.tripped) tripped.push(sig);
    attemptsBySignature[sig] = s.attempts.length;
  }
  return {
    tripped,
    attemptsBySignature,
    total: Object.keys(state).length,
  };
}
