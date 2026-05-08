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
import { dataPath } from './lib/campaign-paths.js';

dotenvConfig({ path: '.env.local', override: true });

// Per-day sentinel — guards against double-running when launchd ticks the
// plist hourly. First successful run of the calendar day writes today's date
// here; subsequent ticks within the same day silent-exit.
//
// Resolved via dataPath() each call so multi-campaign cron loops can set the
// active campaign between iterations and each campaign gets its own sentinel
// (data/campaigns/<slug>/.last-autoresearch-run).
const sentinelPath = (): string => dataPath('.last-autoresearch-run');

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
    const last = (await readFile(sentinelPath(), 'utf-8')).trim();
    return last === todayLocal();
  } catch {
    return false;
  }
}

async function markRanToday(): Promise<void> {
  try {
    await writeFile(sentinelPath(), todayLocal() + '\n');
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
  action_type?: 'experiment' | 'strategy_fix';
  warnings?: string[];
  strategy_notes?: string;
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

async function askGemini(context: string, targetAccount: string): Promise<Decision | null> {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) return null;

  const prompt = buildPrompt(context, targetAccount);
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

function buildPrompt(context: string, targetAccount: string): string {
  return `You are the daily brain for a TikTok content automation system. Your job has TWO parts:

**Part 1 — Diagnose account health.** Read the per-account performance data below. Detect problems like:
- View crashes (>50% drop vs prior week) = possible shadow ban / suppression
- Overposting (>1.5 posts/day) = TikTok throttles spammy accounts
- Duplicate hashtag sets = TikTok flags as spam behavior
- An account stuck below 10 avg views = distribution suppressed

**Part 2 — Design today's experiment.** Based on the diagnosis, either:
(a) If an account is HEALTHY → pick the least-tested A/B variable for @${targetAccount}
(b) If @${targetAccount} is SUPPRESSED/unhealthy → set action_type to "strategy_fix" and describe what must change

# Variable priority queue (for healthy accounts)
\`\`\`json
${JSON.stringify(VARIABLE_QUEUE, null, 2)}
\`\`\`

# Hard rules
- "account" MUST equal: ${targetAccount}
- "variable" MUST be one of the keys above (still required even for strategy_fix)
- "variant_a" and "variant_b" MUST be different values from that variable's array
- "flow" MUST be one of: photorealistic, animated, emoji_overlay

# Context
${context}

# Output schema
Reply ONLY with this exact JSON shape:
{
  "variable": "hook_style",
  "variant_a": "question",
  "variant_b": "bold_claim",
  "account": "${targetAccount}",
  "flow": "animated",
  "hypothesis": "<one sentence: why this experiment matters>",
  "action_type": "experiment" | "strategy_fix",
  "warnings": ["<list any account health issues detected, e.g. suppression, overposting, duplicate hashtags>"],
  "strategy_notes": "<if action_type=strategy_fix: specific concrete actions needed, e.g. pause posting 7 days, fix hashtag rotation, reduce to 1 post/day>"
}

If action_type is "strategy_fix", the variable/variant fields still MUST be valid (they represent the next experiment AFTER the fix is applied).`;
}

// ─── Pick today's target account by deterministic rotation ────
// Picks one account per calendar day so research focus rotates fairly across
// the roster instead of letting Gemini pile up consecutive days on the same
// account. The day index is days-since-epoch, which advances exactly once per
// midnight UTC. Within a day every invocation returns the same account.
function pickTodaysAccount(activeHandles: string[]): string | null {
  if (activeHandles.length === 0) return null;
  const dayIdx = Math.floor(Date.now() / 86_400_000);
  return activeHandles[dayIdx % activeHandles.length];
}

// ─── Phase 3 (fallback): deterministic decision ────────────────

function deterministicFallback(
  activeHandles: string[],
  history: ExperimentSnapshot[],
  targetAccount: string,
): Decision | null {
  if (activeHandles.length === 0) return null;
  const account = targetAccount;

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

  const action_type = String(d.action_type ?? 'experiment').trim() as 'experiment' | 'strategy_fix';
  const warnings = Array.isArray(d.warnings) ? (d.warnings as unknown[]).map(String) : [];
  const strategy_notes = d.strategy_notes ? String(d.strategy_notes).trim() : undefined;

  return { variable, variant_a, variant_b, account, flow, hypothesis, source: 'gemini', action_type, warnings, strategy_notes, raw };
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
    const tsv = await readFile(dataPath('results.tsv'), 'utf-8');
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
    return (await readFile(dataPath('FORMAT-WINNERS.md'), 'utf-8')).slice(0, 2_000);
  } catch {
    return '(FORMAT-WINNERS.md not found)';
  }
}

// ─── Account health context ─────────────────────────────────────
// Parses POST-TRACKER.md and builds a per-account performance summary
// covering the last 14 days. Gemini needs this to detect suppression,
// posting frequency abuse, and view trend direction.

interface PostRow {
  date: string;
  account: string;
  views: number | null;
  hook: string;
  hashtags: string;
}

async function buildAccountHealthContext(activeHandles: string[]): Promise<string> {
  let md: string;
  try {
    md = await readFile(dataPath('POST-TRACKER.md'), 'utf-8');
  } catch {
    return '(POST-TRACKER.md not found — no account health data)';
  }

  const rows: PostRow[] = [];
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 14);

  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue;
    if (line.includes('---') || /\|\s*Post ID\s*\|/i.test(line)) continue;
    const cols = line.split('|').map(c => c.trim()).filter(Boolean);
    if (cols.length < 11) continue;

    // cols: [postId, date, hook, slides, hashtags, views, likes, saves, comments, shares, saveRate, status, url?]
    const date = cols[1] ?? '';
    const hook = cols[2] ?? '';
    const hashtags = cols[4] ?? '';
    const viewsRaw = cols[5] ?? '';
    const statusAndUrl = (cols[11] ?? '') + ' ' + (cols[12] ?? '');

    if (!date.match(/^\d{4}-\d{2}-\d{2}/)) continue;
    if (new Date(date) < cutoff) continue;

    // Extract account from status/url field
    let account = '';
    const handleMatch = statusAndUrl.match(/@([\w.]+)/);
    if (handleMatch) account = handleMatch[1];
    if (!account) continue;

    const views = viewsRaw === '-' || viewsRaw === '' ? null : parseInt(viewsRaw);
    rows.push({ date, account, views, hook, hashtags });
  }

  if (rows.length === 0) return '(No posts in last 14 days)';

  // Build per-account summary
  const lines: string[] = ['## Per-Account Performance (last 14 days)\n'];

  for (const handle of activeHandles) {
    const accountRows = rows.filter(r => r.account === handle);
    if (accountRows.length === 0) {
      lines.push(`### @${handle}\n  No posts in last 14 days.\n`);
      continue;
    }

    const withViews = accountRows.filter(r => r.views !== null);
    const recentRows = accountRows.slice(-14); // last 14 posts

    // Split into two 7-day windows
    const now = Date.now();
    const sevenDays = 7 * 86_400_000;
    const last7 = withViews.filter(r => now - new Date(r.date).getTime() < sevenDays);
    const prev7 = withViews.filter(r => {
      const age = now - new Date(r.date).getTime();
      return age >= sevenDays && age < sevenDays * 2;
    });

    const avg = (arr: PostRow[]) =>
      arr.length === 0 ? null : Math.round(arr.reduce((s, r) => s + (r.views ?? 0), 0) / arr.length);

    const avgLast7 = avg(last7);
    const avgPrev7 = avg(prev7);

    let trend = 'unknown';
    if (avgLast7 !== null && avgPrev7 !== null) {
      const pct = ((avgLast7 - avgPrev7) / Math.max(avgPrev7, 1)) * 100;
      if (pct < -50) trend = `CRASHED (${Math.round(pct)}% drop)`;
      else if (pct < -20) trend = `declining (${Math.round(pct)}%)`;
      else if (pct > 20) trend = `growing (+${Math.round(pct)}%)`;
      else trend = 'stable';
    }

    // Posting frequency
    const postsLast7Days = accountRows.filter(r => now - new Date(r.date).getTime() < sevenDays).length;
    const postsPerDay = (postsLast7Days / 7).toFixed(1);

    // Hashtag diversity — count unique hashtag sets in last 10 posts
    const last10HashtagSets = recentRows.slice(-10).map(r => r.hashtags.trim());
    const uniqueSets = new Set(last10HashtagSets).size;
    const hashtagDiversity = last10HashtagSets.length > 0
      ? `${uniqueSets}/${last10HashtagSets.length} unique sets (${uniqueSets === 1 ? 'IDENTICAL - spam risk' : uniqueSets < 3 ? 'low variety' : 'good variety'})`
      : 'no data';

    // Recent post list (last 7)
    const recentList = recentRows.slice(-7).map(r =>
      `    ${r.date} | ${r.hook} | ${r.views !== null ? r.views + ' views' : 'no data'}`
    ).join('\n');

    lines.push([
      `### @${handle}`,
      `  Posts last 7 days: ${postsLast7Days} (${postsPerDay}/day)`,
      `  Avg views last 7 days: ${avgLast7 ?? 'no data'}`,
      `  Avg views prev 7 days: ${avgPrev7 ?? 'no data'}`,
      `  Trend: ${trend}`,
      `  Hashtag diversity: ${hashtagDiversity}`,
      `  Recent posts:`,
      recentList,
      '',
    ].join('\n'));
  }

  return lines.join('\n');
}

// Parse the "Format Rankings" markdown table from FORMAT-WINNERS.md
// into a structured list of the top 6 hooks.
async function readTopHooksSnapshot(): Promise<unknown[] | null> {
  try {
    const md = await readFile(dataPath('FORMAT-WINNERS.md'), 'utf-8');
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
    const md = await readFile(dataPath('HASHTAG-BANK.md'), 'utf-8');
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
    const md = await readFile(dataPath('TRENDING-NOW.md'), 'utf-8');
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

  const accountHealth = await buildAccountHealthContext(activeHandles);

  const context = [
    `Active accounts: ${activeHandles.join(', ')}`,
    '',
    accountHealth,
    '',
    `Recent experiments (last ${history.length}):`,
    history.length === 0
      ? '(none)'
      : history.slice(0, 20).map(h => `  ${h.date} · @${h.account} · ${h.variable}`).join('\n'),
    '',
    'Format winners (top of FORMAT-WINNERS.md):',
    winners,
  ].join('\n');

  // Code picks today's target account by rotation; Gemini's job is just
  // to pick the variable + variants for THAT account. This guarantees fair
  // coverage across the roster and prevents Gemini from camping on one
  // account run after run.
  const targetAccount = pickTodaysAccount(activeHandles);
  if (!targetAccount) {
    log('[autoresearch] no active accounts — cannot pick target');
    return;
  }
  log(`[autoresearch] today's target account (rotation): @${targetAccount}`);

  let decision = await askGemini(context, targetAccount);

  if (!decision) {
    log('[autoresearch] Gemini path failed/invalid — using deterministic fallback');
    decision = deterministicFallback(activeHandles, history, targetAccount);
  } else if (decision.account !== targetAccount) {
    log(`[autoresearch] Gemini ignored target account (returned ${decision.account}, wanted ${targetAccount}) — overriding to ${targetAccount}`);
    decision = { ...decision, account: targetAccount };
  } else if (!activeHandles.includes(decision.account)) {
    log(`[autoresearch] Gemini picked unknown account "${decision.account}" — using fallback`);
    decision = deterministicFallback(activeHandles, history, targetAccount);
  }

  if (!decision) {
    log('[autoresearch] no decision possible — exiting');
    return;
  }

  log(`[autoresearch] decision (${decision.source}): ${decision.variable} | @${decision.account} | ${decision.variant_a} vs ${decision.variant_b}`);
  log(`[autoresearch] hypothesis: ${decision.hypothesis}`);
  if (decision.action_type === 'strategy_fix') {
    log(`[autoresearch] ⚠️  STRATEGY FIX NEEDED: ${decision.strategy_notes}`);
  }
  if (decision.warnings && decision.warnings.length > 0) {
    for (const w of decision.warnings) log(`[autoresearch] ⚠️  ${w}`);
  }

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
      action_type: decision.action_type ?? 'experiment',
      warnings: decision.warnings ?? [],
      strategy_notes: decision.strategy_notes ?? null,
      notes: [
        'Decision recorded; tonight\'s scheduled batches will reflect updated playbook.',
        ...(decision.warnings && decision.warnings.length > 0 ? [`Warnings: ${decision.warnings.join(' | ')}`] : []),
        ...(decision.strategy_notes ? [`Strategy fix needed: ${decision.strategy_notes}`] : []),
      ].join('\n'),
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
