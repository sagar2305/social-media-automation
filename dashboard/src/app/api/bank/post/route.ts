import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase";

// Blotato account IDs for the connected TikTok accounts (from config/config.ts).
const BLOTATO_IDS: Record<string, string> = {
  yournotetaker: "cmmxd7lo605mnle0y2xe2o1x6",
  "grow.withamanda": "37045",
  miniutewise_thomas: "37043",
  "grow.with.claudia": "37047",
};

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

  let meta: { caption?: string; title?: string; slideUrls?: string[] } = {};
  try {
    meta = JSON.parse(row.failure_resolution_note || "{}");
  } catch {
    /* ignore */
  }
  const slideUrls = meta.slideUrls ?? [];
  const accountId = BLOTATO_IDS[row.account as string];
  const apiKey = process.env.BLOTATO_API_KEY;

  if (!accountId) return revert(`No Blotato account for "${row.account}"`, 400);
  if (!slideUrls.length) return revert("No slides on this post", 400);
  if (!apiKey) return revert("BLOTATO_API_KEY not configured in dashboard env", 500);

  const body = {
    post: {
      accountId,
      content: { text: meta.caption ?? "", mediaUrls: slideUrls, platform: "tiktok" },
      target: {
        targetType: "tiktok",
        privacyLevel: "PUBLIC_TO_EVERYONE",
        disabledComments: false,
        disabledDuet: false,
        disabledStitch: false,
        isBrandedContent: false,
        isYourBrand: false,
        isAiGenerated: true,
        isDraft: false,
        autoAddMusic: true,
        title: (meta.title ?? "").slice(0, 90),
      },
    },
    // no scheduledTime → immediate publish (bypasses the 200 scheduled-post cap)
  };

  let res: Response;
  try {
    res = await fetch("https://backend.blotato.com/v2/posts", {
      method: "POST",
      headers: { "Content-Type": "application/json", "blotato-api-key": apiKey },
      body: JSON.stringify(body),
    });
  } catch (e) {
    return revert(e instanceof Error ? e.message : "Network error reaching Blotato", 502);
  }
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return revert(j?.message || `Blotato error ${res.status}`, 502);

  const submissionId = j.postSubmissionId ?? j.submissionId ?? j.id ?? null;
  await sb.from("posts").update({ status: "posted" }).eq("id", id);
  return NextResponse.json({ ok: true, submissionId });
}
