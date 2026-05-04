/**
 * Autoresearch — autonomous experiment design loop.
 *
 * Replaces the Claude /loop pattern with a Node.js script that:
 *   1. (measure)     calls measurePerformance()  — pulls metrics from ScrapeCreators
 *   2. (evaluate)    calls optimize()             — declares winners, updates rankings
 *   3. (hypothesize) asks Gemini "what should we test next?" — single API call
 *   4. (post)        inserts 2 cycle_jobs        — variant A + variant B for SAME account
 *   5. (logs)        writes the decision to autoresearch_runs
 *
 * launchd fires this once per day. cycle_jobs_poller picks up the inserted
 * jobs within 60s and the cycle_runs telemetry shows progress on /runs.
 *
 * Quality safeguards (defense in depth):
 *   • Gemini's output is constrained by JSON schema in the prompt
 *   • Code validates: variable in priority queue, account in active accounts,
 *     variants different, flow valid
 *   • If Gemini fails or output is invalid, we use a deterministic fallback
 *     (pick least-tested variable + first untested variant for that variable)
 *   • If everything fails, we exit cleanly without inserting bad jobs
 */

import { readFile } from 'node:fs/promises';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ path: '.env.local', override: true });

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/config.js';
import { loadAccountsIntoConfig } from './account_loader.js';
import { measurePerformance } from './pull_analytics.js';
import { optimize } from './optimizer.js';
import { log } from './api-client.js';

// ─── Types ────────────────────────────────────────────────────

type FlowName = 'photorealistic' | 'animated' | 'emoji_overlay';

interface Decision {
  variable: string;
  variant_a: string;
  variant_b: string;
  account: string;          // handle
  flow: FlowName;
  hypothesis: string;
  source: 'gemini' | 'fallback';
  raw?: unknown;
}

// Variable priority queue (program.md §"Variable priority queue").
// We test in this order, picking the LEAST tested for the chosen account.
const VARIABLE_QUEUE: Record<string, string[]> = {
  hook_style:      ['question', 'bold_claim', 'story_opener', 'stat_lead', 'contrast'],
  slide_count:     ['5', '6', '8', '9'],
  flow_type:       ['photorealistic', 'animated', 'emoji_overlay'],
  animation_style: ['Pixar 3D', 'Anime', 'Stop Motion', 'Watercolor', 'Pop Art'],
  posting_time:    ['08:00', '14:00', '20:00', '00:00'],
  hashtag_strategy:['tier1_heavy', 'tier3_heavy'],
  cta_style:       ['save_for_later', 'tag_a_friend', 'follow_for_more'],
  caption_length:  ['short', 'long'],
};

const DEFAULT_FLOW: FlowName = 'photorealistic';

// ─── Supabase ──────────────────────────────────────────────────

function getSupabase(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

// ─── Phase 3: ask Gemini for a decision ───────────────────────

async function askGemini(context: string): Promise<Decision | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = buildPrompt(context);
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.4,
          responseMimeType: 'application/json',
        },
      }),
    });
    if (!res.ok) {
      log(`[autoresearch] Gemini HTTP ${res.status}: ${await res.text()}`);
      return null;
    }
    const data = await res.json();
    const text: string = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    if (!text) {
      log('[autoresearch] Gemini returned empty content');
      return null;
    }
    const parsed = JSON.parse(text);
    return validateDecision(parsed, parsed);
  } catch (err) {
    log(`[autoresearch] Gemini call failed: ${err}`);
    return null;
  }
}

function buildPrompt(context: string): string {
  return `You are an A/B-test designer for a TikTok content automation system.

Your job: pick the next experiment to run. Reply ONLY as JSON.

# Variable priority queue
Pick the LEAST-tested variable for the chosen account. Within that variable, pick two variants that haven't been compared head-to-head before.

\`\`\`json
${JSON.stringify(VARIABLE_QUEUE, null, 2)}
\`\`\`

# Hard rules
- Both variants MUST go to the SAME account.
- The "variable" field MUST be one of the keys in the priority queue above.
- "variant_a" and "variant_b" MUST both come from the variants array for that variable.
- "variant_a" and "variant_b" MUST be different.
- "flow" MUST be one of: photorealistic, animated, emoji_overlay.
- "account" MUST be one of the active accounts listed below.

# Context
${context}

# Output
Reply with this exact JSON shape:
{
  "variable": "hook_style",
  "variant_a": "question",
  "variant_b": "bold_claim",
  "account": "<handle from active accounts>",
  "flow": "photorealistic",
  "hypothesis": "<one sentence: why this experiment matters>"
}`;
}

// ─── Phase 3 (fallback): deterministic decision ────────────────

function deterministicFallback(activeHandles: string[], history: ExperimentSnapshot[]): Decision | null {
  if (activeHandles.length === 0) return null;

  // Rotate accounts day-by-day so we don't always pick the same one.
  const dayIdx = Math.floor(Date.now() / 86_400_000);
  const account = activeHandles[dayIdx % activeHandles.length];

  // Count experiments per (account, variable) and pick the least-tested for THIS account.
  const counts: Record<string, number> = {};
  for (const v of Object.keys(VARIABLE_QUEUE)) counts[v] = 0;
  for (const h of history) {
    if (h.account !== account) continue;
    if (counts[h.variable] !== undefined) counts[h.variable]++;
  }
  const sorted = Object.entries(counts).sort((a, b) => a[1] - b[1]);
  const variable = sorted[0]?.[0];
  if (!variable) return null;

  const options = VARIABLE_QUEUE[variable];
  if (!options || options.length < 2) return null;

  return {
    variable,
    variant_a: options[0],
    variant_b: options[1],
    account,
    flow: DEFAULT_FLOW,
    hypothesis: `Fallback: ${variable} least-tested for @${account} (${counts[variable]} prior). Comparing ${options[0]} vs ${options[1]}.`,
    source: 'fallback',
  };
}

// ─── Validation ────────────────────────────────────────────────

function validateDecision(d: Record<string, unknown>, raw: unknown): Decision | null {
  const variable = String(d.variable ?? '').trim();
  const variant_a = String(d.variant_a ?? '').trim();
  const variant_b = String(d.variant_b ?? '').trim();
  const account = String(d.account ?? '').trim().replace(/^@/, '');
  const flow = String(d.flow ?? '').trim() as FlowName;
  const hypothesis = String(d.hypothesis ?? '').trim();

  if (!VARIABLE_QUEUE[variable]) return null;
  if (!VARIABLE_QUEUE[variable].includes(variant_a)) return null;
  if (!VARIABLE_QUEUE[variable].includes(variant_b)) return null;
  if (variant_a === variant_b) return null;
  if (!['photorealistic', 'animated', 'emoji_overlay'].includes(flow)) return null;
  if (!account) return null;
  if (!hypothesis) return null;

  return { variable, variant_a, variant_b, account, flow, hypothesis, source: 'gemini', raw };
}

// ─── Read recent experiment history ────────────────────────────

interface ExperimentSnapshot {
  id: string;
  date: string;
  account: string;
  variable: string;
}

async function readHistory(supabase: SupabaseClient | null): Promise<ExperimentSnapshot[]> {
  // Prefer Supabase (it's authoritative); fall back to results.tsv if unreachable.
  if (supabase) {
    const { data, error } = await supabase
      .from('experiments')
      .select('id, date, account, variable')
      .order('date', { ascending: false })
      .limit(40);
    if (!error && data) {
      return (data as ExperimentSnapshot[]).filter(r => r.account && r.variable);
    }
  }
  try {
    const tsv = await readFile('data/results.tsv', 'utf-8');
    const lines = tsv.split('\n').slice(1).filter(Boolean);
    return lines.slice(-40).map(line => {
      const cols = line.split('\t');
      return {
        id: cols[0] ?? '',
        date: cols[1] ?? '',
        account: cols[2] ?? '',
        variable: cols[3] ?? '',
      };
    }).filter(r => r.account && r.variable);
  } catch {
    return [];
  }
}

async function readFormatWinners(): Promise<string> {
  try {
    return (await readFile('data/FORMAT-WINNERS.md', 'utf-8')).slice(0, 2_000);
  } catch {
    return '(FORMAT-WINNERS.md not found)';
  }
}

// ─── Phase 4: insert two cycle_jobs ────────────────────────────

async function insertExperimentJobs(
  supabase: SupabaseClient,
  decision: Decision,
  runId: string,
): Promise<{ jobA?: string; jobB?: string }> {
  const baseLabel = `exp ${decision.variable} · @${decision.account}`;
  const insertOne = async (variant: string, suffix: 'A' | 'B') => {
    const { data, error } = await supabase
      .from('cycle_jobs')
      .insert({
        label: `${baseLabel} · ${suffix} (${variant})`,
        flows: [decision.flow],
        path: 'draft',                // experiments default to drafts; manager can publish manually
        account_handles: [decision.account],
        posts_per_account: 1,
        skip_research: true,          // research already done in phase 1
        schedule_offset_hours: 0,
      })
      .select('id')
      .single();
    if (error || !data) {
      log(`[autoresearch] cycle_jobs insert failed (${suffix}): ${error?.message}`);
      return undefined;
    }
    return data.id as string;
  };
  const jobA = await insertOne(decision.variant_a, 'A');
  const jobB = await insertOne(decision.variant_b, 'B');
  await supabase.from('autoresearch_runs').update({
    cycle_job_a: jobA ?? null,
    cycle_job_b: jobB ?? null,
  }).eq('id', runId);
  return { jobA, jobB };
}

// ─── Main loop body ────────────────────────────────────────────

async function run() {
  log('═══ AUTORESEARCH START ═══');

  // Pull dashboard-managed accounts so account list is current.
  await loadAccountsIntoConfig();
  const activeHandles = config.tiktokAccounts.map(a => a.handle);
  if (activeHandles.length === 0) {
    log('[autoresearch] no active accounts — exiting');
    return;
  }

  // Phase 1: MEASURE
  log('[autoresearch] phase 1: measure');
  try {
    const measured = await measurePerformance();
    log(`[autoresearch] phase 1 done — ${measured.length} posts measured`);
  } catch (err) {
    log(`[autoresearch] phase 1 failed (non-fatal): ${err}`);
  }

  // Phase 2: EVALUATE (optimizer declares winners + updates rankings)
  log('[autoresearch] phase 2: evaluate');
  try {
    await optimize();
    log('[autoresearch] phase 2 done');
  } catch (err) {
    log(`[autoresearch] phase 2 failed (non-fatal): ${err}`);
  }

  // Phase 3: HYPOTHESIZE
  log('[autoresearch] phase 3: hypothesize');
  const supabase = getSupabase();
  const history = await readHistory(supabase);
  const winners = await readFormatWinners();

  const context = [
    `Active accounts: ${activeHandles.join(', ')}`,
    '',
    `Recent experiments (last ${history.length}):`,
    history.length === 0
      ? '(none)'
      : history.slice(0, 20).map(h => `  ${h.date} · @${h.account} · ${h.variable}`).join('\n'),
    '',
    'Format winners (top of FORMAT-WINNERS.md):',
    winners,
  ].join('\n');

  let decision = await askGemini(context);

  if (!decision) {
    log('[autoresearch] Gemini path failed/invalid — using deterministic fallback');
    decision = deterministicFallback(activeHandles, history);
  } else if (!activeHandles.includes(decision.account)) {
    log(`[autoresearch] Gemini picked unknown account "${decision.account}" — using fallback`);
    decision = deterministicFallback(activeHandles, history);
  }

  if (!decision) {
    log('[autoresearch] no decision possible — exiting');
    return;
  }

  log(`[autoresearch] decision (${decision.source}): ${decision.variable} | @${decision.account} | ${decision.variant_a} vs ${decision.variant_b}`);
  log(`[autoresearch] hypothesis: ${decision.hypothesis}`);

  if (!supabase) {
    log('[autoresearch] no Supabase — cannot persist or fire jobs');
    return;
  }

  // Persist the decision
  const { data: runRow, error: runErr } = await supabase
    .from('autoresearch_runs')
    .insert({
      variable: decision.variable,
      variant_a: decision.variant_a,
      variant_b: decision.variant_b,
      account: decision.account,
      flow: decision.flow,
      hypothesis: decision.hypothesis,
      source: decision.source,
      decision_json: decision.raw ?? null,
      outcome: 'pending',
    })
    .select('id')
    .single();
  if (runErr || !runRow) {
    log(`[autoresearch] could not write run row: ${runErr?.message}`);
    return;
  }
  const runId = runRow.id as string;
  log(`[autoresearch] autoresearch_runs id=${runId}`);

  // Phase 4: queue the two experiment jobs
  log('[autoresearch] phase 4: queueing experiment jobs');
  const { jobA, jobB } = await insertExperimentJobs(supabase, decision, runId);
  if (!jobA || !jobB) {
    log('[autoresearch] one or both jobs failed to insert');
    await supabase.from('autoresearch_runs').update({
      outcome: 'cancelled',
      notes: `partial insert: jobA=${jobA ?? 'fail'} jobB=${jobB ?? 'fail'}`,
    }).eq('id', runId);
    return;
  }
  log(`[autoresearch] jobs queued: A=${jobA} B=${jobB}`);
  log('═══ AUTORESEARCH DONE ═══');
}

run().catch(err => {
  console.error('[autoresearch] unexpected:', err);
  process.exit(1);
});
