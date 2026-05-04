/**
 * End-to-end smoke: deliberately triggers an API failure through api-client
 * and verifies the full auto-fix pipeline fired:
 *   1. Request fails
 *   2. Error was classified
 *   3. A row was prepended to data/auto-fix-log.md
 *   4. (If eligible tier) an alert was written to data/auto-fix-alerts.md
 *
 * Uses a known-404 Blotato path, so no real resources are touched.
 * Preserves any existing log/alert files and restores them at the end.
 *
 * Run: npx tsx scripts/auto_fix/_e2e_test.ts
 */

import { readFile, writeFile, rm } from 'fs/promises';
import { apiRequest } from '../api-client.js';

const LOG_PATH = 'data/auto-fix-log.md';
const ALERTS_PATH = 'data/auto-fix-alerts.md';
const DEDUP_PATH = 'data/auto-fix-alerts.state.json';

async function snapshot(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf-8');
  } catch {
    return null;
  }
}

async function restore(path: string, original: string | null): Promise<void> {
  if (original == null) {
    try { await rm(path); } catch {}
    return;
  }
  await writeFile(path, original);
}

async function main() {
  const logBefore = await snapshot(LOG_PATH);
  const alertsBefore = await snapshot(ALERTS_PATH);
  const dedupBefore = await snapshot(DEDUP_PATH);

  // Clear dedup so we don't get skipped
  try { await rm(DEDUP_PATH); } catch {}

  let threw = false;
  try {
    // This endpoint doesn't exist → Blotato returns 404 → apiRequest throws
    // after its internal 3 retries (triggers our new audit path).
    await apiRequest('blotato', '/nonexistent-test-endpoint-xyz');
  } catch {
    threw = true;
  }

  const logAfter = await snapshot(LOG_PATH);
  const alertsAfter = await snapshot(ALERTS_PATH);

  const results = {
    threw,
    logGrew: (logAfter?.length ?? 0) > (logBefore?.length ?? 0),
    logHasBlotatoRow: (logAfter ?? '').includes('| blotato |'),
    logHasUnknownTier: (logAfter ?? '').includes('| UNKNOWN |'),
    alertsGrew: (alertsAfter?.length ?? 0) > (alertsBefore?.length ?? 0),
  };

  console.log('─── Results ───');
  for (const [k, v] of Object.entries(results)) {
    console.log(`  ${v ? '✓' : '✗'}  ${k}`);
  }

  // Restore original state
  await restore(LOG_PATH, logBefore);
  await restore(ALERTS_PATH, alertsBefore);
  await restore(DEDUP_PATH, dedupBefore);

  const passed =
    results.threw &&
    results.logGrew &&
    results.logHasBlotatoRow &&
    results.logHasUnknownTier &&
    results.alertsGrew; // UNKNOWN tier fires an alert

  console.log(`\n${passed ? '✓ Day 1 e2e passed' : '✗ Day 1 e2e FAILED'}`);
  process.exit(passed ? 0 : 1);
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
