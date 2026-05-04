/**
 * Cycle reporter — writes live status of an in-flight cycle to Supabase so the
 * dashboard can show milestones in real time.
 *
 * Usage from main.ts:
 *   const runId = await startCycleRun({ flows, accounts, path, caller });
 *   await reportEvent(runId, 'phase_done', 'Analytics', '127 posts measured');
 *   await reportEvent(runId, 'post_submitted', '@yournotetaker', 'postId abc123', { account: 'yournotetaker', flow: 'photorealistic' });
 *   await endCycleRun(runId, 'completed');
 *
 * All functions swallow Supabase errors silently — telemetry should NEVER take
 * down the cycle. If the DB is down, the cycle still posts.
 */

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

let client: SupabaseClient | null = null;

function getClient(): SupabaseClient | null {
  if (client) return client;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  client = createClient(url, key);
  return client;
}

export type EventKind =
  | 'cycle_start'
  | 'phase_start'
  | 'phase_done'
  | 'flow_start'
  | 'post_generated'
  | 'post_submitted'
  | 'post_failed'
  | 'info'
  | 'error'
  | 'cycle_done';

export interface StartCycleArgs {
  flows: string[];
  accounts: string[];
  path: string;
  postsTotal: number;
  caller?: string;
}

export interface EventMeta {
  account?: string;
  flow?: string;
  metadata?: Record<string, unknown>;
}

/** Insert a new cycle_runs row in 'running' state. Returns the run id. */
export async function startCycleRun(args: StartCycleArgs): Promise<string | null> {
  const supabase = getClient();
  if (!supabase) return null;
  try {
    const { data, error } = await supabase
      .from('cycle_runs')
      .insert({
        caller: args.caller ?? 'manual',
        flows: args.flows,
        accounts: args.accounts,
        path: args.path,
        posts_total: args.postsTotal,
        status: 'running',
        current_phase: 'starting',
      })
      .select('id')
      .single();
    if (error || !data) return null;
    return data.id as string;
  } catch {
    return null;
  }
}

/** Append an event to the run's timeline. */
export async function reportEvent(
  runId: string | null,
  kind: EventKind,
  label: string,
  message?: string,
  meta?: EventMeta,
): Promise<void> {
  if (!runId) return;
  const supabase = getClient();
  if (!supabase) return;
  try {
    await supabase.from('cycle_events').insert({
      cycle_run_id: runId,
      kind,
      label,
      message: message ?? null,
      account: meta?.account ?? null,
      flow: meta?.flow ?? null,
      metadata: meta?.metadata ?? null,
    });
  } catch {
    // swallow
  }
}

/** Update the current phase indicator on the run. */
export async function setCurrentPhase(runId: string | null, phase: string): Promise<void> {
  if (!runId) return;
  const supabase = getClient();
  if (!supabase) return;
  try {
    await supabase.from('cycle_runs').update({ current_phase: phase }).eq('id', runId);
  } catch {
    // swallow
  }
}

/** Bump posts_done / posts_failed counters. */
export async function bumpPostCounters(
  runId: string | null,
  field: 'posts_done' | 'posts_failed',
  delta: number = 1,
): Promise<void> {
  if (!runId) return;
  const supabase = getClient();
  if (!supabase) return;
  try {
    // Fetch current value, bump, write. (PostgREST has no atomic increment via the JS client.)
    const { data } = await supabase
      .from('cycle_runs')
      .select(field)
      .eq('id', runId)
      .single();
    const current = (data as Record<string, number> | null)?.[field] ?? 0;
    await supabase
      .from('cycle_runs')
      .update({ [field]: current + delta })
      .eq('id', runId);
  } catch {
    // swallow
  }
}

/** Mark the run as terminal. */
export async function endCycleRun(
  runId: string | null,
  status: 'completed' | 'failed',
  errorText?: string,
): Promise<void> {
  if (!runId) return;
  const supabase = getClient();
  if (!supabase) return;
  try {
    await supabase
      .from('cycle_runs')
      .update({
        status,
        ended_at: new Date().toISOString(),
        current_phase: status === 'completed' ? 'done' : 'failed',
        error_text: errorText ?? null,
      })
      .eq('id', runId);
  } catch {
    // swallow
  }
}
