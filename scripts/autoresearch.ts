/**
 * Autoresearch — daily playbook updater (no posting).
 *
 * Runs once per day via launchd at 08:30. Acts as the system's "morning
 * brain": measures yesterday's posts, declares winners, refreshes trend
 * data + hashtag bank, and asks Gemini what experiment to design for the
 * next day. Writes the decision to autoresearch_runs for the dashboard
 * to display.
 *
 * What it does NOT do: post anything. The dashboard-managed scheduled
 * batches (and the manual "Run Cycle Now" button) remain the ONLY paths
 * that trigger cycles. They will automatically pick up today's refreshed
 * playbook (FORMAT-WINNERS.md, HASHTAG-BANK.md, TRENDING-NOW.md) when
 * they fire later in the day, because text_overlay.ts and generate_images.ts
 * read those files at runtime.
 *
 * Phases:
 *   1. measure       — pull_analytics.measurePerformance() (POST-TRACKER, ACCOUNT-STATS)
 *   2. evaluate      — optimizer.optimize() (FORMAT-WINNERS, LESSONS-LEARNED, EXPERIMENT-LOG)
 *   2b. refresh      — fetch_trends.runResearch() (TRENDING-NOW, HASHTAG-BANK)
 *   3. hypothesize   — Gemini designs the next experiment
 *   4. log decision  — autoresearch_runs row (visible on /autoresearch)
 *
 * Quality safeguards on the Gemini decision:
 *   • Output constrained by JSON schema in the prompt
 *   • Code validates: variable in priority queue, account in active accounts,
 *     variants different, flow valid
 *   • Deterministic fallback if Gemini fails or output is invalid
 */

import { readFile, writeFile } from 'node:fs/promises';
import { config as dotenvConfig } from 'dotenv';

dotenvConfig({ path: '.env.local', override: true });

// Per-day sentinel — guards against double-running when launchd ticks the
// plist hourly. First successful run of the calendar day writes today's date
// here; subsequent ticks within the same day silent-exit.
const SENTINEL_PATH = 'data/.last-autoresearch-run';

function todayLocal(): string {
  const d = new Date();
  // Local-date YYYY-MM-DD (not UTC) so "today" matches whichever calendar day
  // the operator perceives. launchd fires in local TZ.
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

async function alreadyRanToday(): Promise<boolean> {
  try {
    const last = (await readFile(SENTINEL_PATH, 'utf-8')).trim();
    return last === todayLocal();
  } catch {
    return false;
  }
}

async function markRanToday(): Promise<void> {
  try {
    await writeFile(SENTINEL_PATH, todayLocal() + '\n');
  } catch {
    // sentinel write failure is non-fatal — at worst we run twice today
  }
}

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from '../config/config.js';
import { loadAccountsIntoConfig } from './account_loader.js';
import { measurePerformance } from './pull_analytics.js';
import { optimize } from './optimizer.js';
import { runResearch } from './fetch_trends.js';
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

// Parse the "Format Rankings" markdown table from FORMAT-WINNERS.md
// into a structured list of the top 6 hooks.
async function readTopHooksSnapshot(): Promise<unknown[] | null> {
  try {
    const md = await readFile('data/FORMAT-WINNERS.md', 'utf-8');
    const out: { rank: number; hook: string; avg_views: number; avg_save_rate: number; posts: number; last_used: string | null }[] = [];
    const lines = md.split('\n');
    for (const line of lines) {
      const m = line.match(/^\|\s*(\d+)\s*\|\s*([^|]+)\s*\|\s*([\d.]+)\s*\|\s*([\d.]+)%\s*\|\s*(\d+)\s*\|\s*([^|]+?)\s*\|/);
      if (m) {
        out.push({
          rank: parseInt(m[1]),
          hook: m[2].trim(),
          avg_views: parseFloat(m[3]),
          avg_save_rate: parseFloat(m[4]),
          posts: parseInt(m[5]),
          last_used: m[6].trim() || null,
        });
      }
    }
    return out.slice(0, 8);
  } catch {
    return null;
  }
}

async function readTopHashtagsSnapshot(): Promise<unknown[] | null> {
  try {
    const md = await readFile('data/HASHTAG-BANK.md', 'utf-8');
    // HASHTAG-BANK.md uses `## Section` headers and Markdown tables with
    // columns like: | Hashtag | Video Count | Total Views | Avg Views | ...
    const out: { tag: string; tier: string; line: string }[] = [];
    let currentSection = '';
    for (const line of md.split('\n')) {
      const sectionMatch = line.match(/^##\s+(.+?)\s*$/);
      if (sectionMatch) { currentSection = sectionMatch[1].trim(); continue; }
      // Skip header row, divider row, and blank lines
      if (!line.startsWith('|')) continue;
      if (line.includes('---')) continue;
      if (/\|\s*Hashtag\s*\|/i.test(line)) continue;
      // Pull the first column = the tag name (no # prefix in source, add it)
      const cols = line.split('|').map(c => c.trim()).filter(Boolean);
      if (cols.length === 0) continue;
      const rawTag = cols[0];
      if (!rawTag || rawTag.startsWith('#---')) continue;
      const tag = rawTag.startsWith('#') ? rawTag : `#${rawTag}`;
      // Extra context = "12k avg views" if we can extract it
      const avgViews = cols[3] ?? '';
      out.push({
        tag,
        tier: currentSection || 'Hashtag Bank',
        line: avgViews ? `${avgViews} avg views` : '',
      });
      if (out.length >= 20) break;
    }
    return out;
  } catch {
    return null;
  }
}

async function readTrendingNowSnapshot(): Promise<unknown[] | null> {
  try {
    const md = await readFile('data/TRENDING-NOW.md', 'utf-8');
    const out: { topic: string }[] = [];
    for (const line of md.split('\n')) {
      const m = line.match(/^[-*]\s+(.+)$/);
      if (m) {
        out.push({ topic: m[1].trim() });
        if (out.length >= 12) break;
      }
    }
    return out;
  } catch {
    return null;
  }
}

// ─── Main loop body ────────────────────────────────────────────

async function run() {
  // Per-day guard: launchd ticks the plist hourly so any wake/boot during
  // the day picks up the work, but we only want to actually do the brain
  // work once per calendar day. Skip silently if today's already done.
  if (await alreadyRanToday()) {
    return;
  }

  log('═══ AUTORESEARCH START ═══');

  // Pull dashboard-managed accounts so account list is current.
  await loadAccountsIntoConfig();
  const activeHandles = config.tiktokAccounts.map(a => a.handle);
  if (activeHandles.length === 0) {
    log('[autoresearch] no active accounts — exiting');
    return;
  }

  // Capture per-phase telemetry so the dashboard can show "what the brain
  // learned today" without re-reading the markdown files.
  const phaseDurations: Record<string, number> = {};
  let postsMeasured = 0;
  let winnersDeclared = 0;
  let losersDropped = 0;

  // Phase 1: MEASURE
  log('[autoresearch] phase 1: measure');
  {
    const t0 = Date.now();
    try {
      const measured = await measurePerformance();
      postsMeasured = measured.length;
      log(`[autoresearch] phase 1 done — ${postsMeasured} posts measured`);
    } catch (err) {
      log(`[autoresearch] phase 1 failed (non-fatal): ${err}`);
    }
    phaseDurations.measure = Date.now() - t0;
  }

  // Phase 2: EVALUATE (optimizer declares winners + updates rankings)
  log('[autoresearch] phase 2: evaluate');
  {
    const t0 = Date.now();
    try {
      await optimize();
      // optimize() returns void today. Winner/loser counts will be derived
      // from EXPERIMENT-LOG diff in a future commit; for now leave them at 0.
      log('[autoresearch] phase 2 done');
    } catch (err) {
      log(`[autoresearch] phase 2 failed (non-fatal): ${err}`);
    }
    phaseDurations.optimize = Date.now() - t0;
  }

  // Phase 2b: REFRESH (Virlo trends + hashtag bank performance updates)
  log('[autoresearch] phase 2b: refresh trends + hashtag bank');
  {
    const t0 = Date.now();
    try {
      await runResearch();
      log('[autoresearch] phase 2b done — TRENDING-NOW + HASHTAG-BANK refreshed');
    } catch (err) {
      log(`[autoresearch] phase 2b failed (non-fatal): ${err}`);
    }
    phaseDurations.refresh = Date.now() - t0;
  }

  // Phase 3: HYPOTHESIZE
  log('[autoresearch] phase 3: hypothesize');
  const phase3Start = Date.now();
  const supabase = getSupabase();
  const history = await readHistory(supabase);
  const winners = await readFormatWinners();

  // Snapshot the playbook for the dashboard's brain log.
  const topHooks = await readTopHooksSnapshot();
  const topHashtags = await readTopHashtagsSnapshot();
  const trendingNow = await readTrendingNowSnapshot();

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
    log('[autoresearch] no Supabase — cannot persist decision');
    return;
  }

  // Persist the decision into autoresearch_runs.
  // NOTE: autoresearch is a pure brain. It updates the daily playbook (analytics,
  // optimizer winners, format rankings, hashtag bank, trends, next-experiment
  // hypothesis) but does NOT queue any cycle_jobs. The user wants posting to
  // remain solely under the dashboard's scheduled batches and the manual "Run
  // Cycle Now" button. Tonight's 19:00 batches automatically pick up today's
  // refreshed FORMAT-WINNERS / HASHTAG-BANK / TRENDING-NOW because text_overlay
  // and generate_images read those files at runtime — no extra plumbing needed.
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
      outcome: 'recorded',
      notes: 'Decision recorded; tonight\'s scheduled batches will reflect updated playbook (FORMAT-WINNERS, HASHTAG-BANK, TRENDING-NOW). No cycle_jobs queued.',
      // Snapshot what the brain learned today so the dashboard can render
      // it without re-parsing markdown later.
      posts_measured: postsMeasured,
      top_hooks: topHooks,
      top_hashtags: topHashtags,
      trending_now: trendingNow,
      winners_declared: winnersDeclared,
      losers_dropped: losersDropped,
      phase_durations_ms: { ...phaseDurations, hypothesize: Date.now() - phase3Start },
    })
    .select('id')
    .single();
  if (runErr || !runRow) {
    log(`[autoresearch] could not write run row: ${runErr?.message}`);
    return;
  }
  const runId = runRow.id as string;
  log(`[autoresearch] autoresearch_runs id=${runId}`);
  log('[autoresearch] decision recorded — scheduled batches will use the refreshed playbook tonight');
  await markRanToday();
  log('═══ AUTORESEARCH DONE ═══');
}

run().catch(err => {
  console.error('[autoresearch] unexpected:', err);
  process.exit(1);
});
