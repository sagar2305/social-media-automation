/**
 * Smoke test for propose_executor.ts + proposals.ts + the CLI lifecycle.
 *
 * Covers:
 *   1. Wrong tier            → skipped-tier (no proposal created)
 *   2. Verify failure        → rolled-back (working tree restored)
 *   3. Successful proposal   → working tree restored + shadow + diff written
 *   4. Approve               → shadow files copied over working tree
 *   5. Reject                → status flips, working tree untouched
 *   6. Circuit breaker trip  → skipped-tripped
 */

import { writeFile, readFile, rm, stat } from 'fs/promises';
import { applyPropose, formatProposeOutcome } from './propose_executor.js';
import { classifyError } from './classifier.js';
import { reset, recordAttempt, THRESHOLD } from './circuit_breaker.js';
import {
  listAll,
  readMetadata,
  shadowApply,
  transition,
  purge,
} from './proposals.js';
import {
  ERROR_CATALOG,
  type CatalogEntry,
} from './error_catalog.js';

const SCRATCH = 'scripts/auto_fix/__propose_scratch.ts';
const ORIGINAL = 'export const N = 1;\n';
const MUTATED = 'export const N = 2;\n';

// We need a PROPOSE-tier signature to drive the executor. The catalog doesn't
// currently have any PROPOSE entries (everything's RETRY/HUMAN-ONLY/AUTO-FIX),
// so we monkey-patch a synthetic entry just for this test.
function withSyntheticProposeEntry<T>(fn: () => Promise<T>): Promise<T> {
  const synthetic: CatalogEntry = {
    id: 'test/synthetic-propose',
    source: 'unknown',
    match: /SYNTHETIC_PROPOSE_MARKER/,
    tier: 'PROPOSE',
    action: 'synthetic test entry',
  };
  ERROR_CATALOG.unshift(synthetic);
  return fn().finally(() => {
    ERROR_CATALOG.shift();
  });
}

async function fileExists(p: string): Promise<boolean> {
  try { await stat(p); return true; } catch { return false; }
}

async function main() {
  const results: Array<[string, boolean]> = [];

  await writeFile(SCRATCH, ORIGINAL);
  const createdIds: string[] = [];

  try {
    await withSyntheticProposeEntry(async () => {
      // ─── 1. Wrong tier ────────────────────────────────────
      const wrongTier = classifyError(new Error('Media conversion failed'), { source: 'blotato' });
      const o1 = await applyPropose(wrongTier, {
        files: [SCRATCH],
        apply: async () => writeFile(SCRATCH, '// SHOULD NOT'),
        description: 'should not run',
      });
      const fc1 = await readFile(SCRATCH, 'utf-8');
      results.push(['Wrong tier → skipped', o1.result === 'skipped-tier']);
      results.push(['Wrong tier — files untouched', fc1 === ORIGINAL]);

      // ─── 2. Verify failure ────────────────────────────────
      const c2 = classifyError(new Error('SYNTHETIC_PROPOSE_MARKER alpha'), {});
      await reset(c2.signature);
      const o2 = await applyPropose(c2, {
        files: [SCRATCH],
        apply: async () => writeFile(SCRATCH, 'const x: number = "broken";\n'),
        description: 'broken propose',
      });
      console.log(formatProposeOutcome(o2));
      const fc2 = await readFile(SCRATCH, 'utf-8');
      results.push(['Verify fail → rolled-back', o2.result === 'rolled-back']);
      results.push(['Verify fail — file restored', fc2 === ORIGINAL]);

      // ─── 3. Successful proposal ──────────────────────────
      const c3 = classifyError(new Error('SYNTHETIC_PROPOSE_MARKER beta'), {});
      await reset(c3.signature);
      const o3 = await applyPropose(c3, {
        files: [SCRATCH],
        apply: async () => writeFile(SCRATCH, MUTATED),
        description: 'change N from 1 to 2',
      });
      console.log(formatProposeOutcome(o3));
      const fc3 = await readFile(SCRATCH, 'utf-8');
      results.push(['Successful → proposed', o3.result === 'proposed']);
      results.push(['Successful — working tree restored', fc3 === ORIGINAL]);
      const id3 = o3.result === 'proposed' ? o3.id : '';
      if (id3) createdIds.push(id3);
      const meta3 = id3 ? await readMetadata(id3) : null;
      results.push(['Metadata persisted', meta3?.status === 'pending']);

      // ─── 4. Approve flow ─────────────────────────────────
      if (id3) {
        const { restored } = await shadowApply(id3);
        await transition(id3, 'applied');
        const fc4 = await readFile(SCRATCH, 'utf-8');
        results.push(['Approve → file mutated to MUTATED', fc4 === MUTATED]);
        results.push(['Approve restored 1 file', restored === 1]);
        const after = await readMetadata(id3);
        results.push(['Approve sets status=applied', after?.status === 'applied']);
        // Reset working tree for next test
        await writeFile(SCRATCH, ORIGINAL);
      }

      // ─── 5. Reject flow ──────────────────────────────────
      const c5 = classifyError(new Error('SYNTHETIC_PROPOSE_MARKER gamma'), {});
      await reset(c5.signature);
      const o5 = await applyPropose(c5, {
        files: [SCRATCH],
        apply: async () => writeFile(SCRATCH, 'export const N = 99;\n'),
        description: 'change to 99',
      });
      const id5 = o5.result === 'proposed' ? o5.id : '';
      if (id5) createdIds.push(id5);
      await transition(id5, 'rejected');
      const fc5 = await readFile(SCRATCH, 'utf-8');
      results.push(['Reject — file untouched', fc5 === ORIGINAL]);
      const meta5 = await readMetadata(id5);
      results.push(['Reject sets status=rejected', meta5?.status === 'rejected']);

      // ─── 6. Circuit breaker trip ─────────────────────────
      const c6 = classifyError(new Error('SYNTHETIC_PROPOSE_MARKER delta'), {});
      await reset(c6.signature);
      for (let i = 0; i < THRESHOLD; i++) await recordAttempt(c6.signature);
      const o6 = await applyPropose(c6, {
        files: [SCRATCH],
        apply: async () => writeFile(SCRATCH, '// blocked'),
        description: 'should be blocked',
      });
      const fc6 = await readFile(SCRATCH, 'utf-8');
      results.push(['Tripped → skipped-tripped', o6.result === 'skipped-tripped']);
      results.push(['Tripped — files untouched', fc6 === ORIGINAL]);
      await reset(c6.signature);

      // ─── listAll sanity ──────────────────────────────────
      const all = await listAll();
      results.push(['listAll returns proposals', all.length >= createdIds.length]);
    });

    // ─── Report ─────────────────────────────────────────────
    console.log('\n─── Propose executor checks ───');
    let fails = 0;
    for (const [name, ok] of results) {
      console.log(`  ${ok ? '✓' : '✗'}  ${name}`);
      if (!ok) fails++;
    }
    console.log(`\n${fails === 0 ? '✓ Propose passed' : `✗ ${fails} failing`}`);
    process.exit(fails === 0 ? 0 : 1);
  } finally {
    // Clean up: scratch file + any test proposals we created
    await rm(SCRATCH).catch(() => {});
    for (const id of createdIds) await purge(id).catch(() => {});
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
