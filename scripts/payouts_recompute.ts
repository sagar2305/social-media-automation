/**
 * Manually trigger the creator-payout recompute outside of the
 * analytics phase. Useful for:
 *   - Smoke-testing the runner against live data without firing a
 *     full pull_analytics cycle (which costs ScrapeCreators credits).
 *   - Re-running the recompute after editing a rate card on the
 *     dashboard, so pending amounts reflect the new config
 *     immediately rather than waiting for the next analytics tick.
 *
 * Usage:
 *   npx tsx scripts/payouts_recompute.ts                    # all active campaigns
 *   npx tsx scripts/payouts_recompute.ts --campaign=roastai # one campaign by slug
 */

import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { config as dotenvConfig } from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import {
  recomputePendingPayoutsForAllActiveCampaigns,
  recomputePendingPayoutsForCampaign,
} from './lib/payouts/runner.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenvConfig({ path: resolve(__dirname, '..', '.env.local'), override: true });

if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY');
  process.exit(2);
}

const log = (m: string) => console.log(m);

async function main(): Promise<void> {
  const slugArg = process.argv.find(a => a.startsWith('--campaign='));
  if (slugArg) {
    const slug = slugArg.split('=').slice(1).join('=').trim();
    const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);
    const { data: c } = await sb.from('campaigns').select('id, slug').eq('slug', slug).maybeSingle<{ id: string; slug: string }>();
    if (!c) {
      console.error(`No campaign with slug "${slug}".`);
      process.exit(2);
    }
    const stats = await recomputePendingPayoutsForCampaign(c.id, log);
    console.log('\nDone:', stats);
    return;
  }
  const stats = await recomputePendingPayoutsForAllActiveCampaigns(log);
  console.log('\nDone:', stats);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
