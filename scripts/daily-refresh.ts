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
import { readFile, writeFile, mkdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { dataPath, setCampaignSlug } from './lib/campaign-paths.js';
import { listActiveCampaigns, resetCampaignCache } from './lib/campaigns.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

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
  // REFRESH-LOG is pipeline-level (data/REFRESH-LOG.md) — same path
  // regardless of which campaigns ran in this pass.
  const logPath = dataPath('REFRESH-LOG.md');

  let existing = '';
  try {
    existing = await readFile(logPath, 'utf-8');
  } catch {
    existing = `# Daily Refresh Log\n\n_Automated daily data updates. Most recent first._\n\n| Date | Campaigns | Analytics | Optimizer | Research | Duration |\n|------|-----------|-----------|-----------|----------|----------|\n`;
  }

  const date = new Date().toISOString().slice(0, 16).replace('T', ' ');
  const totalMs = results.reduce((s, r) => s + r.durationMs, 0);
  const totalSec = Math.round(totalMs / 1000);

  // Tally per-phase status across all campaigns. Phase name format is
  // 'Analytics:<slug>' / 'Optimizer:<slug>' / 'Research:<slug>'.
  const tally = (prefix: string): string => {
    const matched = results.filter((r) => r.phase.startsWith(`${prefix}:`));
    if (matched.length === 0) return '—';
    const ok = matched.filter((r) => r.status === 'success').length;
    const skip = matched.filter((r) => r.status === 'skipped').length;
    const fail = matched.filter((r) => r.status === 'failed').length;
    if (fail === 0 && skip === 0) return `${ok}/${matched.length} OK`;
    if (ok === matched.length) return `${ok} OK`;
    return `${ok} OK, ${skip} SKIP, ${fail} FAIL`;
  };

  // Distinct slugs touched this pass.
  const slugs = new Set<string>();
  for (const r of results) {
    const slug = r.phase.split(':')[1];
    if (slug) slugs.add(slug);
  }
  const slugList = Array.from(slugs).join(', ') || '—';

  const row = `| ${date} | ${slugList} | ${tally('Analytics')} | ${tally('Optimizer')} | ${tally('Research')} | ${totalSec}s |`;

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

/**
 * Run analytics + optimizer + (optional) research + sync for a single
 * campaign. Caller is responsible for calling setCampaignSlug() so all
 * dataPath() resolution lands in the right campaign directory.
 */
async function refreshOneCampaign(
  campaignName: string,
  campaignSlug: string,
  skipResearch: boolean,
): Promise<RefreshResult[]> {
  // Make sure data/campaigns/<slug>/ exists — the path helpers don't auto-create.
  try {
    await mkdir(dataPath('POST-TRACKER.md').replace(/\/[^/]+$/, ''), { recursive: true });
  } catch { /* non-fatal */ }

  log(`\n┌──────────────────────────────────────────────────`);
  log(`│  Campaign: ${campaignName} (${campaignSlug})`);
  log(`└──────────────────────────────────────────────────`);

  const results: RefreshResult[] = [];

  log('  Phase 1/3: Analytics');
  results.push(
    await timedPhase(`Analytics:${campaignSlug}`, async () => {
      const metrics = await measurePerformance();
      return `${metrics.length} posts tracked`;
    }),
  );

  log('  Phase 2/3: Optimizer');
  results.push(
    await timedPhase(`Optimizer:${campaignSlug}`, async () => {
      await optimize();
      return 'Experiments evaluated, dashboards updated';
    }),
  );

  log('  Phase 3/3: Research');
  if (skipResearch) {
    results.push({
      phase: `Research:${campaignSlug}`,
      status: 'skipped',
      detail: '--skip-research flag',
      durationMs: 0,
    });
  } else {
    results.push(
      await timedPhase(`Research:${campaignSlug}`, async () => {
        await runResearch();
        return 'Trends + hashtags updated';
      }),
    );
  }

  log('  Phase 4: Supabase Sync');
  results.push(
    await timedPhase(`Sync:${campaignSlug}`, async () => {
      await syncToSupabase();
      return 'Dashboard data synced';
    }),
  );

  return results;
}

async function dailyRefresh(): Promise<void> {
  const skipResearch = process.argv.includes('--skip-research');
  // Optional override — pass --campaign=<slug> to refresh only ONE campaign
  // (useful for the dashboard's "Refresh Now" button which targets a single
  // campaign). Without it, every active campaign gets refreshed.
  const campaignArg = process.argv.find((a) => a.startsWith('--campaign='));
  const overrideSlug = campaignArg?.split('=')[1]?.trim() || null;

  const startTime = Date.now();

  log('╔══════════════════════════════════════════════════╗');
  log('║           DAILY REFRESH — Starting              ║');
  log(`║  ${new Date().toISOString().slice(0, 19)}                   ║`);
  log(`║  Research: ${skipResearch ? 'SKIPPED' : 'ENABLED'}                          ║`);
  log('╚══════════════════════════════════════════════════╝');

  // Resolve the campaigns list. If --campaign=X was passed and X matches an
  // active campaign, refresh just that one; otherwise iterate all active.
  const allActive = await listActiveCampaigns();
  let toRun = allActive;
  if (overrideSlug) {
    toRun = allActive.filter((c) => c.slug === overrideSlug);
    if (toRun.length === 0) {
      log(`[!] --campaign=${overrideSlug} not found in active campaigns; refreshing all active instead.`);
      toRun = allActive;
    }
  }

  // Defensive fallback: if Supabase is unreachable or no active campaigns,
  // run a single pass against the default slug (minutewise) so the cron
  // never silent-no-ops.
  if (toRun.length === 0) {
    log('[!] No active campaigns from DB — falling back to default slug.');
    toRun = [{ slug: 'minutewise', name: 'MinuteWise (fallback)' } as typeof allActive[number]];
  }

  log(`Campaigns to refresh: ${toRun.map((c) => c.slug).join(', ')}`);

  const results: RefreshResult[] = [];
  for (const c of toRun) {
    setCampaignSlug(c.slug);
    resetCampaignCache(); // keep getCampaign() lookups fresh per iteration
    try {
      const perCampaign = await refreshOneCampaign(c.name, c.slug, skipResearch);
      results.push(...perCampaign);
    } catch (err) {
      log(`[!] Campaign ${c.slug} crashed mid-refresh: ${err}`);
      results.push({
        phase: `Campaign:${c.slug}`,
        status: 'failed',
        detail: String(err).slice(0, 200),
        durationMs: 0,
      });
    }
  }

  // Phase 5: Log rotation. Refresh runs every 6h via launchd, which is the
  // perfect cadence for keeping cycle-logs/*.log and auto-fix-log.md from
  // growing unbounded on a long-uptime Mac mini. Spawned as a child process
  // so a rotation crash can't take down the rest of the refresh.
  log('\n── Phase 5: Log rotation ──');
  results.push(
    await timedPhase('Rotate', async () => {
      const { spawnSync } = await import('node:child_process');
      const repoDir = resolve(__dirname, '..');
      const r = spawnSync('npx', ['tsx', 'scripts/rotate_logs.ts', '--force'], {
        cwd: repoDir,
        encoding: 'utf-8',
      });
      if (r.status !== 0) throw new Error(`rotate_logs exited ${r.status}: ${r.stderr || r.stdout}`);
      // Parse "Rotated N file(s); freed K KB"
      const m = r.stdout?.match(/Rotated (\d+) file\(s\); freed (\d+) KB/);
      return m ? `${m[1]} files, freed ${m[2]} KB` : 'No rotation needed';
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
