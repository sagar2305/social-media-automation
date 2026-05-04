import { readFile, unlink } from 'fs/promises';
import { log } from './scripts/api-client.js';
import { config, FlowType, PostingPath } from './config/config.js';
import { loadAccountsIntoConfig } from './scripts/account_loader.js';
import {
  startCycleRun,
  reportEvent,
  setCurrentPhase,
  bumpPostCounters,
  endCycleRun,
} from './scripts/cycle_reporter.js';
import { runResearch } from './scripts/fetch_trends.js';
import { generateContent, resetUsedTemplates } from './scripts/text_overlay.js';
import { generateSlidesForPost } from './scripts/generate_images.js';
import { postAllDrafts, PostResult } from './scripts/post_to_tiktok.js';
import { measurePerformance } from './scripts/pull_analytics.js';
import { optimize } from './scripts/optimizer.js';
import { syncToSupabase } from './scripts/sync-to-supabase.js';
import {
  archivePostWithMeta,
  findRetries,
  recordAttempt,
  markTrackerRowRetried,
} from './scripts/retry_handler.js';

// Max unique TikTok accounts we can post to per 24h (Blotato Starter plan cap).
// Bump this if you upgrade the Blotato plan.
const BLOTATO_DAILY_ACCOUNT_CAP = 3;

// ─── CLI Args ───────────────────────────────────────────────
// Usage:
//   npm run cycle                          → all 3 flows × 3 accounts, path=direct
//   npm run flow1                          → photorealistic × 3 accounts, path=direct
//   npm run flow2                          → animated × 3 accounts, path=direct
//   npm run flow3                          → emoji_overlay × 3 accounts, path=direct
//   npm run flow2 -- --path=draft          → animated × 3 accounts, saves to TikTok drafts
//   npm run flow2 -- --path=direct         → animated × 3 accounts, publishes directly
//   npm run flow2 -- --delay=15            → schedule 15 min after completion

function parseArgs(): {
  flows: FlowType[];
  postingPath: PostingPath;
  delayMinutes: number;
  scheduledAt: Date | undefined;
  skipResearch: boolean;
  accountIndices: number[];
  postsPerFlow: number;
} {
  const args = process.argv.slice(2);

  // Determine flows — accepts single (`--flow=1`) or comma-separated (`--flow=1,2`).
  let flows: FlowType[] = ['photorealistic', 'animated', 'emoji_overlay'];
  const flowMap: Record<string, FlowType> = {
    '1': 'photorealistic', 'photorealistic': 'photorealistic',
    '2': 'animated', 'animated': 'animated',
    '3': 'emoji_overlay', 'emoji_overlay': 'emoji_overlay',
  };
  const flowArg = args.find(a => a.startsWith('--flow='));
  if (flowArg) {
    const val = flowArg.split('=')[1];
    if (val === 'all') {
      flows = ['photorealistic', 'animated', 'emoji_overlay'];
    } else {
      const parsed = val.split(',').map(v => flowMap[v.trim()]).filter(Boolean) as FlowType[];
      if (!parsed.length) throw new Error(`Invalid --flow value: ${val}`);
      flows = parsed;
    }
  }

  // Determine posting path (default: draft — saves to TikTok drafts via Blotato)
  let postingPath: PostingPath = 'draft';
  const pathArg = args.find(a => a.startsWith('--path='));
  if (pathArg) {
    const val = pathArg.split('=')[1];
    if (val === 'draft' || val === '2') postingPath = 'draft';
    else if (val === 'direct' || val === '1') postingPath = 'direct';
  }

  // Delay in minutes (schedule X min after completion)
  let delayMinutes = 0;
  const delayArg = args.find(a => a.startsWith('--delay='));
  if (delayArg) {
    delayMinutes = parseInt(delayArg.split('=')[1]) || 0;
  }

  // Absolute scheduled time (overrides delay) — ISO string or millis-since-epoch
  let scheduledAt: Date | undefined;
  const scheduledAtArg = args.find(a => a.startsWith('--scheduledAt='));
  if (scheduledAtArg) {
    const raw = scheduledAtArg.split('=')[1];
    const parsed = /^\d+$/.test(raw) ? new Date(parseInt(raw)) : new Date(raw);
    if (isNaN(parsed.getTime())) throw new Error(`Invalid --scheduledAt: ${raw}`);
    scheduledAt = parsed;
  }

  // Account filter: --account=yournotetaker or --account=0,1 or --account=all
  let accountIndices: number[] = config.tiktokAccounts.map((_, i) => i); // default: all
  const accountArg = args.find(a => a.startsWith('--account='));
  if (accountArg) {
    const val = accountArg.split('=')[1].toLowerCase();
    if (val !== 'all') {
      const nameMap: Record<string, number> = {};
      config.tiktokAccounts.forEach((a, i) => {
        nameMap[a.handle.toLowerCase()] = i;
        nameMap[a.name.toLowerCase()] = i;
        nameMap[`${i}`] = i;
      });
      // Support comma-separated: --account=yournotetaker,hack.my.study
      accountIndices = val.split(',').map(v => {
        const idx = nameMap[v.trim()];
        if (idx === undefined) {
          log(`WARNING: Unknown account "${v.trim()}", skipping`);
          return -1;
        }
        return idx;
      }).filter(i => i >= 0);
    }
  } else {
    // Blotato Starter plan caps us at BLOTATO_DAILY_ACCOUNT_CAP unique accounts
    // per 24h. When we have more accounts than the cap we (1) rotate the order
    // by day so the skipped account cycles across the roster, and (2) trim to
    // the cap so we don't burn Gemini credits generating posts we know will
    // be rejected. The retry_handler is reserved for *real* failures only.
    const dayOffset = Math.floor(Date.now() / (24 * 60 * 60 * 1000)) % accountIndices.length;
    accountIndices = [...accountIndices.slice(dayOffset), ...accountIndices.slice(0, dayOffset)];
    if (accountIndices.length > BLOTATO_DAILY_ACCOUNT_CAP) {
      const dropped = accountIndices.slice(BLOTATO_DAILY_ACCOUNT_CAP)
        .map(i => config.tiktokAccounts[i].name).join(', ');
      accountIndices = accountIndices.slice(0, BLOTATO_DAILY_ACCOUNT_CAP);
      log(`Account cap: ${BLOTATO_DAILY_ACCOUNT_CAP}/day — skipping ${dropped} today (rotates tomorrow)`);
    }
  }

  // Skip research phase
  const skipResearch = args.includes('--skip-research');

  // Posts per (flow × account). Default 1. Set >1 to generate multiple variants
  // of the same flow per account in a single cycle (e.g., --posts-per-flow=2 on
  // a --flow=1,2 run generates 2 photorealistic + 2 animated per account).
  let postsPerFlow = 1;
  const pppArg = args.find(a => a.startsWith('--posts-per-flow='));
  if (pppArg) {
    const n = parseInt(pppArg.split('=')[1]) || 1;
    postsPerFlow = Math.max(1, n);
  }

  return { flows, postingPath, delayMinutes, scheduledAt, skipResearch, accountIndices, postsPerFlow };
}

async function cleanup(filePaths: string[]): Promise<void> {
  for (const p of filePaths) {
    await unlink(p).catch(() => {});
  }
  if (filePaths.length) log(`Cleaned up ${filePaths.length} temp files`);
}

async function runCycle(): Promise<void> {
  // Rule 80: Read and validate RULES.md before every cycle
  try {
    const rules = await readFile('./RULES.md', 'utf-8');
    const ruleCount = (rules.match(/^\d+\./gm) || []).length;
    log(`=== RULES.md loaded: ${ruleCount} rules ===`);
  } catch {
    log('WARNING: RULES.md not found — running without rules validation');
  }

  // Pull dashboard-managed accounts from Supabase before parseArgs (which
  // reads config.tiktokAccounts to default the --account filter). On any
  // failure the loader leaves config.ts values intact, so cycles keep running.
  await loadAccountsIntoConfig();

  const { flows, postingPath, delayMinutes, scheduledAt, skipResearch, accountIndices, postsPerFlow } = parseArgs();
  const pathLabel = postingPath === 'draft' ? 'UPLOAD (TikTok drafts)' : 'DIRECT_POST (publish)';
  const flowNames = flows.map(f => f === 'photorealistic' ? 'Flow 1' : f === 'animated' ? 'Flow 2' : 'Flow 3');
  const accountNames = accountIndices.map(i => config.tiktokAccounts[i].name);
  const totalPosts = flows.length * accountIndices.length * postsPerFlow;

  log('╔══════════════════════════════════════════════════╗');
  log(`║  CYCLE: ${flowNames.join(' + ')}`);
  log(`║  ${flows.length} flow(s) × ${accountIndices.length} account(s) × ${postsPerFlow} per-flow = ${totalPosts} posts`);
  log(`║  Accounts: ${accountNames.join(', ')}`);
  log(`║  Path: ${pathLabel}`);
  if (scheduledAt) log(`║  Scheduled: ${scheduledAt.toISOString()}`);
  else if (delayMinutes > 0) log(`║  Schedule: ${delayMinutes} min after completion`);
  log('╚══════════════════════════════════════════════════╝');

  // Parse-only hook — used by scripts/_test_args_parse.ts to verify the CLI
  // contract without running a real cycle. Prints the parsed banner and exits 0.
  if (process.env.TEST_PARSE_ONLY === '1') {
    log('TEST_PARSE_ONLY exit');
    return;
  }

  // Live status reporter — writes a row to cycle_runs and timeline events to
  // cycle_events so the dashboard can show progress in real time. Telemetry
  // failures NEVER fail the cycle (all reporter calls swallow errors).
  const runId = await startCycleRun({
    flows: flowNames,
    accounts: accountNames,
    path: pathLabel,
    postsTotal: totalPosts,
    caller: process.env.CYCLE_CALLER ?? 'manual',
  });
  await reportEvent(runId, 'cycle_start', 'Cycle started',
    `${totalPosts} posts queued (${flowNames.join(' + ')} × ${accountNames.join(', ')})`);

  // Link the cycle_jobs row back to this run so the dashboard "Run Now" button
  // can show progress on the job it created. Lazy import to keep module graph
  // tight when not running from a job.
  const cycleJobId = process.env.CYCLE_JOB_ID;
  if (cycleJobId && runId) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (url && key) {
        const sb = createClient(url, key);
        await sb.from('cycle_jobs').update({ cycle_run_id: runId }).eq('id', cycleJobId);
      }
    } catch {
      // ignore — telemetry never breaks the cycle
    }
  }

  try {
  // Phase 1: Analytics
  await setCurrentPhase(runId, 'analytics');
  await reportEvent(runId, 'phase_start', 'Analytics', 'Measuring per-post performance');
  try {
    const analytics = await measurePerformance();
    log(`Analytics: measured ${analytics.length} posts`);
    await reportEvent(runId, 'phase_done', 'Analytics', `${analytics.length} posts measured`);
  } catch (err) {
    log(`Analytics failed (non-fatal): ${err}`);
    await reportEvent(runId, 'error', 'Analytics failed', String(err).slice(0, 200));
  }

  // Phase 2: Optimize
  await setCurrentPhase(runId, 'optimize');
  await reportEvent(runId, 'phase_start', 'Optimizer', 'Updating winners/losers');
  try {
    await optimize();
    await reportEvent(runId, 'phase_done', 'Optimizer', 'Format rankings refreshed');
  } catch (err) {
    log(`Optimization failed (non-fatal): ${err}`);
    await reportEvent(runId, 'error', 'Optimizer failed', String(err).slice(0, 200));
  }

  // Phase 3: Research trends
  if (!skipResearch) {
    await setCurrentPhase(runId, 'research');
    await reportEvent(runId, 'phase_start', 'Research', 'Pulling Virlo trends');
    try {
      await runResearch();
      await reportEvent(runId, 'phase_done', 'Research', 'Trends refreshed');
    } catch (err) {
      log(`Research failed (non-fatal): ${err}`);
      await reportEvent(runId, 'error', 'Research failed', String(err).slice(0, 200));
    }
  } else {
    log('Research skipped (--skip-research)');
    await reportEvent(runId, 'info', 'Research skipped', '--skip-research flag');
  }

  // Phase 4: Generate content + images for all flows × accounts.
  // Before generating, check for retryable failed posts — their archived slides
  // are reused instead of regenerating, saving Gemini credits.
  const retries = await findRetries();
  if (retries.size > 0) {
    log(`\n>>> RETRY QUEUE: ${retries.size} failed post(s) will be re-submitted instead of regenerated`);
    for (const [key, r] of retries) {
      log(`    ${key} → attempt ${r.attempts + 1}/3 (original ${r.originalPostId})`);
    }
  }

  const allPostData: {
    slidePaths: string[];
    caption: string;
    title: string;
    metadata: any;
    useCta: boolean;
    accountIndex: number;
    archiveDir: string;
    isRetry: boolean;
    originalPostId?: string;
  }[] = [];
  const allTempFiles: string[] = [];

  await setCurrentPhase(runId, 'generating');

  for (const flow of flows) {
    log(`\n${'═'.repeat(50)}`);
    log(`═══ FLOW: ${flow.toUpperCase()} ═══`);
    log(`${'═'.repeat(50)}`);
    await reportEvent(runId, 'flow_start', `Flow: ${flow}`, `Starting ${flow} generation`, { flow });

    resetUsedTemplates();

    for (let ai = 0; ai < accountIndices.length; ai++) {
      const accountIdx = accountIndices[ai];
      const account = config.tiktokAccounts[accountIdx];
      // Each account gets `postsPerFlow` distinct posts for this flow. The
      // first iteration may pick up a pending retry (reuses archived slides);
      // later iterations always generate fresh content.
      for (let rep = 0; rep < postsPerFlow; rep++) {
        log(`\n>>> ${flow} | ${account.name} (${ai + 1}/${accountIndices.length}) [rep ${rep + 1}/${postsPerFlow}] <<<`);

        const retry = rep === 0 ? retries.get(`${flow}:${accountIdx}`) : undefined;
        if (retry) {
          log(`  ♻️  REUSE: archived slides from ${retry.archiveDir} (retry ${retry.attempts + 1}/3)`);
          allPostData.push({
            slidePaths: retry.slidePaths,
            caption: retry.caption,
            title: retry.title,
            metadata: retry.metadata,
            useCta: retry.useCta,
            accountIndex: accountIdx,
            archiveDir: retry.archiveDir,
            isRetry: true,
            originalPostId: retry.originalPostId,
          });
          continue;
        }

        const content = await generateContent(flow, accountIdx);
        const slidePaths = await generateSlidesForPost(content);

        const archiveDir = await archivePostWithMeta(
          slidePaths,
          flow,
          account.name,
          accountIdx,
          content,
        );

        await reportEvent(
          runId,
          'post_generated',
          `${flow} → ${account.name}`,
          `${slidePaths.length} slides ready`,
          { account: account.handle, flow },
        );

        allPostData.push({
          slidePaths,
          caption: content.caption,
          title: content.title,
          metadata: content.metadata,
          useCta: content.useCta,
          accountIndex: accountIdx,
          archiveDir,
          isRetry: false,
        });
        allTempFiles.push(...slidePaths);
      }
    }
  }

  // Phase 5: Post using selected path
  const scheduleDate = scheduledAt
    ? scheduledAt
    : delayMinutes > 0
    ? new Date(Date.now() + delayMinutes * 60 * 1000)
    : undefined;

  await setCurrentPhase(runId, 'posting');
  await reportEvent(runId, 'phase_start', 'Posting', `Submitting ${allPostData.length} posts to Blotato (${pathLabel})`);

  const results = await postAllDrafts(allPostData, postingPath, scheduleDate);

  // Bookkeeping: update each archive's meta.json with its new Blotato postId
  // and mark the original tracker row as retried if this was a retry.
  for (let i = 0; i < results.length && i < allPostData.length; i++) {
    const r = results[i];
    const d = allPostData[i];
    await recordAttempt(d.archiveDir, r.postId);
    if (d.isRetry && d.originalPostId) {
      await markTrackerRowRetried(d.originalPostId, r.postId);
    }
    const account = config.tiktokAccounts[d.accountIndex];
    const submittedOk = r.postId && !r.postId.startsWith('FAILED');
    if (submittedOk) {
      await reportEvent(
        runId,
        'post_submitted',
        `${r.flow} → ${r.accountName}`,
        `Blotato postId: ${r.postId}`,
        { account: account?.handle, flow: r.flow, metadata: { postId: r.postId } },
      );
      await bumpPostCounters(runId, 'posts_done');
    } else {
      await reportEvent(
        runId,
        'post_failed',
        `${r.flow} → ${r.accountName}`,
        `${r.postId}`,
        { account: account?.handle, flow: r.flow },
      );
      await bumpPostCounters(runId, 'posts_failed');
    }
  }
  await reportEvent(runId, 'phase_done', 'Posting', `${results.length} submissions completed`);

  // Summary
  log(`\n╔══════════════════════════════════════════════════╗`);
  log(`║  CYCLE COMPLETE — ${results.length} posts`);
  log(`║  Path: ${pathLabel}`);
  if (scheduleDate) log(`║  Scheduled: ${scheduleDate.toLocaleTimeString()}`);
  log(`╠══════════════════════════════════════════════════╣`);
  for (const r of results) {
    log(`║  ${r.flow.padEnd(15)} | ${r.accountName.padEnd(20)} | ${r.postId}`);
  }
  log(`╚══════════════════════════════════════════════════╝`);

  // Phase 6: Sync to Supabase dashboard
  await setCurrentPhase(runId, 'sync');
  try {
    await syncToSupabase();
    log('Supabase sync complete');
    await reportEvent(runId, 'phase_done', 'Sync', 'Dashboard data synced');
  } catch (err) {
    log(`Supabase sync failed (non-fatal): ${err}`);
    await reportEvent(runId, 'error', 'Sync failed', String(err).slice(0, 200));
  }

  // Phase 7: Cleanup
  await cleanup(allTempFiles);

  await reportEvent(runId, 'cycle_done', 'Cycle complete',
    `${results.length} posts submitted (${pathLabel})`);
  await endCycleRun(runId, 'completed');

  // Mark the originating cycle_jobs row complete (if any) so the button
  // can flip from "Running" to "Done".
  if (cycleJobId) {
    try {
      const { createClient } = await import('@supabase/supabase-js');
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (url && key) {
        const sb = createClient(url, key);
        await sb.from('cycle_jobs').update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        }).eq('id', cycleJobId);
      }
    } catch { /* swallow */ }
  }
  } catch (err) {
    await reportEvent(runId, 'error', 'Cycle failed', String(err).slice(0, 500));
    await endCycleRun(runId, 'failed', String(err).slice(0, 500));
    if (cycleJobId) {
      try {
        const { createClient } = await import('@supabase/supabase-js');
        const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
        const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
        if (url && key) {
          const sb = createClient(url, key);
          await sb.from('cycle_jobs').update({
            status: 'failed',
            completed_at: new Date().toISOString(),
            error_text: String(err).slice(0, 500),
          }).eq('id', cycleJobId);
        }
      } catch { /* swallow */ }
    }
    throw err;
  }
}

// Entry point
runCycle().catch((err) => {
  log(`CYCLE FAILED: ${err}`);
  process.exit(1);
});
