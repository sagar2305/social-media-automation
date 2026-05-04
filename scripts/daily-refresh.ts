/**
 * Daily Refresh — Automated daily update of all data files.
 *
 * Updates: ACCOUNT-STATS.md, POST-TRACKER.md, FORMAT-WINNERS.md,
 *          LESSONS-LEARNED.md, EXPERIMENT-LOG.md, TRENDING-NOW.md, HASHTAG-BANK.md
 *
 * Usage:
 *   npm run refresh              → full refresh (analytics + optimize + research)
 *   npm run refresh -- --skip-research   → skip Virlo (saves credits)
 *
 * Designed to run daily via:
 *   /loop 24h npm run refresh
 *   or cron: 0 8 * * * cd /Users/aditya/social-media-automation && npm run refresh
 */

import { measurePerformance } from './pull_analytics.js';
import { optimize } from './optimizer.js';
import { runResearch } from './fetch_trends.js';
import { log } from './api-client.js';
import { syncToSupabase } from './sync-to-supabase.js';
import { readFile, writeFile } from 'fs/promises';
import { join } from 'path';
import { config } from '../config/config.js';

interface RefreshResult {
  phase: string;
  status: 'success' | 'skipped' | 'failed';
  detail: string;
  durationMs: number;
}

async function timedPhase(
  name: string,
  fn: () => Promise<string>,
): Promise<RefreshResult> {
  const start = Date.now();
  try {
    const detail = await fn();
    return { phase: name, status: 'success', detail, durationMs: Date.now() - start };
  } catch (err) {
    return { phase: name, status: 'failed', detail: `${err}`, durationMs: Date.now() - start };
  }
}

async function appendRefreshLog(results: RefreshResult[]): Promise<void> {
  const logPath = join(config.paths.memory, 'REFRESH-LOG.md');

  let existing = '';
  try {
    existing = await readFile(logPath, 'utf-8');
  } catch {
    existing = `# Daily Refresh Log\n\n_Automated daily data updates. Most recent first._\n\n| Date | Analytics | Optimizer | Research | Duration |\n|------|-----------|-----------|----------|----------|\n`;
  }

  const date = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const totalMs = results.reduce((s, r) => s + r.durationMs, 0);
  const totalSec = Math.round(totalMs / 1000);

  const statusEmoji = (r: RefreshResult) =>
    r.status === 'success' ? 'OK' : r.status === 'skipped' ? 'SKIP' : 'FAIL';

  const analyticsResult = results.find((r) => r.phase === 'Analytics');
  const optimizerResult = results.find((r) => r.phase === 'Optimizer');
  const researchResult = results.find((r) => r.phase === 'Research');

  const row = `| ${date} | ${statusEmoji(analyticsResult!)} | ${statusEmoji(optimizerResult!)} | ${statusEmoji(researchResult!)} | ${totalSec}s |`;

  // Insert after header row
  const headerEnd = existing.indexOf('\n', existing.lastIndexOf('|---'));
  if (headerEnd > 0) {
    existing = existing.slice(0, headerEnd + 1) + row + '\n' + existing.slice(headerEnd + 1);
  } else {
    existing += row + '\n';
  }

  // Keep only last 30 entries to avoid bloat
  const lines = existing.split('\n');
  const dataLines = lines.filter((l) => l.startsWith('| 20'));
  if (dataLines.length > 30) {
    const cutoff = dataLines[30];
    const cutIndex = existing.lastIndexOf(cutoff);
    existing = existing.slice(0, cutIndex);
  }

  await writeFile(logPath, existing);
}

async function dailyRefresh(): Promise<void> {
  const skipResearch = process.argv.includes('--skip-research');
  const startTime = Date.now();

  log('╔══════════════════════════════════════════════════╗');
  log('║           DAILY REFRESH — Starting              ║');
  log(`║  ${new Date().toISOString().slice(0, 19)}                   ║`);
  log(`║  Research: ${skipResearch ? 'SKIPPED' : 'ENABLED'}                          ║`);
  log('╚══════════════════════════════════════════════════╝');

  const results: RefreshResult[] = [];

  // Phase 1: Analytics (ACCOUNT-STATS.md + POST-TRACKER.md)
  log('\n── Phase 1/3: Analytics ──');
  results.push(
    await timedPhase('Analytics', async () => {
      const metrics = await measurePerformance();
      return `${metrics.length} posts tracked`;
    }),
  );

  // Phase 2: Optimizer (FORMAT-WINNERS.md + LESSONS-LEARNED.md + EXPERIMENT-LOG.md)
  log('\n── Phase 2/3: Optimizer ──');
  results.push(
    await timedPhase('Optimizer', async () => {
      await optimize();
      return 'Experiments evaluated, dashboards updated';
    }),
  );

  // Phase 3: Research (TRENDING-NOW.md + HASHTAG-BANK.md)
  log('\n── Phase 3/3: Research ──');
  if (skipResearch) {
    results.push({
      phase: 'Research',
      status: 'skipped',
      detail: '--skip-research flag',
      durationMs: 0,
    });
    log('Skipped (--skip-research)');
  } else {
    results.push(
      await timedPhase('Research', async () => {
        await runResearch();
        return 'Trends + hashtags updated';
      }),
    );
  }

  // Phase 4: Sync to Supabase (dashboard)
  log('\n── Phase 4: Supabase Sync ──');
  results.push(
    await timedPhase('Sync', async () => {
      await syncToSupabase();
      return 'Dashboard data synced';
    }),
  );

  // Write refresh log
  await appendRefreshLog(results);

  // Summary
  const totalSec = Math.round((Date.now() - startTime) / 1000);
  log('\n╔══════════════════════════════════════════════════╗');
  log('║           DAILY REFRESH — Complete               ║');
  log('╠══════════════════════════════════════════════════╣');
  for (const r of results) {
    const icon = r.status === 'success' ? 'OK' : r.status === 'skipped' ? 'SKIP' : 'FAIL';
    log(`║  ${r.phase.padEnd(12)} ${icon.padEnd(6)} ${r.detail.slice(0, 30).padEnd(30)} ${Math.round(r.durationMs / 1000)}s`);
  }
  log(`║  Total: ${totalSec}s`);
  log('╚══════════════════════════════════════════════════╝');

  // Exit with error code if any phase failed critically
  const failures = results.filter((r) => r.status === 'failed');
  if (failures.length === results.length) {
    log('ALL PHASES FAILED — check API keys and connectivity');
    process.exit(1);
  }
}

// Entry point
dailyRefresh().catch((err) => {
  log(`DAILY REFRESH CRASHED: ${err}`);
  process.exit(1);
});
