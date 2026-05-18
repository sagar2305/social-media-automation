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
 * @param campaignSlug - if provided, only loads accounts belonging to this
 *                       campaign. If omitted, loads all active accounts
 *                       across all campaigns (back-compat for legacy callers).
 * @returns the active account count after loading (0 if fallback was used and
 *          config had no entries either)
 */
export async function loadAccountsIntoConfig(campaignSlug?: string): Promise<number> {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    log('[account_loader] no Supabase env — using config.ts fallback');
    return config.tiktokAccounts.length;
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

    // Resolve campaign_id if a slug was passed. Pre-resolve so the accounts
    // query stays a simple equality filter (no joins through PostgREST).
    let campaignFilter: string | null = null;
    if (campaignSlug) {
      const { data: c } = await supabase
        .from('campaigns')
        .select('id')
        .eq('slug', campaignSlug)
        .maybeSingle();
      if (!c) {
        // CRITICAL: same no-fallback guard as the zero-accounts branch
        // below. If a campaign slug was requested but doesn't exist in
        // the DB, we must NOT fall back to config.tiktokAccounts —
        // that's the legacy MinuteWise account list, so a typo or
        // race-with-create would silently post to MinuteWise. Empty
        // the config so any caller that doesn't check the count still
        // produces zero posts, and log loudly.
        config.tiktokAccounts.length = 0;
        log(
          `[account_loader] ERROR: campaign "${campaignSlug}" not found in DB. ` +
          `NOT falling back to the global config — that would post on a ` +
          `different campaign's accounts. Check the slug or create the ` +
          `campaign at /campaigns/new and re-run.`,
        );
        loaded = true; // we successfully reached the DB; the result was just absent
        return 0;
      }
      campaignFilter = c.id;
    }

    let query = supabase
      .from('accounts')
      .select('id, name, handle, active')
      .eq('active', true)
      .order('created_at', { ascending: true });
    if (campaignFilter) query = query.eq('campaign_id', campaignFilter);
    const { data, error } = await query.returns<DbAccount[]>();

    if (error || !data) {
      log(`[account_loader] DB read failed (${error?.message ?? 'no data'}) — using config.ts fallback`);
      return config.tiktokAccounts.length;
    }

    if (data.length === 0) {
      // CRITICAL: when a specific campaign was requested but it has zero
      // accounts attached, we MUST NOT fall back to config.tiktokAccounts.
      // That fallback contains the legacy MinuteWise account list, so a
      // freshly created campaign without accounts (e.g. BOTAI before any
      // accounts were assigned) would silently post on MinuteWise's
      // accounts — exactly the cross-campaign leakage we're closing.
      //
      // Empty the config list so any caller that doesn't check the
      // returned count still produces zero posts, and surface a clear
      // log line so the operator sees what happened.
      if (campaignSlug) {
        config.tiktokAccounts.length = 0;
        log(`[account_loader] ERROR: campaign "${campaignSlug}" has zero active accounts attached. NOT falling back to the global config — that would post on a different campaign's accounts. Attach an account to this campaign on /campaigns/${campaignSlug}/accounts and re-run.`);
        loaded = true; // we did successfully read from DB; the result was just empty
        return 0;
      }
      // No campaign scope — legacy "global" call. Falling back to
      // config.ts is OK here because there's no campaign whose accounts
      // we'd be confusing it with.
      log('[account_loader] DB has zero active accounts (no campaign scope) — using config.ts fallback');
      return config.tiktokAccounts.length;
    }

    // Mutate the existing array (rather than reassigning) so any module that
    // already captured a reference still sees the updated values.
    config.tiktokAccounts.length = 0;
    for (const acc of data) {
      config.tiktokAccounts.push({ id: acc.id, name: acc.name, handle: acc.handle });
    }

    loaded = true;
    const scopeLabel = campaignSlug ? `campaign=${campaignSlug}` : 'all campaigns';
    log(`[account_loader] loaded ${data.length} active accounts from DB (${scopeLabel}): ${data.map(a => a.handle).join(', ')}`);
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
