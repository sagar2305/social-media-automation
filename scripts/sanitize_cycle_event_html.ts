/**
 * One-off cleanup: replace HTML-blob error text in cycle_events.detail and
 * cycle_runs.error_text with the same compact summary api-client.ts now
 * produces going forward. Historical rows otherwise stay ugly forever
 * because the engine only sanitises on new writes.
 *
 * Usage:
 *   npx tsx scripts/sanitize_cycle_event_html.ts            # dry-run (default)
 *   npx tsx scripts/sanitize_cycle_event_html.ts --force    # apply updates
 *
 * Safe to re-run: rows that no longer start with '<' are skipped, so a
 * second pass is a no-op.
 */

import { config as dotenvConfig } from 'dotenv';
import { createClient } from '@supabase/supabase-js';

dotenvConfig({ path: '.env.local', override: true });

// Mirror of api-client.ts:summariseErrorBody. Duplicated rather than imported
// so this throwaway script doesn't widen the engine's public surface.
function summariseErrorBody(body: string): string {
  const trimmed = body.trim();
  if (!trimmed.startsWith('<')) {
    return trimmed.length > 500 ? `${trimmed.slice(0, 500)}…` : trimmed;
  }
  const title = trimmed
    .match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]
    ?.replace(/\s+/g, ' ').trim();
  const h1 = trimmed
    .match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]
    ?.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  const label = title || h1 || 'HTML response (no title)';
  return `${label} (HTML error page, ${trimmed.length} bytes)`;
}

/**
 * Detail strings written by main.ts and post_to_tiktok.ts use the pattern
 *   `${service} ${method} ${path} → ${status}: ${body}`
 * If the body part starts with '<' the entire string still starts with
 * something like 'blotato POST /posts → 403: <!DOCTYPE html>…'. Detect
 * either form and sanitise.
 */
function sanitise(detail: string): string | null {
  // Case 1: bare HTML body (no prefix).
  if (detail.trim().startsWith('<')) {
    return summariseErrorBody(detail);
  }
  // Case 2: standard prefix + HTML body separated by ': '.
  const m = detail.match(/^(.+?:\s)(<[\s\S]+)$/);
  if (m && m[2].trim().startsWith('<')) {
    return `${m[1]}${summariseErrorBody(m[2])}`;
  }
  return null;
}

interface Row { id: string | number; message: string | null; }
interface RunRow { id: string | number; error_text: string | null; }

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
    process.exit(1);
  }
  const sb = createClient(url, key);

  console.log(`Mode: ${force ? 'FORCE (will write)' : 'DRY-RUN (no writes)'}`);
  console.log('');

  // ─── cycle_events.message ─────────────────────────────────────
  console.log('Scanning cycle_events.message…');
  // Pull rows whose message contains '<' anywhere — narrower SQL filters
  // match too many legit cases; pull a wider set and filter in JS where
  // we can run the same regex the writer now uses.
  const { data: events, error: evErr } = await sb
    .from('cycle_events')
    .select('id, message')
    .ilike('message', '%<%')
    .limit(5000)
    .returns<Row[]>();
  if (evErr) { console.error(`cycle_events read failed: ${evErr.message}`); process.exit(1); }

  let evCandidates = 0;
  let evSampleShown = 0;
  const evUpdates: Array<{ id: string | number; message: string }> = [];
  for (const r of events ?? []) {
    if (!r.message) continue;
    const clean = sanitise(r.message);
    if (clean === null || clean === r.message) continue;
    evCandidates++;
    evUpdates.push({ id: r.id, message: clean });
    if (evSampleShown < 3) {
      console.log(`  ─ id=${String(r.id).slice(0, 8)}…`);
      console.log(`    before (${r.message.length} bytes): ${r.message.slice(0, 90).replace(/\n/g, ' ')}…`);
      console.log(`    after  (${clean.length} bytes): ${clean}`);
      console.log('');
      evSampleShown++;
    }
  }
  console.log(`cycle_events: ${evCandidates} row(s) to sanitise (of ${events?.length ?? 0} scanned).`);
  console.log('');

  // ─── cycle_runs.error_text ────────────────────────────────────
  console.log('Scanning cycle_runs.error_text…');
  const { data: runs, error: runErr } = await sb
    .from('cycle_runs')
    .select('id, error_text')
    .ilike('error_text', '%<%')
    .limit(2000)
    .returns<RunRow[]>();
  if (runErr) { console.error(`cycle_runs read failed: ${runErr.message}`); process.exit(1); }

  let runCandidates = 0;
  let runSampleShown = 0;
  const runUpdates: Array<{ id: string | number; error_text: string }> = [];
  for (const r of runs ?? []) {
    if (!r.error_text) continue;
    const clean = sanitise(r.error_text);
    if (clean === null || clean === r.error_text) continue;
    runCandidates++;
    runUpdates.push({ id: r.id, error_text: clean });
    if (runSampleShown < 3) {
      console.log(`  ─ id=${String(r.id).slice(0, 8)}…`);
      console.log(`    before (${r.error_text.length} bytes): ${r.error_text.slice(0, 90).replace(/\n/g, ' ')}…`);
      console.log(`    after  (${clean.length} bytes): ${clean}`);
      console.log('');
      runSampleShown++;
    }
  }
  console.log(`cycle_runs: ${runCandidates} row(s) to sanitise (of ${runs?.length ?? 0} scanned).`);
  console.log('');

  if (!force) {
    console.log('Dry-run — re-run with --force to apply.');
    return;
  }

  // ─── Apply updates one row at a time. PostgREST doesn't support
  //     bulk-update-with-different-values in a single call from JS; the
  //     per-row trip is cheap at these volumes (low hundreds at most). ─
  let evApplied = 0, evFailed = 0;
  for (const u of evUpdates) {
    const { error } = await sb.from('cycle_events').update({ message: u.message }).eq('id', u.id);
    if (error) { evFailed++; console.error(`  cycle_events ${u.id}: ${error.message}`); }
    else evApplied++;
  }
  console.log(`cycle_events updated: ${evApplied}/${evUpdates.length} (${evFailed} failed).`);

  let runApplied = 0, runFailed = 0;
  for (const u of runUpdates) {
    const { error } = await sb.from('cycle_runs').update({ error_text: u.error_text }).eq('id', u.id);
    if (error) { runFailed++; console.error(`  cycle_runs ${u.id}: ${error.message}`); }
    else runApplied++;
  }
  console.log(`cycle_runs updated: ${runApplied}/${runUpdates.length} (${runFailed} failed).`);
}

main().catch((err) => {
  console.error('CRASHED:', err);
  process.exit(1);
});
