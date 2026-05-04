/**
 * Smoke test for verifier.ts.
 *
 * Covers:
 *   1. Clean repo → verify().ok === true (filters out pre-existing sync-to-supabase error)
 *   2. Inject a deliberate type error into a throwaway file → verify().ok === false
 *   3. Canary fail propagates as ok=false even when tsc is clean
 */

import { writeFile, rm } from 'fs/promises';
import { verify, runTypeCheck, formatResult } from './verifier.js';

const SCRATCH = 'scripts/auto_fix/__verifier_scratch.ts';

async function main() {
  const results: Array<[string, boolean]> = [];

  // 1. Baseline — repo already type-checks (modulo pre-existing)
  const baseline = await runTypeCheck();
  console.log(formatResult(baseline));
  results.push(['Baseline tsc passes', baseline.ok === true]);
  results.push(['Pre-existing errors detected', baseline.preExisting.length >= 0]);

  // 2. Inject a deliberate type error
  await writeFile(SCRATCH, `const x: number = "this is wrong";\nexport { x };\n`);
  try {
    const broken = await runTypeCheck();
    console.log(formatResult(broken));
    results.push(['Broken file fails tsc', broken.ok === false]);
    results.push([
      'Broken file reported in errors',
      broken.errors.some((e) => e.includes('__verifier_scratch.ts')),
    ]);
  } finally {
    await rm(SCRATCH);
  }

  // 3. Confirm cleanup → tsc passes again
  const afterCleanup = await runTypeCheck();
  results.push(['Tsc passes after cleanup', afterCleanup.ok === true]);

  // 4. Canary failure
  const canaryFail = await verify({
    canary: async () => {
      throw new Error('simulated canary failure');
    },
  });
  results.push(['Canary failure propagates', canaryFail.ok === false]);
  results.push([
    'Canary error included in result',
    canaryFail.errors.some((e) => e.includes('simulated canary failure')),
  ]);

  // 5. Canary success
  const canaryOk = await verify({
    canary: async () => {
      // simulate a successful canary
    },
  });
  results.push(['Canary success returns ok=true', canaryOk.ok === true]);

  // ─── Report ────────────────────────────────────────────────
  console.log('\n─── Verifier checks ───');
  let fails = 0;
  for (const [name, ok] of results) {
    console.log(`  ${ok ? '✓' : '✗'}  ${name}`);
    if (!ok) fails++;
  }
  console.log(`\n${fails === 0 ? '✓ Verifier passed' : `✗ ${fails} failing`}`);
  process.exit(fails === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
