type CreddySlackEvent =
  | {
      kind: "scheduled";
      id: string;
      hook: string;
      platform: string;
      account: string;
      scheduledFor: string;
      actor?: string;
    }
  | {
      kind: "published";
      id: string;
      hook: string;
      platform: string;
      account: string;
      publishedAt: string;
      publishedUrl?: string;
    }
  | {
      kind: "rejected";
      id: string;
      hook: string;
      reason: string;
      rejectedAt: string;
      actor?: string;
    }
  | {
      kind: "draft_sent" | "post_now" | "delivery_failed";
      id: string;
      hook: string;
      platform: string;
      account: string;
      occurredAt: string;
      actor?: string;
      submissionId?: string;
      error?: string;
    };

type SlackBlock = Record<string, unknown>;

function clean(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function messageFor(event: CreddySlackEvent): { text: string; blocks: SlackBlock[] } {
  const title = event.kind === "scheduled"
    ? "Creddy post scheduled"
    : event.kind === "published"
      ? "Creddy post published"
      : event.kind === "rejected"
        ? "Creddy post rejected"
        : event.kind === "draft_sent"
          ? "Creddy post sent to TikTok drafts"
          : event.kind === "post_now"
            ? "Creddy Post now submitted"
            : "Creddy delivery failed";
  const emoji = event.kind === "scheduled"
    ? ":calendar:"
    : event.kind === "published" || event.kind === "draft_sent" || event.kind === "post_now"
      ? ":white_check_mark:"
      : ":no_entry_sign:";
  const details = event.kind === "scheduled"
    ? `*Platform:* ${clean(event.platform)}\n*Account:* ${clean(event.account)}\n*Scheduled for:* ${clean(new Date(event.scheduledFor).toLocaleString("en-US", { timeZone: "Asia/Kolkata", timeZoneName: "short" }))}${event.actor ? `\n*Scheduled by:* ${clean(event.actor)}` : ""}`
    : event.kind === "published"
      ? `*Platform:* ${clean(event.platform)}\n*Account:* ${clean(event.account)}\n*Published at:* ${clean(new Date(event.publishedAt).toLocaleString("en-US", { timeZone: "Asia/Kolkata", timeZoneName: "short" }))}${event.publishedUrl ? `\n*Public post:* <${event.publishedUrl}|Open post>` : ""}`
      : event.kind === "rejected"
        ? `*Reason:* ${clean(event.reason)}\n*Rejected at:* ${clean(new Date(event.rejectedAt).toLocaleString("en-US", { timeZone: "Asia/Kolkata", timeZoneName: "short" }))}${event.actor ? `\n*Rejected by:* ${clean(event.actor)}` : ""}`
        : `*Platform:* ${clean(event.platform)}\n*Account:* ${clean(event.account)}\n*Time:* ${clean(new Date(event.occurredAt).toLocaleString("en-US", { timeZone: "Asia/Kolkata", timeZoneName: "short" }))}${event.actor ? `\n*Action by:* ${clean(event.actor)}` : ""}${event.submissionId ? `\n*Submission ID:* \`${clean(event.submissionId)}\`` : ""}${event.error ? `\n*Error:* ${clean(event.error)}` : ""}`;
  const blocks: SlackBlock[] = [
    { type: "header", text: { type: "plain_text", text: `${emoji} ${title}`, emoji: true } },
    { type: "section", text: { type: "mrkdwn", text: `*${clean(event.hook)}*\n${details}` } },
    {
      type: "actions",
      elements: [{
        type: "button",
        action_id: "creddy_content_open",
        value: event.id,
        text: { type: "plain_text", text: "View details in Slack", emoji: true },
      }],
    },
  ];
  return { text: `${title}: ${event.hook}`, blocks };
}

async function wait(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function notifyCreddySlack(event: CreddySlackEvent): Promise<boolean> {
  const webhook = process.env.SLACK_SOCIAL_UPDATES_WEBHOOK_URL?.trim() || process.env.SLACK_ALERT_WEBHOOK?.trim();
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  const channel = process.env.SLACK_SOCIAL_UPDATES_CHANNEL_ID?.trim();
  if (!webhook && !(token && channel)) {
    console.info("[Creddy Slack] Notification skipped because Slack is not configured");
    return false;
  }

  const message = messageFor(event);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = webhook
        ? await fetch(webhook, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(message),
            signal: AbortSignal.timeout(8_000),
          })
        : await fetch("https://slack.com/api/chat.postMessage", {
            method: "POST",
            headers: { authorization: `Bearer ${token}`, "content-type": "application/json; charset=utf-8" },
            body: JSON.stringify({ channel, ...message }),
            signal: AbortSignal.timeout(8_000),
          });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!webhook) {
        const result = await response.json() as { ok?: boolean; error?: string };
        if (!result.ok) throw new Error(result.error || "Slack rejected the message");
      }
      return true;
    } catch (error) {
      if (attempt === 3) {
        console.error(`[Creddy Slack] ${event.kind} notification failed after 3 attempts:`, (error as Error).message);
        return false;
      }
      await wait(250 * 2 ** (attempt - 1));
    }
  }
  return false;
}
