/**
 * Preview the creator-payout calculator output for any
 * (campaign, assignment) pair, without writing anything to the DB.
 *
 * Useful for:
 *   - sanity-checking a rate card after the operator edits it
 *   - inspecting why a creator's earnings look weird
 *   - dumping the full breakdown for support tickets
 *
 * Usage:
 *   npx tsx scripts/payouts_preview.ts --assignment=<uuid>
 *   npx tsx scripts/payouts_preview.ts --campaign=roastai --creator=<uuid>
 *
 * The actual cron-driven calculator (Phase 2 of the implementation
 * plan) will live elsewhere and write `payouts` rows; this script is
 * read-only.
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import { calculatePayout } from './lib/payouts/calculator.js';
import type {
  CampaignPayoutConfig,
  Assignment,
  CalculatorPost,
  ManualAdjustment,
} from './lib/payouts/types.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '..', '.env.local'), override: true });

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(2);
}
const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

function getArg(name: string): string | null {
  const arg = process.argv.find(a => a.startsWith(`--${name}=`));
  return arg ? arg.split('=').slice(1).join('=').trim() : null;
}

function fmtUsd(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  return `${sign}$${(Math.abs(cents) / 100).toFixed(2)}`;
}

async function loadAssignmentByArgs(): Promise<Assignment | null> {
  const assignmentId = getArg('assignment');
  if (assignmentId) {
    const { data } = await sb
      .from('assignments')
      .select('*')
      .eq('id', assignmentId)
      .maybeSingle<Assignment>();
    return data;
  }
  const slug = getArg('campaign');
  const creatorId = getArg('creator');
  if (slug && creatorId) {
    const { data: c } = await sb.from('campaigns').select('id').eq('slug', slug).maybeSingle();
    if (!c) return null;
    const { data } = await sb
      .from('assignments')
      .select('*')
      .eq('campaign_id', c.id)
      .eq('creator_id', creatorId)
      .maybeSingle<Assignment>();
    return data;
  }
  return null;
}

async function main(): Promise<void> {
  const assignment = await loadAssignmentByArgs();
  if (!assignment) {
    console.error('Usage:');
    console.error('  npx tsx scripts/payouts_preview.ts --assignment=<uuid>');
    console.error('  npx tsx scripts/payouts_preview.ts --campaign=<slug> --creator=<uuid>');
    process.exit(2);
  }

  // Load config + posts in parallel
  const [{ data: config }, { data: posts }, { data: existingPending }] = await Promise.all([
    sb
      .from('campaign_payout_configs')
      .select('*')
      .eq('campaign_id', assignment.campaign_id)
      .maybeSingle<CampaignPayoutConfig>(),
    sb
      .from('posts')
      .select('id, date, views, saves, status')
      .eq('assignment_id', assignment.id)
      .returns<Array<{ id: string; date: string; views: number; saves: number | null; status: string }>>(),
    sb
      .from('payouts')
      .select('manual_adjustments')
      .eq('assignment_id', assignment.id)
      .eq('status', 'pending')
      .maybeSingle<{ manual_adjustments: ManualAdjustment[] }>(),
  ]);

  if (!config) {
    console.error(`No campaign_payout_configs row for campaign ${assignment.campaign_id}.`);
    console.error('Configure a rate card on the campaign edit page first.');
    process.exit(2);
  }

  const calculatorPosts: CalculatorPost[] = (posts ?? []).map(p => ({
    id: p.id,
    posted_at: p.date ?? new Date(0).toISOString(),
    views: p.views ?? 0,
    saves: p.saves,
    status: p.status,
  }));

  const out = calculatePayout({
    config,
    assignment,
    posts: calculatorPosts,
    metricSnapshotAt: new Date(),
    manualAdjustments: existingPending?.manual_adjustments ?? [],
  });

  // Pretty-print the breakdown
  console.log('');
  console.log(`Assignment ${assignment.id}`);
  console.log(`Campaign:   ${assignment.campaign_id}`);
  console.log(`Creator:    ${assignment.creator_id}`);
  console.log(`Mode:       ${out.rule}`);
  console.log(`Snapshot:   ${out.metric_snapshot_at}`);
  console.log(`Posts:      ${calculatorPosts.length} on assignment, ${out.contributing_post_ids.length} contributing`);
  console.log('');
  console.log('Breakdown');
  console.log('─────────────────────────────────────────────────────────────────────');
  for (const line of out.breakdown) {
    const prefix = line.kind === 'subtotal' ? '─── ' : line.kind === 'total' ? '═══ ' : '    ';
    console.log(`${prefix}${line.label.padEnd(56, ' ')} ${fmtUsd(line.cents).padStart(10, ' ')}`);
  }
  console.log('═════════════════════════════════════════════════════════════════════');
  console.log(`TOTAL OWED                                                  ${fmtUsd(out.amount_cents).padStart(10)}`);
  console.log('');
}

main().catch(err => {
  console.error('Preview failed:', err);
  process.exit(1);
});
