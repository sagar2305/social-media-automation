import { createHmac, timingSafeEqual } from "node:crypto";
import {
  approveCreddyItemFromSlack,
  rejectCreddyItem,
  resolveCreddySlackReview,
} from "@/lib/creddy-file-store";

type SlackPayload = {
  user?: { id?: string; username?: string };
  actions?: Array<{ action_id?: string; value?: string }>;
};

function verifySlackRequest(body: string, timestamp: string, signature: string, secret: string): boolean {
  const seconds = Number(timestamp);
  if (!Number.isFinite(seconds) || Math.abs(Date.now() / 1000 - seconds) > 300) return false;
  const expected = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`).digest("hex")}`;
  const actualBytes = Buffer.from(signature);
  const expectedBytes = Buffer.from(expected);
  return actualBytes.length === expectedBytes.length && timingSafeEqual(actualBytes, expectedBytes);
}

export async function GET() {
  return Response.json(
    { ok: true, service: "creddy-slack-actions" },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(request: Request) {
  const secret = process.env.SLACK_SIGNING_SECRET?.trim();
  if (!secret) return new Response("Slack integration is not configured", { status: 503 });
  const body = await request.text();
  const timestamp = request.headers.get("x-slack-request-timestamp") ?? "";
  const signature = request.headers.get("x-slack-signature") ?? "";
  if (!verifySlackRequest(body, timestamp, signature, secret)) {
    return new Response("Invalid Slack signature", { status: 401 });
  }
  try {
    const encoded = new URLSearchParams(body).get("payload");
    if (!encoded) throw new Error("Slack payload is missing");
    const payload = JSON.parse(encoded) as SlackPayload;
    const action = payload.actions?.[0];
    const actor = payload.user?.username || payload.user?.id;
    if (!action?.action_id || !action.value || !payload.user?.id || !actor) {
      throw new Error("Unsupported Slack action");
    }
    if (action.action_id === "creddy_content_approve") {
      await approveCreddyItemFromSlack({ id: action.value, approvedBy: `Slack: ${actor}` });
      return Response.json({
        replace_original: true,
        text: `✅ Creddy post approved in the portal by ${actor}. Nothing was scheduled or published.`,
      });
    }
    if (action.action_id === "creddy_content_reject") {
      await rejectCreddyItem({
        id: action.value,
        rejectedBy: `Slack: ${actor}`,
        reason: `Rejected from the Slack Agent 7 review by ${actor}`,
      });
      return Response.json({
        replace_original: true,
        text: `❌ Creddy post rejected by ${actor}. It is stored in the portal's Rejected section and can be restored there.`,
      });
    }
    const mapping = {
      creddy_process: "process",
      creddy_skip: "skip",
      creddy_hold: "hold",
    } as const;
    const resolution = mapping[action.action_id as keyof typeof mapping];
    if (!resolution) throw new Error("Unsupported Slack action");
    await resolveCreddySlackReview({
      id: action.value,
      action: resolution,
      resolvedBy: actor,
    });
    return Response.json({
      replace_original: true,
      text: `Creddy review resolved: ${resolution} by ${actor}`,
    });
  } catch (error) {
    return Response.json({ response_type: "ephemeral", text: (error as Error).message }, { status: 400 });
  }
}
