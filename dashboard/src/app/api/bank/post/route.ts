import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";
import {
  getTiktokAccounts,
  prepareMediaUrls,
  prepareVideoUrl,
  isBlotatoMediaUrl,
  submitPost,
  buildTikTokPostBody,
} from "@/lib/blotato";

// sharp (via lib/blotato) needs the Node runtime, not Edge.
export const runtime = "nodejs";

// Publish a banked post immediately. No scheduledTime → immediate publish, which
// does NOT count against Blotato's 200 scheduled-post cap. Mirrors the engine's
// postViaBlotato payload.
export async function POST(req: NextRequest) {
  let rawId: string | undefined;
  try {
    ({ id: rawId } = await req.json());
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!rawId) return NextResponse.json({ error: "Missing post id" }, { status: 400 });
  const id: string = rawId;

  // Session-aware client (reads the request's auth cookies) — this both enforces
  // auth and applies the signed-in user's RLS to every DB op below.
  const sb = await createClient();

  // Auth gate: only signed-in dashboard users may trigger a publish.
  const {
    data: { user },
  } = await sb.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Atomically claim the row (banked → posting) so two concurrent requests can't
  // both submit the same post. If nothing is claimed, it's already posted/claimed.
  const { data: claimed, error: claimErr } = await sb
    .from("posts")
    .update({ status: "posting" })
    .eq("id", id)
    .eq("status", "banked")
    .select("*");
  if (claimErr) return NextResponse.json({ error: claimErr.message }, { status: 500 });
  if (!claimed || claimed.length === 0) {
    return NextResponse.json(
      { error: "This post is no longer available (already posted or in progress)." },
      { status: 409 }
    );
  }
  const row = claimed[0];

  // Any precondition/publish failure reverts the claim so the post stays usable.
  const revert = async (error: string, status: number) => {
    await sb.from("posts").update({ status: "banked" }).eq("id", id);
    return NextResponse.json({ error }, { status });
  };

  let meta: {
    caption?: string;
    title?: string;
    slideUrls?: string[];
    blotatoUrls?: string[];
    /** Absent on every pre-video row — those are slideshows, as before. */
    mediaType?: "slideshow" | "video";
    videoUrl?: string;
  } = {};
  try {
    meta = JSON.parse(row.failure_resolution_note || "{}");
  } catch {
    /* ignore */
  }
  const isVideo = meta.mediaType === "video";
  const slideUrls = meta.slideUrls ?? [];
  const apiKey = process.env.BLOTATO_API_KEY;

  if (isVideo) {
    if (!meta.videoUrl) return revert("No video URL on this post", 400);
  } else if (!slideUrls.length) {
    return revert("No slides on this post", 400);
  }
  if (!apiKey) return revert("BLOTATO_API_KEY not configured in dashboard env", 500);

  // Resolved live — the ids in config/config.ts are stale for @yournotetaker
  // (36969 upstream, not the `cmm…` id), which failed every post on that account.
  let accountId: string | undefined;
  try {
    accountId = (await getTiktokAccounts(apiKey)).get(String(row.account).toLowerCase());
  } catch (e) {
    return revert(e instanceof Error ? e.message : "Blotato account lookup failed", 502);
  }
  if (!accountId) return revert(`No live Blotato account for "${row.account}"`, 400);

  // Host the media on Blotato and cache the result, so a retry never redoes the
  // upload. Videos pass their public URL through for Blotato to fetch
  // server-side; slides are compressed and inlined as base64 (2-3MB PNGs have
  // intermittently tripped Blotato's media converter).
  let mediaUrls = meta.blotatoUrls ?? [];
  const expectedCount = isVideo ? 1 : slideUrls.length;
  const cacheUsable =
    mediaUrls.length === expectedCount && mediaUrls.every((u) => isBlotatoMediaUrl(u));
  if (!cacheUsable) {
    try {
      mediaUrls = isVideo
        ? [await prepareVideoUrl(meta.videoUrl!, apiKey)]
        : await prepareMediaUrls(slideUrls, apiKey);
    } catch (e) {
      return revert(`Media prep failed — ${e instanceof Error ? e.message : e}`, 502);
    }
    meta.blotatoUrls = mediaUrls;
    await sb
      .from("posts")
      .update({ failure_resolution_note: JSON.stringify(meta) })
      .eq("id", id);
  }

  // no scheduledTime → immediate publish (bypasses the 200 scheduled-post cap)
  const body = buildTikTokPostBody({
    accountId,
    caption: meta.caption ?? "",
    mediaUrls,
    title: meta.title ?? "",
    isVideo,
  });

  const submitted = await submitPost(body, apiKey);
  if (!submitted.ok) return revert(submitted.error, 502);

  // Blotato has published by this point — the side effect is irreversible, so a
  // failure to record it must be reported, not swallowed. Reverting to `banked`
  // here would be worse than useless: it would invite a duplicate publish. The
  // row stays `posting` and the caller is told to reconcile.
  const { error: saveErr } = await sb
    .from("posts")
    .update({
      status: "posted",
      // Persisted so the daily refresh can reconcile real status/URL later.
      failure_resolution_note: JSON.stringify({ ...meta, submissionId: submitted.submissionId }),
    })
    .eq("id", id);
  if (saveErr) {
    return NextResponse.json(
      {
        ok: false,
        submissionId: submitted.submissionId,
        error:
          `Published to Blotato (${submitted.submissionId}) but recording it failed: ` +
          `${saveErr.message}. Do NOT re-post — reconcile this row manually.`,
      },
      { status: 500 }
    );
  }
  return NextResponse.json({ ok: true, submissionId: submitted.submissionId });
}
