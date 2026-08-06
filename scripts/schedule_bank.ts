/**
 * Schedule banked posts onto daily slots via Blotato — CLI equivalent of the
 * dashboard's Content Bank scheduler.
 *
 * The dashboard route (/api/bank/schedule) is auth-gated behind a browser
 * session, so it can't be driven from a script or a cron. This does the same
 * work headlessly using the Blotato API key.
 *
 * Slot assignment is NOT reimplemented here — it imports buildSchedulePlan()
 * from the dashboard lib, so the CLI and the UI can never drift apart. That
 * function already handles the parts that are easy to get wrong: one
 * independent lane per account, oldest-post-first for stable ordering, skipping
 * slots that are in the past or inside the lead-time window, and refusing to
 * double-book a slot an account already has a post in.
 *
 * Blotato has NO delete endpoint — a submitted schedule cannot be undone from
 * here. Hence --dry-run, and hence the plan is always printed before anything
 * is sent.
 *
 * Usage:
 *   npx tsx scripts/schedule_bank.ts --start=2026-08-04 --dry-run
 *   npx tsx scripts/schedule_bank.ts --start=2026-08-04 --times=02:00,06:00,20:00
 */

import { createClient } from '@supabase/supabase-js';
import { config as dotenvConfig } from 'dotenv';
dotenvConfig({ path: '.env.local' });

// Loaded dynamically, not with a static import: the dashboard package has no
// `"type": "module"`, so Node treats that file as CommonJS and ESM named-import
// binding fails at parse time ("does not provide an export named ..."). A
// dynamic import resolves the namespace at runtime instead, which works — and
// still means slot assignment lives in exactly one place, shared with the UI.
import type {
  BankPostLite,
  SchedulePlan,
  PlanItem,
} from '../dashboard/src/lib/bank-schedule.js';

type BankScheduleModule = {
  buildSchedulePlan: (opts: {
    posts: BankPostLite[];
    startDate: string;
    times?: string[];
    accounts?: readonly string[];
    connected: ReadonlySet<string>;
    occupied?: ReadonlySet<string>;
    now?: Date;
  }) => SchedulePlan;
  slotKey: (account: string, iso: string) => string;
  formatIst: (iso: string) => string;
  DEFAULT_TIMES: string[];
  DEFAULT_ACCOUNTS: readonly string[];
};

const { buildSchedulePlan, slotKey, DEFAULT_TIMES, DEFAULT_ACCOUNTS } =
  (await import('../dashboard/src/lib/bank-schedule.js')) as unknown as BankScheduleModule;

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPA_KEY =
  process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const BLOTATO_KEY = process.env.BLOTATO_API_KEY;
if (!SUPA_URL || !SUPA_KEY || !BLOTATO_KEY) {
  console.error('Missing env: NEXT_PUBLIC_SUPABASE_URL, a Supabase key, and BLOTATO_API_KEY are required.');
  process.exit(1);
}
const sb = createClient(SUPA_URL, SUPA_KEY);

const B = 'https://backend.blotato.com/v2';
const H = { 'Content-Type': 'application/json', 'blotato-api-key': BLOTATO_KEY };

/** Blotato allows 30 req/min across every endpoint; serialise to stay under. */
const MIN_INTERVAL_MS = 2_100;
let nextSlotAt = 0;
async function throttle(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, nextSlotAt);
  nextSlotAt = slot + MIN_INTERVAL_MS;
  if (slot > now) await new Promise((r) => setTimeout(r, slot - now));
}

function arg(name: string): string | undefined {
  return process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
}
const DRY_RUN = process.argv.includes('--dry-run');
const START = arg('start');
const TIMES = arg('times')?.split(',').map((t) => t.trim()).filter(Boolean) ?? DEFAULT_TIMES;
// Same validation the dashboard route applies, and for the same reasons:
// buildSchedulePlan sorts times lexicographically, so an unpadded "8:00" would
// order AFTER "14:00" and fill the lane in the wrong sequence; and a
// non-numeric entry makes istToUtc produce Invalid Date, which slips past the
// past-slot guard (every NaN comparison is false) and then throws on
// toISOString(). Cheap to check here, expensive to undo — Blotato has no
// delete endpoint.
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const badTime = TIMES.find((t) => !TIME_RE.test(t));
if (badTime !== undefined) {
  console.error(`Invalid slot time "${badTime}" — use zero-padded HH:MM (e.g. 08:00, not 8:00).`);
  process.exit(1);
}

// Number('abc') is NaN and slice(0, NaN) yields an empty array, so a typo'd
// --limit would silently schedule nothing and still exit 0.
const LIMIT_RAW = arg('limit');
const LIMIT = LIMIT_RAW === undefined ? Infinity : Number(LIMIT_RAW);
if ((!Number.isFinite(LIMIT) && LIMIT_RAW !== undefined) || LIMIT < 1) {
  console.error(`--limit must be a positive number (got "${LIMIT_RAW}").`);
  process.exit(1);
}
/**
 * Restrict scheduling to specific handles. Needed when one account cannot
 * publish correctly and its posts must stay banked — e.g. an account TikTok
 * won't mint an "original sound" for publishes silent videos, so scheduling it
 * would burn posts that cannot be deleted afterwards.
 */
const ACCOUNTS = arg('accounts')?.split(',').map((a) => a.trim().replace('@', '').toLowerCase()).filter(Boolean);

interface Meta {
  caption?: string;
  title?: string;
  videoUrl?: string;
  blotatoUrls?: string[];
  slideUrls?: string[];
  mediaType?: 'slideshow' | 'video';
  scheduledAt?: string;
  submissionId?: string;
}

function parseMeta(raw: unknown): Meta {
  try {
    const p = JSON.parse((raw as string) || '{}');
    return p && typeof p === 'object' ? p : {};
  } catch {
    return {};
  }
}

(async () => {
  if (!START || !/^\d{4}-\d{2}-\d{2}$/.test(START)) {
    console.error('--start=YYYY-MM-DD is required (IST date the lanes begin on).');
    process.exit(1);
  }

  // Live handle → account id. config/config.ts ids are stale (@yournotetaker is
  // 36969 there, not the `cmm…` id), so always resolve at runtime.
  await throttle();
  const accRes = await fetch(`${B}/users/me/accounts?platform=tiktok`, { headers: H });
  if (!accRes.ok) {
    console.error(`Blotato account lookup failed (${accRes.status})`);
    process.exit(1);
  }
  const accJson = (await accRes.json()) as { items?: { id: string; username?: string }[] };
  const byHandle = new Map(
    (accJson.items ?? [])
      .filter((a) => a.username)
      .map((a) => [a.username!.toLowerCase(), a.id]),
  );
  const connected = new Set(byHandle.keys());

  // Banked posts, oldest first — buildSchedulePlan re-sorts, but ordering here
  // keeps the printed plan deterministic.
  const { data: bankedRows, error } = await sb
    .from('posts')
    .select('id, account, created_at, failure_resolution_note')
    .eq('status', 'banked')
    .order('created_at', { ascending: true });
  if (error) {
    console.error(`Failed to load banked posts: ${error.message}`);
    process.exit(1);
  }
  const posts: BankPostLite[] = (bankedRows ?? []).map((p) => ({
    id: p.id as string,
    account: p.account as string,
    created_at: p.created_at as string,
    title: parseMeta(p.failure_resolution_note).title,
  }));

  // Slots already claimed. NOT campaign-filtered: an account's TikTok timeline
  // is shared, so a slot taken by any campaign still blocks this one.
  // Fatal on error, never ignored: a failed read leaves `occupied` empty, which
  // is indistinguishable from "no slots taken". buildSchedulePlan would then
  // restart every lane at startDate and double-book slots that already hold a
  // post — and Blotato has no delete endpoint, so that cannot be undone.
  const { data: schedRows, error: schedErr } = await sb
    .from('posts')
    .select('account, failure_resolution_note')
    .eq('status', 'scheduled');
  if (schedErr) {
    console.error(`Failed to read already-scheduled slots: ${schedErr.message}`);
    console.error('Refusing to continue — without them this would double-book slots that cannot be deleted.');
    process.exit(1);
  }
  const occupied = new Set<string>();
  for (const p of schedRows ?? []) {
    const at = parseMeta(p.failure_resolution_note).scheduledAt;
    if (at) occupied.add(slotKey(p.account as string, at));
  }

  const plan = buildSchedulePlan({
    posts,
    startDate: START,
    times: TIMES,
    accounts: ACCOUNTS ?? DEFAULT_ACCOUNTS,
    connected,
    occupied,
  });

  console.log(`\nBanked: ${posts.length} · slots/day: ${TIMES.join(', ')} IST · start ${START}`);
  console.log(`Occupied slots already booked: ${occupied.size}\n`);
  const byAccount = new Map<string, number>();
  for (const it of plan.items) byAccount.set(it.account, (byAccount.get(it.account) ?? 0) + 1);
  for (const it of plan.items) {
    console.log(`  ${it.istLabel.padEnd(18)} @${it.account.padEnd(20)} ${it.title.slice(0, 60)}`);
  }
  console.log('');
  for (const [a, n] of byAccount) console.log(`  @${a}: ${n}`);
  for (const s of plan.skipped) console.log(`  SKIPPED ${s.count} × @${s.account} — ${s.reason}`);

  if (DRY_RUN) {
    console.log(`\nDRY RUN — nothing submitted. ${plan.items.length} would be scheduled.`);
    return;
  }
  if (!plan.items.length) {
    console.log('\nNothing to schedule.');
    return;
  }

  console.log(`\nSubmitting ${plan.items.length} scheduled posts…\n`);
  let ok = 0;
  let failed = 0;

  for (const item of plan.items.slice(0, LIMIT)) {
    // Claim banked → posting so a concurrent run can't submit the same post.
    const { data: claimed, error: claimErr } = await sb
      .from('posts')
      .update({ status: 'posting' })
      .eq('id', item.id)
      .eq('status', 'banked')
      .select('*');
    if (claimErr || !claimed?.length) {
      console.log(`  SKIP ${item.id} — already claimed or gone`);
      continue;
    }
    const row = claimed[0];
    const meta = parseMeta(row.failure_resolution_note);
    // Guarded on status='posting' so this can only undo OUR claim. Without the
    // guard a row another process had already advanced to scheduled/posted
    // would be rewritten to banked and submitted again — an un-deletable
    // duplicate. Matches the dashboard route's revert.
    const revert = async (why: string) => {
      const { data: reverted, error: revertErr } = await sb
        .from('posts')
        .update({ status: 'banked' })
        .eq('id', item.id)
        .eq('status', 'posting')
        .select('id');
      let suffix = '';
      if (revertErr) suffix = ` (revert FAILED: ${revertErr.message} — row left in 'posting')`;
      else if (!reverted?.length) suffix = ' (nothing reverted — row was no longer in \'posting\')';
      console.log(`  FAIL @${item.account} ${item.istLabel} — ${why}${suffix}`);
      failed++;
    };

    try {
      const accountId = byHandle.get(String(row.account).toLowerCase());
      if (!accountId) {
        await revert('no live Blotato account');
        continue;
      }
      const isVideo = meta.mediaType === 'video';

      // Host the media once and cache it, so a retry never re-uploads.
      let mediaUrls = meta.blotatoUrls ?? [];
      const expected = isVideo ? 1 : (meta.slideUrls ?? []).length;
      const cached =
        expected > 0 &&
        mediaUrls.length === expected &&
        mediaUrls.every((u) => u.includes('blotato'));
      if (!cached) {
        // Slideshow rows need per-slide compression + upload (sharp), which
        // lives in the dashboard's prepareMediaUrls. Rather than half-support
        // them here and submit an empty mediaUrls array, say so explicitly and
        // leave the row banked for the dashboard to schedule.
        if (!isVideo) {
          await revert(
            'slideshow row without cached media — schedule it from the dashboard (this CLI prepares video only)',
          );
          continue;
        }
        const src = meta.videoUrl;
        if (!src) {
          await revert('no media source on row');
          continue;
        }
        await throttle();
        const mRes = await fetch(`${B}/media`, {
          method: 'POST',
          headers: H,
          body: JSON.stringify({ url: src }),
        });
        const mJson = (await mRes.json().catch(() => ({}))) as { url?: string };
        if (!mRes.ok || !mJson.url) {
          await revert(`media ${mRes.status} ${JSON.stringify(mJson).slice(0, 120)}`);
          continue;
        }
        mediaUrls = [mJson.url];
        meta.blotatoUrls = mediaUrls;
        // Persist before submitting: if the post call fails, the upload work
        // is still banked for the retry.
        await sb
          .from('posts')
          .update({ failure_resolution_note: JSON.stringify(meta) })
          .eq('id', item.id);
      }

      // autoAddMusic is a PHOTO-post feature — including it on a video risks
      // TikTok laying a track over the video's own audio. Title caps at 2200
      // for video vs 90 for photo.
      const target: Record<string, unknown> = {
        targetType: 'tiktok',
        privacyLevel: 'PUBLIC_TO_EVERYONE',
        disabledComments: false,
        disabledDuet: false,
        disabledStitch: false,
        isBrandedContent: false,
        isYourBrand: false,
        isAiGenerated: true,
        isDraft: false,
        // 90 for BOTH photo and video: TikTok allows 2200 on video, but
        // Blotato rejects it — "400 body.post.target.title must NOT have more
        // than 90 characters" (hit for real on a scheduled video post). The
        // full text still goes out in the caption.
        title: (meta.title ?? '').slice(0, 90),
      };
      if (!isVideo) target.autoAddMusic = true;

      await throttle();
      const pRes = await fetch(`${B}/posts`, {
        method: 'POST',
        headers: H,
        body: JSON.stringify({
          post: {
            accountId,
            content: { text: meta.caption ?? '', mediaUrls, platform: 'tiktok' },
            target,
          },
          scheduledTime: item.scheduledAt, // ROOT level, not inside `post`
        }),
      });
      const pJson = (await pRes.json().catch(() => ({}))) as {
        postSubmissionId?: string;
        id?: string;
        message?: string;
      };
      if (!pRes.ok) {
        await revert(`post ${pRes.status} ${pJson.message ?? JSON.stringify(pJson).slice(0, 120)}`);
        continue;
      }
      const sid = pJson.postSubmissionId ?? pJson.id ?? null;

      // Past this point Blotato holds the scheduled post and it CANNOT be
      // deleted. A failure to record it must be surfaced, never swallowed —
      // otherwise the next run wouldn't know the slot is taken and would
      // double-book it.
      const istDate = new Date(new Date(item.scheduledAt).getTime() + 5.5 * 3_600_000)
        .toISOString()
        .slice(0, 10);
      const { error: saveErr } = await sb
        .from('posts')
        .update({
          status: 'scheduled',
          date: istDate,
          failure_resolution_note: JSON.stringify({
            ...meta,
            scheduledAt: item.scheduledAt,
            submissionId: sid,
          }),
        })
        .eq('id', item.id);
      if (saveErr) {
        console.log(
          `  !! SUBMITTED @${item.account} ${item.istLabel} (${sid}) but the status write FAILED: ` +
            `${saveErr.message}. The slot IS taken — do NOT re-schedule this post.`,
        );
        failed++;
        continue;
      }
      console.log(`  OK   ${item.istLabel.padEnd(18)} @${item.account.padEnd(20)} ${sid}`);
      ok++;
    } catch (e) {
      await revert(e instanceof Error ? e.message : String(e));
    }
  }

  console.log(`\nDONE. scheduled=${ok} failed=${failed}`);
  if (failed) console.log('Failed rows were reverted to banked — re-run to retry them.');
})().catch((e) => {
  console.error('FATAL', e instanceof Error ? e.message : e);
  process.exit(1);
});
