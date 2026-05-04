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
import { config as dotenvConfig } from 'dotenv';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

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
  enabled: boolean;
  last_run_date: string | null;
}

function nowInTimezone(tz: string): { date: string; minutes: number } {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(new Date()).map(p => [p.type, p.value]));
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  const minutes = parseInt(parts.hour, 10) * 60 + parseInt(parts.minute, 10);
  return { date, minutes };
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

function buildBatchArgs(batch: CycleBatch): string[] {
  const args: string[] = ['run', 'cycle', '--'];
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
  return args;
}

async function fireBatch(batch: CycleBatch, today: string): Promise<void> {
  const args = buildBatchArgs(batch);
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

async function main() {
  const { data: settings, error: settingsErr } = await supabase
    .from('schedule_settings')
    .select('enabled, timezone')
    .eq('id', 1)
    .single<ScheduleSettings>();

  if (settingsErr || !settings) {
    console.error('[scheduler_tick] could not read schedule_settings:', settingsErr?.message);
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
    console.error('[scheduler_tick] could not read cycle_batches:', batchesErr?.message);
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
