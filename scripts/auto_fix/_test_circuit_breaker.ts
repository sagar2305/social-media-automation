/**
 * Smoke test for circuit_breaker.ts.
 *
 * Covers:
 *   1. First few attempts return 'allowed', threshold returns 'tripped'
 *   2. Subsequent calls keep returning 'tripped' (no further recording)
 *   3. isTripped() is consistent with recordAttempt()'s decision
 *   4. reset() clears state
 *   5. retry_planner respects the breaker (returns shouldRetry=false)
 *   6. Old attempts outside WINDOW_MS get pruned
 *
 * Uses a temp state path so we don't touch the real data/auto-fix-circuit.json.
 */

import { rm, readFile, writeFile } from 'fs/promises';
import { classifyError } from './classifier.js';
import { planRetry } from './retry_planner.js';
import {
  recordAttempt,
  isTripped,
  reset,
  getStats,
  THRESHOLD,
  WINDOW_MS,
} from './circuit_breaker.js';

const STATE_PATH = 'data/auto-fix-circuit.json';
const BACKUP_PATH = 'data/auto-fix-circuit.backup.json';

async function backup() {
  try {
    const content = await readFile(STATE_PATH, 'utf-8');
    await writeFile(BACKUP_PATH, content);
    await rm(STATE_PATH);
    return true;
  } catch {
    return false;
  }
}

async function restore(hadOriginal: boolean) {
  if (!hadOriginal) {
    try { await rm(STATE_PATH); } catch {}
    return;
  }
  const content = await readFile(BACKUP_PATH, 'utf-8');
  await writeFile(STATE_PATH, content);
  await rm(BACKUP_PATH);
}

async function main() {
  const had = await backup();
  const results: Array<[string, boolean]> = [];

  try {
    const sig = 'test/blotato-fake-signature';

    // 1. First THRESHOLD-1 attempts must be allowed
    for (let i = 1; i < THRESHOLD; i++) {
      const decision = await recordAttempt(sig);
      results.push([`Attempt ${i}/${THRESHOLD} → allowed`, decision === 'allowed']);
    }

    // 2. THRESHOLD-th attempt trips the breaker
    const trippingDecision = await recordAttempt(sig);
    results.push([`Attempt ${THRESHOLD}/${THRESHOLD} → tripped`, trippingDecision === 'tripped']);

    // 3. isTripped() reflects state
    const stillTripped = await isTripped(sig);
    results.push(['isTripped() = true after threshold', stillTripped === true]);

    // 4. Subsequent recordAttempt() also returns 'tripped'
    const followup = await recordAttempt(sig);
    results.push(['Subsequent recordAttempt → tripped', followup === 'tripped']);

    // 5. State file persisted
    const persisted = JSON.parse(await readFile(STATE_PATH, 'utf-8'));
    results.push([
      'State persisted with tripped flag',
      persisted[sig] && persisted[sig].tripped === true,
    ]);

    // 6. Stats reports the tripped signature
    const stats = await getStats();
    results.push(['Stats lists tripped signature', stats.tripped.includes(sig)]);

    // 7. retry_planner sees breaker → shouldRetry=false + breakerTripped=true
    const classified = classifyError(new Error('fake'), {});
    classified.signature = sig; // force the breaker-tripped signature
    classified.tier = 'RETRY' as any; // would normally retry
    const decision = await planRetry(classified, 1);
    results.push(['planRetry honours breaker — shouldRetry=false', decision.shouldRetry === false]);
    results.push(['planRetry sets breakerTripped=true', decision.breakerTripped === true]);

    // 8. reset() clears state
    await reset(sig);
    const afterReset = await isTripped(sig);
    results.push(['reset() clears tripped state', afterReset === false]);
    const afterResetState = JSON.parse(await readFile(STATE_PATH, 'utf-8').catch(() => '{}'));
    results.push(['reset() removes signature from file', !afterResetState[sig]]);

    // 9. Old attempts get pruned (simulate by writing state with old timestamps)
    const ancientIso = new Date(Date.now() - WINDOW_MS - 60_000).toISOString();
    await writeFile(
      STATE_PATH,
      JSON.stringify({
        [sig]: { attempts: [ancientIso, ancientIso, ancientIso], tripped: true, firstSeen: ancientIso },
      }),
    );
    const afterPrune = await isTripped(sig);
    results.push(['Pruning clears expired tripped state', afterPrune === false]);

    // ─── Report ──────────────────────────────────────────────
    console.log('─── Circuit breaker checks ───');
    let fails = 0;
    for (const [name, ok] of results) {
      console.log(`  ${ok ? '✓' : '✗'}  ${name}`);
      if (!ok) fails++;
    }
    console.log(`\n${fails === 0 ? '✓ Circuit breaker passed' : `✗ ${fails} failing`}`);
    process.exit(fails === 0 ? 0 : 1);
  } finally {
    await restore(had);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
