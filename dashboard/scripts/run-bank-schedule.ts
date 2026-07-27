/**
 * Executes the Content Bank schedule from the CLI, using the SAME library
 * functions as /api/bank/schedule (getTiktokAccounts, prepareMediaUrls,
 * submitPost, buildSchedulePlan) — only the Supabase client differs.
 *
 *   npx tsx scripts/run-bank-schedule.ts --start=2026-07-28 --limit=1
 *   npx tsx scripts/run-bank-schedule.ts --start=2026-07-28          # all
 *
 * Safety:
 *   - claims each row banked → posting before submitting, so a second run
 *     can never double-submit the same post
 *   - reverts to banked on any failure, recording the reason
 *   - only schedules slots in the future, only for connected accounts
 *   - prepared media is cached in meta, so a re-run skips the upload work
 *
 * THIS SUBMITS REAL SCHEDULED POSTS. Blotato has no delete endpoint.
 */
import { readFileSync, appendFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { getTiktokAccounts, prepareMediaUrls, isBlotatoMediaUrl, submitPost } from "../src/lib/blotato";
import { buildSchedulePlan, slotKey, type BankPostLite } from "../src/lib/bank-schedule";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG = resolve(__dirname, "..", "..", "data", "bank-schedule-run.log");

function env(name: string): string {
  for (const file of [".env.local", "../.env.local"]) {
    try {
      const line = readFileSync(resolve(__dirname, "..", file), "utf8")
        .split("\n")
        .find((l) => l.startsWith(`${name}=`));
      if (line) return line.slice(name.length + 1).trim();
    } catch {
      /* try next */
    }
  }
  throw new Error(`Missing ${name}`);
}

function arg(name: string, fallback?: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split("=")[1] : fallback;
}

/** Tomorrow in IST — the same default the dashboard uses. */
function tomorrowIst(): string {
  return new Date(Date.now() + 5.5 * 3_600_000 + 86_400_000).toISOString().slice(0, 10);
}

function log(line: string) {
  console.log(line);
  try {
    appendFileSync(LOG, `${new Date().toISOString()} ${line}\n`);
  } catch {
    /* logging is best-effort */
  }
}

interface Meta {
  caption?: string;
  title?: string;
  slideUrls?: string[];
  blotatoUrls?: string[];
  scheduledAt?: string;
  submissionId?: string;
}

async function main() {
  const apiKey = env("BLOTATO_API_KEY");
  const sb = createClient(env("NEXT_PUBLIC_SUPABASE_URL"), env("NEXT_PUBLIC_SUPABASE_ANON_KEY"));
  const startDate = arg("start", tomorrowIst())!;
  // Number("one") is NaN and NaN > 0 is false, which would quietly schedule the
  // ENTIRE plan when the operator asked for a couple of posts — on a tool whose
  // writes cannot be undone. Refuse anything non-numeric.
  const rawLimit = arg("limit", "0")!;
  const limit = Number(rawLimit);
  if (!Number.isInteger(limit) || limit < 0) {
    throw new Error(`--limit must be a non-negative integer, got "${rawLimit}"`);
  }

  const { data, error } = await sb
    .from("posts")
    .select("id, account, created_at, failure_resolution_note")
    .eq("status", "banked")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const posts: BankPostLite[] = (data ?? []).map((p) => {
    let title: string | undefined;
    try {
      title = (JSON.parse((p.failure_resolution_note as string) || "{}") as Meta).title;
    } catch {
      /* ignore */
    }
    return {
      id: p.id as string,
      account: p.account as string,
      created_at: p.created_at as string,
      title,
    };
  });

  const accounts = await getTiktokAccounts(apiKey);
  const connected = new Set(accounts.keys());

  // Slots already taken by scheduled posts. Without this, a second run restarts
  // each lane at startDate and double-books — which Blotato cannot undo.
  const { data: already, error: occErr } = await sb
    .from("posts")
    .select("account, failure_resolution_note")
    .eq("status", "scheduled");
  // A failed query would yield an empty occupied set, which silently disables
  // double-booking protection — and a double-booking cannot be deleted. Abort.
  if (occErr) throw new Error(`Could not read scheduled slots: ${occErr.message}`);
  const occupied = new Set<string>();
  for (const p of already ?? []) {
    try {
      const at = (JSON.parse((p.failure_resolution_note as string) || "{}") as Meta).scheduledAt;
      if (at) occupied.add(slotKey(p.account as string, at));
    } catch {
      /* ignore */
    }
  }
  log(`occupied slots already scheduled: ${occupied.size}`);

  const plan = buildSchedulePlan({ posts, startDate, connected, occupied });

  const queue = limit > 0 ? plan.items.slice(0, limit) : plan.items;
  log(`=== run start: ${queue.length} of ${plan.items.length} planned posts, from ${startDate} ===`);
  for (const s of plan.skipped) log(`skipped ${s.count} × @${s.account} — ${s.reason}`);

  let ok = 0;
  const failures: { id: string; error: string }[] = [];

  for (let i = 0; i < queue.length; i++) {
    const item = queue[i];
    const when = new Date(item.scheduledAt);
    const prefix = `[${i + 1}/${queue.length}] ${item.istLabel} @${item.account}`;

    if (when.getTime() < Date.now() + 15 * 60_000) {
      failures.push({ id: item.id, error: "slot no longer in the future" });
      log(`${prefix} — SKIP: slot passed`);
      continue;
    }

    const { data: claimed, error: claimErr } = await sb
      .from("posts")
      .update({ status: "posting" })
      .eq("id", item.id)
      .eq("status", "banked")
      .select("*");
    if (claimErr || !claimed?.length) {
      const reason = claimErr?.message ?? "already claimed / not banked";
      failures.push({ id: item.id, error: reason });
      log(`${prefix} — SKIP: ${reason}`);
      continue;
    }
    const row = claimed[0];
    // The revert write is itself checked: when a network blip took out both an
    // upload and its revert, the row was stranded in `posting` where nothing
    // could reclaim it. Surfacing it points the operator at unstick-posting.ts.
    const revert = async (reason: string) => {
      const { error: revertErr } = await sb
        .from("posts")
        .update({ status: "banked" })
        .eq("id", item.id)
        .eq("status", "posting");
      const full = revertErr
        ? `${reason} (REVERT FAILED: ${revertErr.message} — row stranded in "posting", run unstick-posting.ts)`
        : reason;
      failures.push({ id: item.id, error: full });
      log(`${prefix} — FAIL: ${full}`);
    };

    let meta: Meta = {};
    try {
      meta = JSON.parse((row.failure_resolution_note as string) || "{}");
    } catch {
      /* ignore */
    }
    const slideUrls = meta.slideUrls ?? [];
    const accountId = accounts.get(String(row.account).toLowerCase());
    if (!accountId) {
      await revert(`no live Blotato account for @${row.account}`);
      continue;
    }
    if (!slideUrls.length) {
      await revert("no slides");
      continue;
    }
    if (!(meta.caption ?? "").trim()) {
      await revert("empty caption");
      continue;
    }

    let mediaUrls = meta.blotatoUrls ?? [];
    const cacheUsable =
      mediaUrls.length === slideUrls.length && mediaUrls.every((u) => isBlotatoMediaUrl(u));
    if (!cacheUsable) {
      try {
        mediaUrls = await prepareMediaUrls(slideUrls, apiKey);
      } catch (e) {
        await revert(`media prep — ${e instanceof Error ? e.message : e}`);
        continue;
      }
      meta.blotatoUrls = mediaUrls;
      await sb
        .from("posts")
        .update({ failure_resolution_note: JSON.stringify(meta) })
        .eq("id", item.id);
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
          // Direct publish, not a TikTok draft — a scheduled post that lands in
          // the drafts folder never goes out. Matches the API route.
          isDraft: false,
          autoAddMusic: true,
          title: (meta.title ?? "").slice(0, 90),
        },
      },
      scheduledTime: when.toISOString(),
    };

    const submitted = await submitPost(payload, apiKey);
    if (!submitted.ok) {
      await revert(submitted.error);
      continue;
    }

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
      .eq("id", item.id);
    if (saveErr) {
      // Blotato already holds the post; the slot IS taken. Never revert here —
      // that would invite a duplicate on the next run, which cannot be deleted.
      const msg =
        `SUBMITTED (${submitted.submissionId}) but status write failed: ${saveErr.message}. ` +
        `Slot is taken — do NOT re-schedule this post.`;
      failures.push({ id: item.id, error: msg });
      log(`${prefix} — WARN: ${msg}`);
      continue;
    }

    ok++;
    log(`${prefix} — OK submission=${submitted.submissionId} slides=${mediaUrls.length}`);
  }

  log(`=== run end: ${ok} scheduled, ${failures.length} failed ===`);
  for (const f of failures) log(`  failed: ${f.id} — ${f.error}`);
  console.log(`\nlog written to ${LOG}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
