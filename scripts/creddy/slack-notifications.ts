import { basename } from 'node:path';
import { readFile, stat } from 'node:fs/promises';

import { optionalStableDashboardBaseUrl, requireStableDashboardBaseUrl } from './public-dashboard.js';

export type CreddyPublishedSlackEvent = {
  id: string;
  hook: string;
  platform: string;
  account: string;
  publishedAt: string;
  publishedUrl?: string;
};

export type CreddyContentReadySlackEvent = {
  id: string;
  hook: string;
  instagramCaption: string;
  tiktokCaption: string;
  hashtags: string[];
  slideImagePaths: string[];
};

export type CreddyContentReadySlackResult = {
  sent: boolean;
  channel?: string;
  messageTs?: string;
  fileIds?: string[];
  error?: string;
};

function clean(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function slackApi<T extends { ok?: boolean; error?: string }>(
  method: string,
  token: string,
  body: Record<string, unknown>,
  encoding: 'json' | 'form' = 'json',
): Promise<T> {
  let lastError = `${method} failed`;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = await fetch(`https://slack.com/api/${method}`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': encoding === 'form'
            ? 'application/x-www-form-urlencoded; charset=utf-8'
            : 'application/json; charset=utf-8',
        },
        body: encoding === 'form'
          ? new URLSearchParams(Object.entries(body).map(([key, value]) => [key, String(value)])).toString()
          : JSON.stringify(body),
        signal: AbortSignal.timeout(15_000),
      });
      if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
      const result = await response.json() as T;
      if (!result.ok) throw new Error(result.error || `${method} was rejected by Slack`);
      return result;
    } catch (error) {
      lastError = (error as Error).message;
      if (attempt < 3) await delay(500 * 2 ** (attempt - 1));
    }
  }
  throw new Error(lastError);
}

async function uploadSlidesToSlack(token: string, channel: string, paths: string[]): Promise<string[]> {
  const files: Array<{ id: string; title: string }> = [];
  for (let index = 0; index < paths.length; index += 1) {
    const path = paths[index]!;
    const info = await stat(path);
    if (!info.isFile()) throw new Error(`Slide ${index + 1} is not a file`);
    const ticket = await slackApi<{ ok?: boolean; error?: string; upload_url?: string; file_id?: string }>(
      'files.getUploadURLExternal', token,
      { filename: basename(path), length: info.size },
      'form',
    );
    if (!ticket.upload_url || !ticket.file_id) throw new Error('Slack did not return a file upload ticket');
    const bytes = await readFile(path);
    let uploaded = false;
    for (let attempt = 1; attempt <= 3 && !uploaded; attempt += 1) {
      const upload = await fetch(ticket.upload_url, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream' },
        body: bytes,
        signal: AbortSignal.timeout(30_000),
      });
      uploaded = upload.ok;
      if (!uploaded && attempt < 3) await delay(500 * 2 ** (attempt - 1));
      if (!uploaded && attempt === 3) throw new Error(`Slide ${index + 1} upload returned HTTP ${upload.status}`);
    }
    files.push({ id: ticket.file_id, title: `Creddy slide ${index + 1} of 6` });
  }
  await slackApi('files.completeUploadExternal', token, {
    files,
    channel_id: channel,
    initial_comment: ':frame_with_picture: All 6 rendered slides for the Creddy post below.',
  });
  return files.map((file) => file.id);
}

export async function notifyCreddyContentReady(
  event: CreddyContentReadySlackEvent,
): Promise<CreddyContentReadySlackResult> {
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  const channel = process.env.SLACK_SOCIAL_UPDATES_CHANNEL_ID?.trim();
  if (!token || !channel) return { sent: false, error: 'SLACK_BOT_TOKEN or SLACK_SOCIAL_UPDATES_CHANNEL_ID is missing' };
  if (event.slideImagePaths.length !== 6) return { sent: false, error: 'Exactly 6 slide images are required' };

  let base: string;
  try {
    base = requireStableDashboardBaseUrl();
  } catch (error) {
    return { sent: false, channel, error: (error as Error).message };
  }
  const item = encodeURIComponent(event.id);
  const portalUrl = `${base}/creddy/content-bank/slideshows?item=${item}#${item}`;
  const hashtags = event.hashtags.map((tag) => tag.startsWith('#') ? tag : `#${tag}`).join(' ');
  const copy = `*Instagram caption*\n${clean(event.instagramCaption)}\n\n*TikTok caption*\n${clean(event.tiktokCaption)}\n\n*Hashtags*\n${clean(hashtags)}`;
  const blocks: Array<Record<string, unknown>> = [
    { type: 'header', text: { type: 'plain_text', text: ':sparkles: Agent 7: post ready for review', emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${clean(event.hook)}*\nAll six rendered slides are attached in Slack. Review the exact copy below.` } },
    { type: 'section', text: { type: 'mrkdwn', text: copy.slice(0, 2900) } },
    {
      type: 'actions',
      elements: [
        { type: 'button', style: 'primary', action_id: 'creddy_content_approve', value: event.id, text: { type: 'plain_text', text: '✓ Approve in portal', emoji: true }, confirm: { title: { type: 'plain_text', text: 'Approve this post?' }, text: { type: 'mrkdwn', text: 'This marks the post approved in Creddy. It will *not* publish or schedule anything.' }, confirm: { type: 'plain_text', text: 'Approve' }, deny: { type: 'plain_text', text: 'Cancel' } } },
        { type: 'button', style: 'danger', action_id: 'creddy_content_reject', value: event.id, text: { type: 'plain_text', text: 'Reject', emoji: true }, confirm: { title: { type: 'plain_text', text: 'Reject this post?' }, text: { type: 'mrkdwn', text: 'This moves the post to Rejected in Creddy. You can undo it later from the portal.' }, confirm: { type: 'plain_text', text: 'Reject' }, deny: { type: 'plain_text', text: 'Cancel' } } },
        { type: 'button', action_id: 'creddy_content_open', url: portalUrl, text: { type: 'plain_text', text: 'Open full review', emoji: true } },
      ],
    },
  ];

  try {
    const fileIds = await uploadSlidesToSlack(token, channel, event.slideImagePaths);
    const message = await slackApi<{ ok?: boolean; error?: string; ts?: string }>('chat.postMessage', token, {
      channel,
      text: `Creddy post ready for review: ${event.hook}`,
      blocks,
    });
    return { sent: true, channel, messageTs: message.ts, fileIds };
  } catch (error) {
    const lastError = (error as Error).message;
    console.error('[Creddy Slack] Agent 7 review notification failed after retries:', lastError);
    return { sent: false, channel, error: lastError };
  }
}

export async function notifyCreddyPublished(event: CreddyPublishedSlackEvent): Promise<boolean> {
  const webhook = process.env.SLACK_SOCIAL_UPDATES_WEBHOOK_URL?.trim() || process.env.SLACK_ALERT_WEBHOOK?.trim();
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  const channel = process.env.SLACK_SOCIAL_UPDATES_CHANNEL_ID?.trim();
  if (!webhook && !(token && channel)) return false;

  const base = optionalStableDashboardBaseUrl();
  const item = encodeURIComponent(event.id);
  const portalUrl = base ? `${base}/creddy/content-bank/slideshows?item=${item}#${item}` : undefined;
  const blocks: Array<Record<string, unknown>> = [
    { type: 'header', text: { type: 'plain_text', text: ':white_check_mark: Creddy post published', emoji: true } },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${clean(event.hook)}*\n*Platform:* ${clean(event.platform)}\n*Account:* ${clean(event.account)}\n*Published at:* ${clean(new Date(event.publishedAt).toLocaleString('en-US', { timeZone: 'Asia/Kolkata', timeZoneName: 'short' }))}${event.publishedUrl ? `\n*Public post:* <${event.publishedUrl}|Open post>` : ''}`,
      },
    },
  ];
  if (portalUrl) {
    blocks.push({ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in Creddy', emoji: true }, url: portalUrl }] });
  }
  const message = { text: `Creddy post published: ${event.hook}`, blocks };

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      const response = webhook
        ? await fetch(webhook, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(message),
            signal: AbortSignal.timeout(8_000),
          })
        : await fetch('https://slack.com/api/chat.postMessage', {
            method: 'POST',
            headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json; charset=utf-8' },
            body: JSON.stringify({ channel, ...message }),
            signal: AbortSignal.timeout(8_000),
          });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      if (!webhook) {
        const result = await response.json() as { ok?: boolean; error?: string };
        if (!result.ok) throw new Error(result.error || 'Slack rejected the message');
      }
      return true;
    } catch (error) {
      if (attempt === 3) {
        console.error('[Creddy Slack] published notification failed after 3 attempts:', (error as Error).message);
        return false;
      }
      await delay(250 * 2 ** (attempt - 1));
    }
  }
  return false;
}
