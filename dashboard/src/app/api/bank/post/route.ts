import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

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
  let id: string | undefined;
  try {
    ({ id } = await req.json());
  } catch {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }
  if (!id) return NextResponse.json({ error: "Missing post id" }, { status: 400 });

  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { data: row, error } = await sb.from("posts").select("*").eq("id", id).single();
  if (error || !row) return NextResponse.json({ error: "Post not found" }, { status: 404 });

  let meta: { caption?: string; title?: string; slideUrls?: string[] } = {};
  try {
    meta = JSON.parse(row.failure_resolution_note || "{}");
  } catch {
    /* ignore */
  }
  const slideUrls = meta.slideUrls ?? [];
  const accountId = BLOTATO_IDS[row.account as string];
  const apiKey = process.env.BLOTATO_API_KEY;

  if (!accountId)
    return NextResponse.json({ error: `No Blotato account for "${row.account}"` }, { status: 400 });
  if (!slideUrls.length)
    return NextResponse.json({ error: "No slides on this post" }, { status: 400 });
  if (!apiKey)
    return NextResponse.json({ error: "BLOTATO_API_KEY not configured in dashboard env" }, { status: 500 });

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

  const res = await fetch("https://backend.blotato.com/v2/posts", {
    method: "POST",
    headers: { "Content-Type": "application/json", "blotato-api-key": apiKey },
    body: JSON.stringify(body),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    return NextResponse.json(
      { error: j?.message || `Blotato error ${res.status}`, detail: j },
      { status: 502 }
    );
  }

  const submissionId = j.postSubmissionId ?? j.submissionId ?? j.id ?? null;
  await sb.from("posts").update({ status: "posted" }).eq("id", id);
  return NextResponse.json({ ok: true, submissionId });
}
