/**
 * Retry planner — converts a classified error + current attempt number into a
 * retry decision. Makes the api-client's retry loop catalog-aware instead of
 * blindly applying exponential backoff.
 *
 * Behaviour by tier:
 *   RETRY       → honour the catalog's retry params (maxAttempts, backoffMs).
 *   HUMAN-ONLY  → do NOT retry. Retrying a spending-cap or 3-account-cap
 *                 error just wastes credits.
 *   AUTO-FIX    → do NOT retry in-band. Auto-fix is a code change, not a
 *                 request retry. The caller's job is over; Day 3+ handles it.
 *   ASK         → same as AUTO-FIX — stop; wait for human decision.
 *   UNKNOWN     → fall back to the api-client's default (3 attempts, expo
 *                 backoff) so we don't regress on un-catalogued errors.
 */

import type { ClassifiedError } from './classifier.js';
import { isTripped } from './circuit_breaker.js';

export interface RetryDecision {
  shouldRetry: boolean;
  /** Milliseconds to wait before the next attempt. */
  waitMs: number;
  /** Cap on attempts for this error. -1 means "defer to caller's default". */
  maxAttempts: number;
  /** Human-readable reason, echoed into logs. */
  reason: string;
  /** True when the circuit breaker forced HUMAN-ONLY behaviour. */
  breakerTripped?: boolean;
}

const DEFAULT_DECISION: RetryDecision = {
  shouldRetry: true,
  waitMs: 0,
  maxAttempts: -1,
  reason: 'default',
};

export async function planRetry(
  c: ClassifiedError,
  attemptNumber: number,
): Promise<RetryDecision> {
  // Circuit breaker first — once a signature has tripped, we treat any tier
  // (even RETRY / AUTO-FIX) as HUMAN-ONLY: stop, log, escalate. This prevents
  // infinite loops when our fix is wrong or the upstream is genuinely broken.
  const tripped = await isTripped(c.signature);
  if (tripped) {
    return {
      shouldRetry: false,
      waitMs: 0,
      maxAttempts: 1,
      reason: `Circuit breaker TRIPPED for ${c.signature} — escalated to HUMAN-ONLY`,
      breakerTripped: true,
    };
  }

  // Unknown errors → use caller's default behaviour (expo backoff, 3 tries).
  if (!c.entry) {
    return {
      ...DEFAULT_DECISION,
      reason: 'unknown error — using api-client default backoff',
    };
  }

  switch (c.tier) {
    case 'HUMAN-ONLY':
      return {
        shouldRetry: false,
        waitMs: 0,
        maxAttempts: 1,
        reason: `HUMAN-ONLY — ${c.entry.action}`,
      };

    case 'ASK':
    case 'AUTO-FIX':
    case 'PROPOSE':
      // Code-change tiers — request retries won't help. Fall through to caller.
      return {
        shouldRetry: false,
        waitMs: 0,
        maxAttempts: 1,
        reason: `${c.tier} — needs code change, not a retry`,
      };

    case 'RETRY': {
      const retry = c.entry.retry ?? { maxAttempts: 3, backoffMs: 1000 };
      if (attemptNumber >= retry.maxAttempts) {
        return {
          shouldRetry: false,
          waitMs: 0,
          maxAttempts: retry.maxAttempts,
          reason: `RETRY exhausted (${attemptNumber}/${retry.maxAttempts})`,
        };
      }
      return {
        shouldRetry: true,
        waitMs: retry.backoffMs,
        maxAttempts: retry.maxAttempts,
        reason: `RETRY attempt ${attemptNumber + 1}/${retry.maxAttempts} in ${retry.backoffMs}ms`,
      };
    }

    default:
      return { ...DEFAULT_DECISION, reason: `unrecognised tier: ${c.tier}` };
  }
}
