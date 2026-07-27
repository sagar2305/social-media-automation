import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";
import { getActiveCampaignFilter } from "@/lib/campaign-filter";
import { getTiktokAccounts, prepareMediaUrls, isBlotatoMediaUrl, submitPost } from "@/lib/blotato";
import {
  DEFAULT_ACCOUNTS,
  DEFAULT_TIMES,
  MIN_LEAD_MINUTES,
  buildSchedulePlan,
  formatIst,
  slotKey,
  type BankPostLite,
} from "@/lib/bank-schedule";

// sharp (via lib/blotato) needs the Node runtime, not Edge.
export const runtime = "nodejs";

/**
 * Schedule banked posts onto future slots via Blotato.
 *
 * Two modes on the same route:
 *   mode: "plan"    → pure preview, touches nothing. Returns the slot assignment.
 *   mode: "execute" → submits a chunk of already-previewed items.
 *
 * Execution is chunked by the client rather than done in one request because
 * Blotato is rate-limited to 30 req/min: 50+ posts means minutes of wall-clock,
 * which is a long time to hold a single request open with no progress feedback.
 *
 * Blotato has no delete-post endpoint, so a submitted schedule cannot be undone
 * from here — hence plan-then-confirm rather than a single fire-and-forget call.
 */

interface Meta {
  caption?: string;
  title?: string;
  slideUrls?: string[];
  /** Blotato-hosted, compressed copies of slideUrls — cached after first prep. */
  blotatoUrls?: string[];
  scheduledAt?: string;
  submissionId?: string;
}

function parseMeta(raw: unknown): Meta {
  try {
    // JSON.parse("null") succeeds and yields null, which would then throw on
    // any property access — after the row has already been claimed.
    const parsed = JSON.parse((raw as string) || "{}");
    return parsed && typeof parsed === "object" ? (parsed as Meta) : {};
  } catch {
    return {};
  }
}

/** `HH:MM`, zero-padded, 24-hour. */
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

async function loadBanked(sb: Awaited<ReturnType<typeof createClient>>) {
  const campaign = await getActiveCampaignFilter();
  let q = sb
    .from("posts")
    .select("id, account, created_at, failure_resolution_note")
    .eq("status", "banked")
    .order("created_at", { ascending: true });
  if (campaign) q = q.eq("campaign_id", campaign.id);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []).map((p): BankPostLite => ({
    id: p.id as string,
    account: p.account as string,
    created_at: p.created_at as string,
    title: parseMeta(p.failure_resolution_note).title,
  }));
}

/**
 * Slots already claimed by scheduled posts. Not campaign-filtered on purpose:
 * an account's TikTok timeline is shared across campaigns, so a slot taken by
 * a RoastAI post still blocks a MinuteWise one on the same handle.
 */
async function loadOccupiedSlots(
  sb: Awaited<ReturnType<typeof createClient>>
): Promise<Set<string>> {
  const { data, error } = await sb
    .from("posts")
    .select("account, failure_resolution_note")
    .eq("status", "scheduled");
  if (error) throw new Error(error.message);
  const out = new Set<string>();
  for (const p of data ?? []) {
    const at = parseMeta(p.failure_resolution_note).scheduledAt;
    if (at) out.add(slotKey(p.account as string, at));
  }
  return out;
}

export async function POST(req: NextRequest) {
  let body: {
    mode?: "plan" | "execute";
    startDate?: string;
    times?: string[];
    accounts?: string[];
    items?: { id: string; scheduledAt: string }[];
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const sb = await createClient();
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // ---------------------------------------------------------------- plan ----
  if (body.mode !== "execute") {
    const startDate = body.startDate;
    if (!startDate || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
      return NextResponse.json({ error: "startDate must be YYYY-MM-DD" }, { status: 400 });
    }
    // Times are sorted lexicographically when building lanes, so an unpadded
    // "8:00" would silently order after "14:00"; a non-numeric entry would throw
    // inside buildSchedulePlan.
    const times = body.times?.length ? body.times : DEFAULT_TIMES;
    const badTime = times.find((t) => !TIME_RE.test(t));
    if (badTime !== undefined) {
      return NextResponse.json(
        { error: `Invalid slot time "${badTime}" — use zero-padded HH:MM (e.g. 08:00)` },
        { status: 400 }
      );
    }
    const apiKey = process.env.BLOTATO_API_KEY;
    if (!apiKey) {
      return NextResponse.json(
        { error: "BLOTATO_API_KEY not configured in dashboard env" },
        { status: 500 }
      );
    }

    let posts: BankPostLite[];
    let connected: Set<string>;
    let occupied: Set<string>;
    try {
      posts = await loadBanked(sb);
      // Resolved live: the ids in config/config.ts are stale for @yournotetaker.
      connected = new Set((await getTiktokAccounts(apiKey)).keys());
      occupied = await loadOccupiedSlots(sb);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : "Failed to build plan" },
        { status: 500 }
      );
    }
    const plan = buildSchedulePlan({
      posts,
      startDate,
      times,
      accounts: body.accounts?.length ? body.accounts : DEFAULT_ACCOUNTS,
      connected,
      occupied,
    });
    return NextResponse.json({ ok: true, ...plan, totalBanked: posts.length });
  }

  // ------------------------------------------------------------- execute ----
  const items = body.items ?? [];
  if (!items.length) return NextResponse.json({ error: "No items to schedule" }, { status: 400 });
  if (items.length > 10) {
    return NextResponse.json({ error: "Send at most 10 items per request" }, { status: 400 });
  }

  const apiKey = process.env.BLOTATO_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: "BLOTATO_API_KEY not configured in dashboard env" }, { status: 500 });
  }

  let accounts: Map<string, string>;
  try {
    accounts = await getTiktokAccounts(apiKey);
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Blotato account lookup failed" },
      { status: 502 }
    );
  }

  const results: { id: string; ok: boolean; scheduledAt?: string; istLabel?: string; error?: string }[] = [];
  const cutoff = Date.now() + MIN_LEAD_MINUTES * 60_000;

  for (let idx = 0; idx < items.length; idx++) {
    const { id, scheduledAt } = items[idx];
    const when = new Date(scheduledAt);

    // Re-validate server-side: the client's plan is a suggestion, not a trusted
    // instruction. A stale tab could otherwise submit a slot that has passed.
    if (isNaN(when.getTime()) || when.getTime() < cutoff) {
      results.push({ id, ok: false, error: "Slot is in the past or too soon — re-plan" });
      continue;
    }

    // Everything after the claim runs inside try/catch: an unexpected throw
    // would otherwise abandon the row in `posting`, where nothing can reclaim
    // it (the claim below requires status = "banked"). This has happened for
    // real — a network blip took out both an upload and its revert write.
    let claimed = false;
    const revert = async (error: string) => {
      const { error: revertErr } = await sb
        .from("posts")
        .update({ status: "banked" })
        .eq("id", id)
        .eq("status", "posting");
      results.push({
        id,
        ok: false,
        error: revertErr ? `${error} (and revert failed: ${revertErr.message})` : error,
      });
    };

    try {
      // Claim banked → posting so a double-click or second tab can't submit twice.
      const { data: claimedRows, error: claimErr } = await sb
        .from("posts")
        .update({ status: "posting" })
        .eq("id", id)
        .eq("status", "banked")
        .select("*");
      if (claimErr) {
        results.push({ id, ok: false, error: claimErr.message });
        continue;
      }
      if (!claimedRows?.length) {
        results.push({ id, ok: false, error: "Already scheduled, posted, or in progress" });
        continue;
      }
      claimed = true;
      const row = claimedRows[0];

      const meta = parseMeta(row.failure_resolution_note);
      const slideUrls = meta.slideUrls ?? [];
      const accountId = accounts.get(String(row.account).toLowerCase());
      if (!accountId) {
        await revert(`No live Blotato account for "${row.account}"`);
        continue;
      }
      if (!slideUrls.length) {
        await revert("No slides on this post");
        continue;
      }
      if (!(meta.caption ?? "").trim()) {
        await revert("Empty caption");
        continue;
      }

      // Bank slides are 2-3MB PNGs, which have intermittently tripped Blotato's
      // media converter. Compress + host them on Blotato first (same as the
      // engine), and cache the result so a retry never redoes the upload.
      let mediaUrls = meta.blotatoUrls ?? [];
      const cacheUsable =
        mediaUrls.length === slideUrls.length && mediaUrls.every((u) => isBlotatoMediaUrl(u));
      if (!cacheUsable) {
        try {
          mediaUrls = await prepareMediaUrls(slideUrls, apiKey);
        } catch (e) {
          await revert(`Media prep failed — ${e instanceof Error ? e.message : e}`);
          continue;
        }
        meta.blotatoUrls = mediaUrls;
        // Persist before posting: if the submit fails, the expensive upload work
        // is still banked for the retry.
        await sb
          .from("posts")
          .update({ failure_resolution_note: JSON.stringify(meta) })
          .eq("id", id);
      }

      const payload = {
        post: {
          accountId,
          content: { text: meta.caption ?? "", mediaUrls, platform: "tiktok" },
          target: {
            targetType: "tiktok",
            privacyLevel: "PUBLIC_TO_EVERYONE",
            disabledComments: false,
            disabledDuet: false,
            disabledStitch: false,
            isBrandedContent: false,
            isYourBrand: false,
            isAiGenerated: true,
            // Direct publish, not a TikTok draft. The bank exists to run the
            // accounts autonomously — a scheduled post that lands in the drafts
            // folder never goes out. Matches the sibling "Post now" route and
            // the engine's --path=direct.
            isDraft: false,
            autoAddMusic: true,
            title: (meta.title ?? "").slice(0, 90),
          },
        },
        scheduledTime: when.toISOString(), // root level, not inside `post`
      };

      const submitted = await submitPost(payload, apiKey);
      if (!submitted.ok) {
        await revert(submitted.error);
        continue;
      }

      // Past this point Blotato holds the scheduled post — the side effect is
      // irreversible, so a failure to record it must be surfaced rather than
      // swallowed: the row would stay `posting` with no scheduledAt, and the
      // next plan wouldn't know the slot is taken.
      const nextMeta: Meta = {
        ...meta,
        scheduledAt: when.toISOString(),
        submissionId: submitted.submissionId ?? undefined,
      };
      const istDate = new Date(when.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 10);
      const { error: saveErr } = await sb
        .from("posts")
        .update({
          status: "scheduled",
          failure_resolution_note: JSON.stringify(nextMeta),
          date: istDate,
        })
        .eq("id", id);
      if (saveErr) {
        results.push({
          id,
          ok: false,
          scheduledAt: when.toISOString(),
          istLabel: formatIst(when.toISOString()),
          error:
            `SUBMITTED to Blotato (${submitted.submissionId}) but the status write failed: ` +
            `${saveErr.message}. The slot IS taken — do not re-schedule this post.`,
        });
        continue;
      }

      results.push({
        id,
        ok: true,
        scheduledAt: when.toISOString(),
        istLabel: formatIst(when.toISOString()),
      });
      // Rate limiting lives in lib/blotato — media uploads and post submissions
      // share one 30 req/min budget, so no extra sleep is needed here.
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (claimed) await revert(`Unexpected error — ${msg}`);
      else results.push({ id, ok: false, error: msg });
    }
  }

  return NextResponse.json({ ok: true, results });
}
