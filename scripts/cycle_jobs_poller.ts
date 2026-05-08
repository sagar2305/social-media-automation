/**
 * Cycle jobs poller — runs every 60s from launchd. Picks up "Run Cycle Now"
 * requests created via the dashboard and fires `npm run cycle` for each.
 *
 * Atomic claim: marks status='claimed' BEFORE spawning so concurrent ticks
 * (or a crash mid-spawn) don't double-fire. main.ts inherits the job id via
 * the CYCLE_JOB_ID env var so the cycle_runs row can link back.
 *
 * SCHEDULER_DRY_RUN=1 prints what would fire without spawning.
 */

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { classifyError } from './auto_fix/classifier.js';
import { logClassified } from './auto_fix/audit_logger.js';
import { maybeNotify } from './auto_fix/notifier.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '..', '.env.local'), override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('[jobs_poller] Missing Supabase env vars');
  process.exit(2);
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

interface CycleJob {
  id: string;
  label: string | null;
  flows: string[];
  path: 'direct' | 'draft';
  account_handles: string[];
  posts_per_account: number;
  skip_research: boolean;
  schedule_offset_hours: number;
  status: string;
  campaign_id: string | null;
}

function flowToFlag(flow: string): string {
  if (flow === 'photorealistic') return '1';
  if (flow === 'animated') return '2';
  if (flow === 'emoji_overlay') return '3';
  return flow;
}

/**
 * Build the npm-run-cycle CLI args for a job. Honours campaign_id by
 * appending --campaign=<slug>. Some jobs use label='refresh:quick:<slug>'
 * (the per-campaign Refresh Now button from Phase 6) — those route to
 * `npm run refresh:quick -- --campaign=<slug>` instead of a posting cycle.
 */
async function buildArgs(job: CycleJob): Promise<string[]> {
  // Resolve campaign slug if needed (one Supabase round-trip per fired job
  // — cheap and only happens at fire time, not on every poll).
  let campaignSlug: string | null = null;
  if (job.campaign_id) {
    const { data } = await supabase
      .from('campaigns')
      .select('slug')
      .eq('id', job.campaign_id)
      .maybeSingle<{ slug: string }>();
    campaignSlug = data?.slug ?? null;
  }

  // Refresh-style jobs: label 'refresh:quick:<slug>' triggers
  // `npm run refresh:quick -- --campaign=<slug>` instead of a posting cycle.
  // The per-campaign Refresh Now button uses this shape.
  if (job.label?.startsWith('refresh:quick:')) {
    const labelSlug = job.label.split(':')[2];
    const slug = campaignSlug || labelSlug;
    return slug
      ? ['run', 'refresh:quick', '--', `--campaign=${slug}`]
      : ['run', 'refresh:quick'];
  }

  const args: string[] = ['run', 'cycle', '--'];
  if (campaignSlug) args.push(`--campaign=${campaignSlug}`);
  if (job.flows.length > 0) {
    args.push(`--flow=${job.flows.map(flowToFlag).join(',')}`);
  }
  args.push(`--path=${job.path}`);
  if (job.account_handles.length > 0) {
    args.push(`--account=${job.account_handles.join(',')}`);
  }
  if (job.posts_per_account > 1) {
    args.push(`--posts-per-flow=${job.posts_per_account}`);
  }
  if (job.skip_research) args.push('--skip-research');
  if (job.schedule_offset_hours > 0) {
    args.push(`--delay=${job.schedule_offset_hours * 60}`);
  }
  return args;
}

async function claimJob(job: CycleJob): Promise<boolean> {
  // Atomic-ish claim: only flips pending → claimed if still pending.
  const { data, error } = await supabase
    .from('cycle_jobs')
    .update({ status: 'claimed', claimed_at: new Date().toISOString() })
    .eq('id', job.id)
    .eq('status', 'pending')
    .select('id')
    .maybeSingle();
  if (error) {
    console.error(`[jobs_poller] claim failed for ${job.id}:`, error.message);
    return false;
  }
  return data !== null;
}

async function fireJob(job: CycleJob): Promise<void> {
  const args = await buildArgs(job);
  const dryRun = process.env.SCHEDULER_DRY_RUN === '1';

  if (dryRun) {
    console.log(`[jobs_poller] DRY-RUN would fire job ${job.id}: npm ${args.join(' ')}`);
    return;
  }

  const repoDir = resolve(__dirname, '..');
  console.log(`[jobs_poller] FIRE job ${job.id}: npm ${args.join(' ')}`);

  const child = spawn('npm', args, {
    cwd: repoDir,
    detached: true,
    stdio: 'ignore',
    env: {
      ...process.env,
      CYCLE_CALLER: `manual:${job.label ?? job.id.slice(0, 8)}`,
      CYCLE_JOB_ID: job.id,
    },
  });
  child.unref();
}

async function main() {
  const { data: jobs, error } = await supabase
    .from('cycle_jobs')
    .select('*')
    .eq('status', 'pending')
    .order('requested_at', { ascending: true })
    .limit(5)
    .returns<CycleJob[]>();

  if (error) {
    // Route through auto-fix so transient fetch failures are catalogued
    // (RETRY tier — quiet) and sustained outages dedup-notify (HUMAN-ONLY).
    const synthetic = new Error(`[jobs_poller] ${error.message}`);
    try {
      const classified = classifyError(synthetic, { source: 'local' });
      await logClassified(classified, { handled: 'pending' });
      await maybeNotify(classified);
    } catch { /* non-fatal */ }
    console.error('[jobs_poller] read failed:', error.message);
    process.exit(2);
  }

  if (!jobs || jobs.length === 0) {
    return;
  }

  for (const job of jobs) {
    const claimed = await claimJob(job);
    if (!claimed) {
      console.log(`[jobs_poller] job ${job.id} already claimed by another tick — skipping`);
      continue;
    }
    try {
      await fireJob(job);
    } catch (err) {
      console.error(`[jobs_poller] fire failed for ${job.id}:`, err);
      await supabase
        .from('cycle_jobs')
        .update({
          status: 'failed',
          completed_at: new Date().toISOString(),
          error_text: String(err).slice(0, 500),
        })
        .eq('id', job.id);
    }
  }
}

main().catch(err => {
  console.error('[jobs_poller] unexpected:', err);
  process.exit(1);
});
