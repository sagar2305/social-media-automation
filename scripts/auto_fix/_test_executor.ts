/**
 * Smoke test for auto_fix_executor.ts.
 *
 * Covers:
 *   1. Wrong tier → skipped-tier (no files touched)
 *   2. Tier=AUTO-FIX + clean fix + verify passes → applied (files mutated)
 *   3. Tier=AUTO-FIX + fix that breaks tsc → rolled-back (files restored)
 *   4. Circuit breaker tripped → skipped-tripped
 */

import { writeFile, readFile, rm } from 'fs/promises';
import { applyAutoFix, formatOutcome } from './auto_fix_executor.js';
import { classifyError } from './classifier.js';
import { reset, recordAttempt, THRESHOLD } from './circuit_breaker.js';

const SCRATCH = 'scripts/auto_fix/__executor_scratch.ts';
const ORIGINAL_CONTENT = 'export const VALUE = 42;\n';

async function main() {
  const results: Array<[string, boolean]> = [];

  await writeFile(SCRATCH, ORIGINAL_CONTENT);

  try {
    // ─── 1. Wrong tier ────────────────────────────────────
    const c1 = classifyError(new Error('Media conversion failed'), { source: 'blotato' });
    // c1 is RETRY tier — not eligible
    const o1 = await applyAutoFix(c1, {
      files: [SCRATCH],
      apply: async () => {
        await writeFile(SCRATCH, '// MUTATED\n');
      },
      description: 'should not apply',
    });
    const fileContentAfter1 = await readFile(SCRATCH, 'utf-8');
    results.push(['Wrong tier → skipped', o1.result === 'skipped-tier']);
    results.push(['Files untouched on tier skip', fileContentAfter1 === ORIGINAL_CONTENT]);

    // ─── 2. Successful apply + verify ─────────────────────
    const c2 = classifyError(new Error('tmpfiles upload failed: 502'));
    // c2 is AUTO-FIX tier
    await reset(c2.signature); // clear breaker for clean test
    const o2 = await applyAutoFix(c2, {
      files: [SCRATCH],
      apply: async () => {
        await writeFile(SCRATCH, 'export const VALUE = 99;\n');
      },
      description: 'change VALUE to 99',
    });
    console.log(formatOutcome(o2));
    const fileContentAfter2 = await readFile(SCRATCH, 'utf-8');
    results.push(['Clean fix → applied', o2.result === 'applied']);
    results.push(['File mutated after applied', fileContentAfter2 === 'export const VALUE = 99;\n']);

    // ─── 3. Fix that breaks tsc → rollback ────────────────
    const c3 = classifyError(new Error('catbox returned non-URL'));
    await reset(c3.signature);
    const o3 = await applyAutoFix(c3, {
      files: [SCRATCH],
      apply: async () => {
        // Inject a deliberate type error
        await writeFile(SCRATCH, 'export const VALUE: number = "broken";\n');
      },
      description: 'broken fix that fails tsc',
    });
    console.log(formatOutcome(o3));
    const fileContentAfter3 = await readFile(SCRATCH, 'utf-8');
    results.push(['Broken fix → rolled-back', o3.result === 'rolled-back']);
    results.push([
      'File restored after rollback',
      fileContentAfter3 === 'export const VALUE = 99;\n', // restored to pre-apply state (not original — apply 2 changed it)
    ]);

    // ─── 4. Circuit breaker tripped ───────────────────────
    const c4 = classifyError(new Error('tmpfiles upload failed: 504'));
    await reset(c4.signature);
    // Force breaker to trip by recording THRESHOLD attempts
    for (let i = 0; i < THRESHOLD; i++) {
      await recordAttempt(c4.signature);
    }
    const o4 = await applyAutoFix(c4, {
      files: [SCRATCH],
      apply: async () => {
        await writeFile(SCRATCH, '// SHOULD NOT WRITE\n');
      },
      description: 'should be blocked by breaker',
    });
    const fileContentAfter4 = await readFile(SCRATCH, 'utf-8');
    results.push(['Tripped breaker → skipped-tripped', o4.result === 'skipped-tripped']);
    results.push([
      'Files untouched when breaker tripped',
      fileContentAfter4 === 'export const VALUE = 99;\n',
    ]);

    await reset(c4.signature);

    // ─── Report ───────────────────────────────────────────
    console.log('\n─── Auto-fix executor checks ───');
    let fails = 0;
    for (const [name, ok] of results) {
      console.log(`  ${ok ? '✓' : '✗'}  ${name}`);
      if (!ok) fails++;
    }
    console.log(`\n${fails === 0 ? '✓ Executor passed' : `✗ ${fails} failing`}`);
    process.exit(fails === 0 ? 0 : 1);
  } finally {
    await rm(SCRATCH).catch(() => {});
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
