/**
 * Smoke test for audit_logger — exercises full lifecycle: write → update → stats.
 * Uses a throwaway log path so we don't pollute the real data/auto-fix-log.md.
 *
 * Run: npx tsx scripts/auto_fix/_test_logger.ts
 */

import { rm, mkdir, readFile, writeFile } from 'fs/promises';
import { classifyError } from './classifier.js';

// Redirect the logger to a temp file by monkey-patching the module's internal path.
// Easiest way: import the module fresh with a small wrapper that proxies writes.
// (Simpler: just run against the real path then restore afterwards.)

const REAL_PATH = 'data/auto-fix-log.md';
const BACKUP_PATH = 'data/auto-fix-log.backup.md';

async function preserveExistingLog() {
  try {
    const content = await readFile(REAL_PATH, 'utf-8');
    await writeFile(BACKUP_PATH, content);
    await rm(REAL_PATH);
    return true;
  } catch {
    return false;
  }
}

async function restoreLog(hadOriginal: boolean) {
  if (!hadOriginal) {
    try { await rm(REAL_PATH); } catch {}
    return;
  }
  const content = await readFile(BACKUP_PATH, 'utf-8');
  await writeFile(REAL_PATH, content);
  await rm(BACKUP_PATH);
}

async function main() {
  await mkdir('data', { recursive: true });
  const hadOriginal = await preserveExistingLog();

  // Dynamic import AFTER backup so the module sees a missing file on first call
  const { logClassified, updateHandled, getLogStats } = await import('./audit_logger.js');

  try {
    // 1. Log a few classified errors
    const c1 = classifyError(new Error('tmpfiles upload failed: 502'));
    await logClassified(c1);

    const c2 = classifyError(new Error('TypeError: fetch failed'), {
      url: 'https://generativelanguage.googleapis.com/foo',
    });
    await logClassified(c2);

    const c3 = classifyError(
      new Error(
        'Gemini API 429: { "error": { "message": "Your project has exceeded its monthly spending cap." } }',
      ),
      { source: 'gemini', status: 429 },
    );
    await logClassified(c3);

    // 2. Read the file and verify structure
    const content = await readFile(REAL_PATH, 'utf-8');
    const dataRows = content.split('\n').filter((l) => l.startsWith('| 20'));
    const hasHeader = content.startsWith('# Auto-Fix Audit Log');
    const hasSeparator = content.includes('|---');
    // Newest-first check: the last write (c3, spending cap) should be row 0
    const firstRow = dataRows[0] || '';
    const hasSpendingCapFirst = firstRow.includes('gemini/monthly-spending-cap');

    console.log('─── File structure ───');
    console.log(`  Header present:     ${hasHeader ? '✓' : '✗'}`);
    console.log(`  Table separator:    ${hasSeparator ? '✓' : '✗'}`);
    console.log(`  3 data rows:        ${dataRows.length === 3 ? '✓' : `✗ (got ${dataRows.length})`}`);
    console.log(`  Newest on top:      ${hasSpendingCapFirst ? '✓' : '✗'}`);

    // 3. updateHandled flips the most-recent pending row
    await updateHandled('gemini/monthly-spending-cap', 'escalated');
    const updated = await readFile(REAL_PATH, 'utf-8');
    const updatedRow = updated.split('\n').find((l) => l.includes('monthly-spending-cap')) ?? '';
    const handledUpdated = /\|\s*escalated\s*\|$/.test(updatedRow);
    console.log(`  Handled updated:    ${handledUpdated ? '✓' : '✗'}`);

    // 4. Stats
    const stats = await getLogStats();
    console.log('\n─── Stats ───');
    console.log(`  Total rows:         ${stats.total}`);
    console.log(`  Unique signatures:  ${Object.keys(stats.bySignature).length}`);
    console.log(`  Last 24h rows:      ${Object.values(stats.last24hBySignature).reduce((a, b) => a + b, 0)}`);

    const allPassed =
      hasHeader && hasSeparator && dataRows.length === 3 && hasSpendingCapFirst && handledUpdated;

    console.log(`\n${allPassed ? '✓ All checks passed' : '✗ Some checks failed'}`);

    console.log('\n─── Sample log file ───');
    console.log(updated);

    process.exit(allPassed ? 0 : 1);
  } finally {
    await restoreLog(hadOriginal);
  }
}

main().catch((err) => {
  console.error('FATAL:', err);
  process.exit(1);
});
