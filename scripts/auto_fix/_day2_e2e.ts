/**
 * Day 2 end-to-end: verifies the retry planner clamps retries based on catalog,
 * the logger annotates stale-doc UNKNOWN errors, and the docs_refresh CLI's
 * underlying functions behave. No live API calls.
 *
 * Run: npx tsx scripts/auto_fix/_day2_e2e.ts
 */

import { readFile, writeFile, rm, utimes } from 'fs/promises';
import { classifyError } from './classifier.js';
import { planRetry } from './retry_planner.js';
import { logClassified } from './audit_logger.js';
import { isStale, markFresh, docPathFor, lastRefreshed } from './docs_freshness.js';

const LOG_PATH = 'data/auto-fix-log.md';
const FRESHNESS_PATH = 'data/docs-freshness.json';

async function snapshot(p: string): Promise<string | null> {
  try { return await readFile(p, 'utf-8'); } catch { return null; }
}
async function restore(p: string, orig: string | null): Promise<void> {
  if (orig == null) { try { await rm(p); } catch {} return; }
  await writeFile(p, orig);
}

async function main() {
  const logOrig = await snapshot(LOG_PATH);
  const freshOrig = await snapshot(FRESHNESS_PATH);

  try {
    const results: Array<[string, boolean]> = [];

    // ─── 1. HUMAN-ONLY error → planner says don't retry ─────
    const spendingCap = classifyError(
      new Error(
        'Gemini API 429: { "error": { "message": "Your project has exceeded its monthly spending cap." } }',
      ),
      { source: 'gemini', status: 429 },
    );
    const plan1 = await planRetry(spendingCap, 1);
    results.push(['HUMAN-ONLY: shouldRetry=false', plan1.shouldRetry === false]);
    results.push(['HUMAN-ONLY: maxAttempts=1', plan1.maxAttempts === 1]);

    // ─── 2. RETRY tier → planner honours catalog backoff ────
    const blotatoTypeError = classifyError(
      new Error("Internal error: TypeError: Cannot read properties of undefined (reading 'status')"),
      { source: 'blotato' },
    );
    const plan2 = await planRetry(blotatoTypeError, 1);
    results.push(['RETRY: shouldRetry=true', plan2.shouldRetry === true]);
    results.push(['RETRY: backoff=60000ms', plan2.waitMs === 60_000]);
    results.push(['RETRY: maxAttempts=3', plan2.maxAttempts === 3]);

    // ─── 3. Exhausted RETRY → shouldn't retry further ────────
    const plan2b = await planRetry(blotatoTypeError, 3);
    results.push(['RETRY exhausted: shouldRetry=false', plan2b.shouldRetry === false]);

    // ─── 4. UNKNOWN tier → falls back to default (-1) ───────
    const unknown = classifyError(new Error('Some brand new error nobody has seen'), {});
    const plan3 = await planRetry(unknown, 1);
    results.push(['UNKNOWN: defaults to caller', plan3.maxAttempts === -1]);

    // ─── 5. docs freshness: mark + read back ─────────────────
    await markFresh('blotato');
    const last = await lastRefreshed('blotato');
    results.push([
      'markFresh then lastRefreshed within 5s',
      last != null && Date.now() - last.getTime() < 5000,
    ]);
    results.push(['blotato not stale after mark', (await isStale('blotato')) === false]);

    // ─── 6. Simulate stale doc → UNKNOWN error → log annotation ──
    // Force gemini docs to look stale by deleting any existing fresh-stamp and
    // setting the file mtime to 30 days ago.
    const state = JSON.parse((await snapshot(FRESHNESS_PATH)) || '{}');
    delete state.gemini;
    await writeFile(FRESHNESS_PATH, JSON.stringify(state, null, 2));
    const geminiDocPath = docPathFor('gemini')!;
    const oldTime = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    await utimes(geminiDocPath, oldTime, oldTime);
    results.push(['gemini docs now stale', await isStale('gemini')]);

    const unknownGemini = classifyError(new Error('Some totally new Gemini error'), {
      source: 'gemini',
    });
    // Log it and inspect the row
    const logBefore = (await snapshot(LOG_PATH)) || '';
    await logClassified(unknownGemini);
    const logAfter = (await snapshot(LOG_PATH)) || '';
    const newRow = logAfter.split('\n').find(
      (l) => l.startsWith('| 20') && !logBefore.includes(l),
    ) ?? '';
    results.push(['Stale-docs hint injected', newRow.includes('docs stale')]);

    // ─── Report ─────────────────────────────────────────────
    console.log('─── Day 2 checks ───');
    let fails = 0;
    for (const [name, ok] of results) {
      console.log(`  ${ok ? '✓' : '✗'}  ${name}`);
      if (!ok) fails++;
    }
    console.log(`\n${fails === 0 ? '✓ Day 2 e2e passed' : `✗ ${fails} failing`}`);
    process.exit(fails === 0 ? 0 : 1);
  } finally {
    await restore(LOG_PATH, logOrig);
    await restore(FRESHNESS_PATH, freshOrig);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
