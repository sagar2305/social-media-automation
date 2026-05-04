/**
 * Account loader — pulls the active TikTok account list from Supabase and
 * mutates `config.tiktokAccounts` in-place so every existing call site
 * (main.ts, post_to_tiktok, pull_analytics, tier_scheduler, ...) sees the
 * dashboard-managed list without any refactoring.
 *
 * Failure mode: if Supabase is unreachable, we keep whatever's in config.ts
 * as a hard-coded fallback. This is intentional — the cycle must keep running
 * even if the dashboard DB is down.
 */

import { createClient } from '@supabase/supabase-js';
import { config } from '../config/config.js';
import { log } from './api-client.js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

interface DbAccount {
  id: string;
  name: string;
  handle: string;
  active: boolean;
}

let loaded = false;

/**
 * Replace `config.tiktokAccounts` contents with the active set from Supabase.
 * Idempotent — calling more than once just re-fetches.
 *
 * @returns the active account count after loading (0 if fallback was used and
 *          config had no entries either)
 */
export async function loadAccountsIntoConfig(): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    log('[account_loader] no Supabase env — using config.ts fallback');
    return config.tiktokAccounts.length;
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);
    const { data, error } = await supabase
      .from('accounts')
      .select('id, name, handle, active')
      .eq('active', true)
      .order('created_at', { ascending: true })
      .returns<DbAccount[]>();

    if (error || !data) {
      log(`[account_loader] DB read failed (${error?.message ?? 'no data'}) — using config.ts fallback`);
      return config.tiktokAccounts.length;
    }

    if (data.length === 0) {
      log('[account_loader] DB has zero active accounts — using config.ts fallback');
      return config.tiktokAccounts.length;
    }

    // Mutate the existing array (rather than reassigning) so any module that
    // already captured a reference still sees the updated values.
    config.tiktokAccounts.length = 0;
    for (const acc of data) {
      config.tiktokAccounts.push({ id: acc.id, name: acc.name, handle: acc.handle });
    }

    loaded = true;
    log(`[account_loader] loaded ${data.length} active accounts from DB: ${data.map(a => a.handle).join(', ')}`);
    return data.length;
  } catch (err) {
    log(`[account_loader] unexpected error (${err}) — using config.ts fallback`);
    return config.tiktokAccounts.length;
  }
}

/** True if the most recent load came from Supabase (vs. config.ts fallback). */
export function isLoadedFromDb(): boolean {
  return loaded;
}

/**
 * CLI helper — prints active account handles, one per line. Used by
 * daily_runner.sh to build its --account=... flag.
 *
 * Usage: npx tsx scripts/account_loader.ts handles
 */
if (import.meta.url === `file://${process.argv[1]}`) {
  const cmd = process.argv[2];
  if (cmd === 'handles') {
    loadAccountsIntoConfig().then(() => {
      console.log(config.tiktokAccounts.map(a => a.handle).join(','));
    }).catch((err) => {
      console.error(err);
      process.exit(1);
    });
  } else {
    console.error('Usage: npx tsx scripts/account_loader.ts handles');
    process.exit(1);
  }
}
