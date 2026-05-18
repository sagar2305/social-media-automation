/**
 * Scheduler tick — runs every 5 min from launchd. Iterates the dashboard-
 * managed `cycle_batches` table and fires `npm run cycle` for any batch whose
 * scheduled time has passed and that hasn't run today.
 *
 * Decision logic:
 *   1. read schedule_settings (master enabled toggle + timezone)
 *   2. if !enabled → exit
 *   3. for each batch in cycle_batches where enabled=true:
 *      - if last_run_date == today (in tz) → skip
 *      - if current time (in tz) < run_time → skip
 *      - else → mark last_run_date=today, spawn npm run cycle
 *
 * The "past run_time and not yet run today" rule means the tick is also
 * self-catching-up: if the Mac was asleep at run_time and wakes up later,
 * the next tick after wake fires the batch.
 *
 * All telemetry / DB-write failures are non-fatal — the goal is "don't lose
 * a cycle"; we'd rather double-run a batch than skip one. main.ts has its
 * own per-cycle idempotency layer if anything slips through.
 */

import { spawn } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile, stat } from 'node:fs/promises';
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
  console.error('[scheduler_tick] Missing Supabase env vars');
  process.exit(2);
}

const supabase: SupabaseClient = createClient(SUPABASE_URL, SUPABASE_KEY);

interface ScheduleSettings {
  enabled: boolean;
  timezone: string;
}

interface CycleBatch {
  id: string;
  label: string;
  order_index: number;
  run_time: string;            // HH:MM
  flows: string[];             // ['photorealistic', 'animated', ...]
  path: 'direct' | 'draft';
  account_handles: string[];   // empty = all active
  posts_per_account: number;
  skip_research: boolean;
  schedule_offset_hours: number;
  post_interval_minutes: number;
  enabled: boolean;
  last_run_date: string | null;
  created_at: string;
  updated_at: string;
  campaign_id: string | null;  // Phase 17 multi-campaign — null = legacy / default campaign
}

function nowInTimezone(tz: string): { date: string; minutes: number } {
  return nowInTimezoneFromDate(new Date(), tz);
}

function nowInTimezoneFromDate(d: Date, tz: string): { date: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10);
  return { date, minutes };
}

function nowInTimezoneFromIso(iso: string, tz: string): { date: string; minutes: number } {
  return nowInTimezoneFromDate(new Date(iso), tz);
}

function targetMinutes(runTime: string): number {
  const [hh, mm] = runTime.split(':').map(Number);
  return hh * 60 + mm;
}

function flowToFlag(flow: string): string {
  if (flow === 'photorealistic') return '1';
  if (flow === 'animated') return '2';
  if (flow === 'emoji_overlay') return '3';
  return flow;
}

/**
 * Build the npm-run-cycle CLI args for a batch. Critically prepends
 * --campaign=<slug> when the batch has a campaign_id — without it, every
 * scheduler-fired cycle falls back to the engine's default campaign and
 * the run shows up under the wrong campaign in the dashboard (MinuteWise
 * instead of RoastAI was the original symptom).
 *
 * Mirrors `cycle_jobs_poller.buildArgs` so the two firing paths stay
 * behaviourally identical.
 */
async function buildBatchArgs(batch: CycleBatch): Promise<string[] | null> {
  // Resolve campaign slug + status from campaign_id (one extra Supabase
  // round-trip per fired batch — only happens at fire time, not on every
  // 5-min tick). We pull status alongside slug so the pause/archive guard
  // below can run without a second query.
  let campaignSlug: string | null = null;
  if (batch.campaign_id) {
    const { data } = await supabase
      .from('campaigns')
      .select('slug, status')
      .eq('id', batch.campaign_id)
      .maybeSingle<{ slug: string; status: 'active' | 'paused' | 'archived' }>();
    campaignSlug = data?.slug ?? null;
    // Hard guard: if the batch claims to be tied to a campaign but the
    // campaign row is gone (deleted, slug renamed under us, RLS hiding
    // it, etc.) we MUST NOT fall through and spawn an unrouted cycle —
    // main.ts would smart-default to a different campaign and post the
    // wrong content. Returning null here makes fireBatch skip the row
    // without touching last_run_date so it'll re-attempt next tick.
    if (!campaignSlug) {
      console.error(
        `[scheduler_tick] REFUSE to fire "${batch.label}" — batch.campaign_id=${batch.campaign_id} ` +
        `but no matching campaigns row found. Fix the data (delete the orphan batch or restore the campaign) ` +
        `and the next tick will re-attempt.`,
      );
      return null;
    }
    // Pause/archive guard: the dashboard's campaign Edit page lets the
    // operator flip status to 'paused' or 'archived'. Until now the
    // engine ignored that flag, so "pausing" a campaign was cosmetic —
    // batches still fired, Run cycle still queued. Honour it here so
    // pause/archive really means "stop posting". Operator unblocks by
    // flipping status back to 'active' on /campaigns/<slug>/edit; the
    // next 5-min tick will pick the batch back up if today is still
    // its run day.
    if (data && data.status !== 'active') {
      console.log(
        `[scheduler_tick] skip "${batch.label}" — campaign "${campaignSlug}" is ${data.status}. ` +
        `Set status back to 'active' on /campaigns/${campaignSlug}/edit to resume.`,
      );
      return null;
    }
  }

  // Hard guard: campaign-scoped batches MUST declare their target accounts
  // explicitly. Legacy "empty = all active" semantics let a batch fan
  // out to every active account in the campaign — the dashboard now
  // requires explicit selection on save (see batch-manager.tsx), but
  // pre-existing rows in cycle_batches may still be empty. Refuse them
  // here so a stale batch can't silently post to accounts the operator
  // didn't intend. Editing the batch in the dashboard's Schedule tab
  // and picking accounts unblocks it.
  if (batch.campaign_id && batch.account_handles.length === 0) {
    console.error(
      `[scheduler_tick] REFUSE to fire "${batch.label}" — batch has campaign_id=${batch.campaign_id} ` +
      `but account_handles is empty. The "empty = all active" fallback was removed; every batch ` +
      `must explicitly list its target accounts. Edit the batch on /campaigns/${campaignSlug}/schedule, ` +
      `pick at least one account, and save.`,
    );
    return null;
  }

  const args: string[] = ['run', 'cycle', '--'];
  if (campaignSlug) args.push(`--campaign=${campaignSlug}`);
  args.push(`--flow=${batch.flows.map(flowToFlag).join(',')}`);
  args.push(`--path=${batch.path}`);
  if (batch.account_handles.length > 0) {
    args.push(`--account=${batch.account_handles.join(',')}`);
  }
  if (batch.posts_per_account > 1) {
    args.push(`--posts-per-flow=${batch.posts_per_account}`);
  }
  if (batch.skip_research) {
    args.push('--skip-research');
  }
  if (batch.schedule_offset_hours > 0) {
    args.push(`--delay=${batch.schedule_offset_hours * 60}`);
  }
  if (batch.post_interval_minutes && batch.post_interval_minutes > 0) {
    args.push(`--post-interval=${batch.post_interval_minutes}`);
  }
  return args;
}

async function fireBatch(batch: CycleBatch, today: string): Promise<void> {
  const args = await buildBatchArgs(batch);
  // buildBatchArgs returns null when it refuses to fire (orphan campaign_id).
  // Don't touch last_run_date in that case — we want the next tick to
  // re-attempt once the operator fixes the data.
  if (args === null) return;

  const dryRun = process.env.SCHEDULER_DRY_RUN === '1';

  if (dryRun) {
    console.log(`[scheduler_tick] DRY-RUN would fire "${batch.label}": npm ${args.join(' ')}`);
    return;
  }

  // Mark last_run_date FIRST so a crash mid-spawn doesn't re-fire on the next tick.
  await supabase
    .from('cycle_batches')
    .update({ last_run_date: today, updated_at: new Date().toISOString() })
    .eq('id', batch.id);

  const repoDir = resolve(__dirname, '..');
  console.log(`[scheduler_tick] FIRE batch "${batch.label}": npm ${args.join(' ')}`);

  const child = spawn('npm', args, {
    cwd: repoDir,
    detached: true,
    stdio: 'ignore',
    env: { ...process.env, CYCLE_CALLER: `batch:${batch.label}` },
  });
  child.unref();
}

/**
 * Freshness probe — fires a HUMAN-ONLY alert if data/REFRESH-LOG.md hasn't
 * been touched in >36 h. Catches the silent-pipeline-stall case where the
 * com.minutewise.daily.refresh plist is missing or failing without any
 * API error to classify (auto-fix is reactive, not a heartbeat monitor).
 *
 * Throttled to once per calendar day via a sentinel file so we don't spam
 * alerts on every 5-min tick once stale.
 */
async function probeRefreshFreshness(repoDir: string): Promise<void> {
  const STALE_HOURS = 36;
  const logPath = resolve(repoDir, 'data', 'REFRESH-LOG.md');
  const sentinelPath = resolve(repoDir, 'data', '.last-refresh-stale-alert');

  let ageHours: number;
  try {
    const st = await stat(logPath);
    ageHours = (Date.now() - st.mtimeMs) / 3_600_000;
  } catch {
    return; // file missing — first-run repo; don't alert
  }

  if (ageHours <= STALE_HOURS) return;

  // Throttle: only one alert per calendar day
  const today = new Date().toISOString().slice(0, 10);
  try {
    const last = (await readFile(sentinelPath, 'utf-8')).trim();
    if (last === today) return;
  } catch { /* sentinel missing — fall through */ }

  const synthetic = new Error(
    `REFRESH-LOG stale: last successful refresh was ${Math.round(ageHours)} hours ago`,
  );
  const classified = classifyError(synthetic, { source: 'local', url: logPath });
  await logClassified(classified, { handled: 'pending' });
  await maybeNotify(classified);

  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(sentinelPath, today);
  } catch { /* non-fatal */ }
}

/**
 * Autoresearch staleness probe. The brain plist fires hourly + on-load, and
 * the script writes data/.last-autoresearch-run after a successful daily run.
 * If that sentinel is older than 48h, something has silently broken and we
 * want a HUMAN-ONLY alert (refresh-stale catches the reconciliation pipeline,
 * this catches the experimentation pipeline — separate failure modes).
 */
async function probeAutoresearchFreshness(repoDir: string): Promise<void> {
  const STALE_DAYS = 2;
  const sentinelPath = resolve(repoDir, 'data', '.last-autoresearch-run');
  const alertedSentinel = resolve(repoDir, 'data', '.last-autoresearch-stale-alert');

  let raw: string;
  try { raw = (await readFile(sentinelPath, 'utf-8')).trim(); }
  catch { return; } // never run yet — nothing to alert on

  // Sentinel is "YYYY-MM-DD"
  const last = new Date(raw + 'T00:00:00Z');
  if (Number.isNaN(last.getTime())) return;
  const ageDays = (Date.now() - last.getTime()) / 86_400_000;
  if (ageDays <= STALE_DAYS) return;

  // Throttle to one alert per calendar day
  const today = new Date().toISOString().slice(0, 10);
  try {
    if ((await readFile(alertedSentinel, 'utf-8')).trim() === today) return;
  } catch { /* sentinel missing — fall through */ }

  const synthetic = new Error(
    `autoresearch sentinel is ${Math.floor(ageDays)} days old (last run ${raw})`,
  );
  const classified = classifyError(synthetic, { source: 'local', url: sentinelPath });
  await logClassified(classified, { handled: 'pending' });
  await maybeNotify(classified);

  try {
    const { writeFile } = await import('node:fs/promises');
    await writeFile(alertedSentinel, today);
  } catch { /* non-fatal */ }
}

/**
 * Reap orphaned cycle_runs. Any row in status='running' with started_at older
 * than 2 hours is, in practice, a row whose cycle process died without
 * updating the end_at (Mac slept mid-cycle, OOM, kill -9, etc). The dashboard
 * Live Runs panel reads `status='running'` straight from this table, so stuck
 * rows render as fake live cycles forever. Flipping them to "failed" keeps
 * the UI honest and surfaces a HUMAN-ONLY alert exactly once per reap event.
 */
async function reapOrphanedRuns(): Promise<void> {
  const cutoff = new Date(Date.now() - 2 * 3_600_000).toISOString();
  const { data, error } = await supabase
    .from('cycle_runs')
    .update({
      status: 'failed',
      ended_at: new Date().toISOString(),
      error_text: 'Auto-reaped: row was status=running for >2 h. The cycle process died without updating end_at (likely Mac slept mid-run, OOM, or process killed).',
    })
    .eq('status', 'running')
    .lt('started_at', cutoff)
    .select('id');

  if (error) {
    console.error('[scheduler_tick] reaper failed:', error.message);
    return;
  }

  if (data && data.length > 0) {
    console.log(`[scheduler_tick] reaped ${data.length} orphaned cycle_run(s)`);
    const synthetic = new Error(`Reaped ${data.length} orphaned cycle_runs (older than 2h)`);
    try {
      const classified = classifyError(synthetic, { source: 'local' });
      await logClassified(classified, { handled: 'pending' });
      await maybeNotify(classified);
    } catch { /* non-fatal */ }
  }
}

async function main() {
  const repoDir = resolve(__dirname, '..');
  // Liveness probes BEFORE the supabase reads so a Supabase outage doesn't
  // mask stale-pipeline alerts. All non-fatal — never block the actual tick.
  try { await probeRefreshFreshness(repoDir); } catch (err) {
    console.error('[scheduler_tick] freshness probe failed:', err);
  }
  try { await probeAutoresearchFreshness(repoDir); } catch (err) {
    console.error('[scheduler_tick] autoresearch probe failed:', err);
  }
  // Reap orphaned cycle_runs so the dashboard's Live Runs panel doesn't
  // show 4-day-old "running" rows. Cheap query (indexed on status+started_at).
  try { await reapOrphanedRuns(); } catch (err) {
    console.error('[scheduler_tick] reaper failed:', err);
  }

  const { data: settings, error: settingsErr } = await supabase
    .from('schedule_settings')
    .select('enabled, timezone')
    .eq('id', 1)
    .single<ScheduleSettings>();

  if (settingsErr || !settings) {
    // Route the error through the auto-fix classifier so transient network
    // blips (TypeError: fetch failed) are catalogued + dedup-notified instead
    // of accumulating silently in scheduler-tick.err on every 5-min tick.
    const msg = settingsErr?.message || 'could not read schedule_settings';
    const synthetic = new Error(`[scheduler_tick] ${msg}`);
    try {
      const classified = classifyError(synthetic, { source: 'local' });
      await logClassified(classified, { handled: 'pending' });
      await maybeNotify(classified);
    } catch { /* non-fatal */ }
    console.error('[scheduler_tick] could not read schedule_settings:', msg);
    process.exit(2);
  }

  if (!settings.enabled) {
    console.log('[scheduler_tick] master scheduler disabled — exiting');
    return;
  }

  const tz = settings.timezone || 'UTC';
  const { date: today, minutes: nowMin } = nowInTimezone(tz);

  const { data: batches, error: batchesErr } = await supabase
    .from('cycle_batches')
    .select('*')
    .eq('enabled', true)
    .order('order_index', { ascending: true })
    .returns<CycleBatch[]>();

  if (batchesErr || !batches) {
    // Same auto-fix routing as the schedule_settings read above — a transient
    // fetch failure here would otherwise just print to err on every 5-min tick
    // forever without ever surfacing to the human.
    const msg = batchesErr?.message || 'could not read cycle_batches';
    const synthetic = new Error(`[scheduler_tick] ${msg}`);
    try {
      const classified = classifyError(synthetic, { source: 'local' });
      await logClassified(classified, { handled: 'pending' });
      await maybeNotify(classified);
    } catch { /* non-fatal */ }
    console.error('[scheduler_tick] could not read cycle_batches:', msg);
    process.exit(2);
  }

  if (batches.length === 0) {
    console.log('[scheduler_tick] no enabled batches — nothing to do');
    return;
  }

  let fired = 0;
  for (const batch of batches) {
    if (batch.last_run_date === today) {
      console.log(`[scheduler_tick] skip "${batch.label}" — ran today`);
      continue;
    }
    const targetMin = targetMinutes(batch.run_time);
    if (nowMin < targetMin) {
      console.log(`[scheduler_tick] skip "${batch.label}" — not yet (now=${nowMin}, target=${targetMin})`);
      continue;
    }

    // Strict-window guard: only fire within CATCH_UP_WINDOW_MIN of the
    // target time. If the Mac was asleep through the entire window, skip
    // and try again tomorrow. This prevents "8 hours late" surprises like
    // an 08:00 batch firing at 17:00 because the prior catch-up logic was
    // unbounded. The window is generous enough to absorb typical Mac
    // sleep/wake delays but strict enough that the run_time has real
    // semantic meaning.
    const CATCH_UP_WINDOW_MIN = 60;
    if (nowMin > targetMin + CATCH_UP_WINDOW_MIN) {
      console.log(`[scheduler_tick] skip "${batch.label}" — past catch-up window (now=${nowMin}, target=${targetMin}, window=${CATCH_UP_WINDOW_MIN} min). Will fire tomorrow.`);
      continue;
    }

    // New-batch guard: if the batch was created today AFTER its run_time,
    // the user meant "fire tomorrow" not "catch up immediately."
    const createdParts = nowInTimezoneFromIso(batch.created_at, tz);
    if (createdParts.date === today && createdParts.minutes > targetMin) {
      console.log(`[scheduler_tick] skip "${batch.label}" — created today after run_time; will fire tomorrow`);
      continue;
    }

    try {
      await fireBatch(batch, today);
      fired++;
    } catch (err) {
      console.error(`[scheduler_tick] fire failed for "${batch.label}":`, err);
    }
  }

  console.log(`[scheduler_tick] done — fired ${fired} batch(es), checked ${batches.length}`);
}

main().catch(err => {
  console.error('[scheduler_tick] unexpected error:', err);
  process.exit(1);
});
