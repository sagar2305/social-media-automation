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
  post_interval_minutes: number;
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
  // Resolve campaign slug + status if needed (one Supabase round-trip per
  // fired job — cheap and only happens at fire time, not on every poll).
  // status is pulled alongside slug so the pause/archive guard below can
  // run without a second query.
  let campaignSlug: string | null = null;
  let campaignStatus: 'active' | 'paused' | 'archived' | null = null;
  if (job.campaign_id) {
    const { data, error } = await supabase
      .from('campaigns')
      .select('slug, status')
      .eq('id', job.campaign_id)
      .maybeSingle<{ slug: string; status: 'active' | 'paused' | 'archived' }>();
    // Fail fast on query errors or missing/sluggless rows. Without these
    // guards, a campaign_id referencing a deleted/archived-and-purged row
    // (or a transient Supabase failure) would fall through with
    // campaignSlug=null, and below we'd spawn `npm run cycle` WITHOUT a
    // --campaign flag — the legacy global path that posts to MinuteWise.
    // Throwing here makes the claim/finish loop mark the job 'failed'
    // with the exact reason so the operator sees it on /runs.
    if (error) {
      throw new Error(
        `cycle_jobs row ${job.id}: failed to resolve campaign ${job.campaign_id} — ${error.message}`,
      );
    }
    if (!data?.slug) {
      throw new Error(
        `cycle_jobs row ${job.id} references missing or sluggless campaign_id=${job.campaign_id}. ` +
        `Refusing to spawn without --campaign — that would post to the legacy MinuteWise accounts.`,
      );
    }
    campaignSlug = data.slug;
    campaignStatus = data.status ?? null;
  }

  // Pause/archive guard: refuse to fire a manual Run cycle on a campaign
  // the operator has paused or archived. The dashboard also blocks the
  // button when status != 'active' (defense in depth), but a stale tab
  // or a direct-SQL insert could still queue a job here. Throwing makes
  // the calling claim/finish loop mark the job 'failed' with this error
  // text — the operator sees it on /runs and knows what to fix.
  if (job.campaign_id && campaignStatus && campaignStatus !== 'active') {
    throw new Error(
      `cycle_jobs row ${job.id} targets campaign "${campaignSlug ?? job.campaign_id}" ` +
      `which is currently ${campaignStatus}. Flip status back to 'active' on the ` +
      `campaign Edit page if you want to resume cycles.`,
    );
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

  // Hard guard: campaign-scoped jobs MUST list accounts explicitly.
  // The legacy "empty = all active" semantics let a job posted from
  // outside the dashboard (direct SQL insert, old client tab, etc.)
  // fan out to every account on the campaign. Phase 17b removed the
  // fallback in the dashboard's Run cycle dialog, and we mirror the
  // rule on the engine side too. The poller will mark this job
  // failed via the calling claim/finish loop.
  if (job.campaign_id && job.account_handles.length === 0) {
    throw new Error(
      `cycle_jobs row ${job.id} has campaign_id=${job.campaign_id} but account_handles is empty. ` +
      `Every campaign-scoped job must list its target accounts explicitly. ` +
      `Re-queue the job from the dashboard's Run cycle dialog with at least one account selected.`,
    );
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
  if (job.post_interval_minutes && job.post_interval_minutes > 0) {
    args.push(`--post-interval=${job.post_interval_minutes}`);
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
