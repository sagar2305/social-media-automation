import { basename } from 'node:path';
import { readFile, stat } from 'node:fs/promises';
import type { CreddyVerificationGate } from './pipeline-types.js';

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
  verificationGate?: CreddyVerificationGate;
};

export type CreddyContentReadySlackResult = {
  sent: boolean;
  channel?: string;
  messageTs?: string;
  fileIds?: string[];
  error?: string;
};

export type CreddyArticleReadySlackEvent = {
  id: string;
  title: string;
  dek: string;
  excerpt: string;
  category: string;
  readingMinutes: number;
  sourceUrls: string[];
  articleImagePaths: string[];
  articlePreviewPath: string;
  publishStatus?: 'published' | 'publish_failed' | 'publishing' | 'unpublished';
  publishedUrl?: string;
  publishError?: string;
};

type SlackBlock = Record<string, unknown>;

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

async function uploadArticleFilesToSlack(
  token: string,
  channel: string,
  event: CreddyArticleReadySlackEvent,
): Promise<string[]> {
  const embeddedPreview = await selfContainedArticlePreview(event);
  const entries = [{
    bytes: embeddedPreview,
    filename: `${event.id}-complete-preview.html`,
    title: `Creddy article preview with embedded images: ${event.title}`,
  }];
  const files: Array<{ id: string; title: string }> = [];
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]!;
    const bytes = entry.bytes;
    const ticket = await slackApi<{ ok?: boolean; error?: string; upload_url?: string; file_id?: string }>(
      'files.getUploadURLExternal', token,
      { filename: entry.filename, length: bytes.byteLength },
      'form',
    );
    if (!ticket.upload_url || !ticket.file_id) throw new Error('Slack did not return an article file upload ticket');
    const response = await fetch(ticket.upload_url, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.from(bytes),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Article review file ${index + 1} upload returned HTTP ${response.status}`);
    files.push({ id: ticket.file_id, title: entry.title });
  }
  await slackApi('files.completeUploadExternal', token, {
    files,
    channel_id: channel,
    initial_comment: ':newspaper: Complete website article preview for the review below. All approved images are embedded inside this HTML file.',
  });
  return files.map((file) => file.id);
}

export async function selfContainedArticlePreview(
  event: CreddyArticleReadySlackEvent,
): Promise<Uint8Array> {
  let html = await readFile(event.articlePreviewPath, 'utf8');
  for (const path of event.articleImagePaths) {
    const filename = basename(path);
    const extension = filename.toLowerCase().split('.').at(-1);
    const mimeType = extension === 'png'
      ? 'image/png'
      : extension === 'jpg' || extension === 'jpeg'
        ? 'image/jpeg'
        : undefined;
    if (!mimeType) throw new Error(`Unsupported Slack article image: ${filename}`);
    const marker = `src="assets/${filename}"`;
    if (!html.includes(marker)) throw new Error(`Article preview does not reference approved image: ${filename}`);
    const dataUrl = `data:${mimeType};base64,${(await readFile(path)).toString('base64')}`;
    html = html.replaceAll(marker, `src="${dataUrl}"`);
  }
  if (/src="assets\//.test(html)) {
    throw new Error('Article preview still contains unresolved local image references');
  }
  return Buffer.from(html, 'utf8');
}

function slackSourceLinks(urls: string[]): string {
  return urls.flatMap((value, index) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? [`<${url.toString()}|Source ${index + 1}>`] : [];
    } catch {
      return [];
    }
  }).join('  •  ');
}

export function articleReadyReviewBlocks(event: CreddyArticleReadySlackEvent): SlackBlock[] {
  const published = event.publishStatus === 'published' && event.publishedUrl;
  const failed = event.publishStatus === 'publish_failed';
  const actions: SlackBlock[] = [
    ...(published ? [{
      type: 'button', style: 'danger', action_id: 'creddy_website_delete', value: event.id,
      text: { type: 'plain_text', text: 'Undo publish', emoji: true },
      confirm: { title: { type: 'plain_text', text: 'Undo this website publication?' }, text: { type: 'mrkdwn', text: 'This removes the article and its CMS images from getcreddy.com. You can repost it later.' }, confirm: { type: 'plain_text', text: 'Undo publish' }, deny: { type: 'plain_text', text: 'Cancel' } },
    }] : []),
    ...(failed || event.publishStatus === 'unpublished' ? [{
      type: 'button', style: 'primary', action_id: 'creddy_website_repost', value: event.id,
      text: { type: 'plain_text', text: failed ? 'Retry publish' : 'Repost article', emoji: true },
    }] : []),
    { type: 'button', action_id: 'creddy_content_open', value: event.id, text: { type: 'plain_text', text: 'View full article', emoji: true } },
  ];
  return [
    { type: 'header', text: { type: 'plain_text', text: published ? ':white_check_mark: Website article published' : failed ? ':warning: Website article publish failed' : ':newspaper: Website article processing', emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${clean(event.title)}*\n${clean(event.dek)}` } },
    { type: 'section', fields: [
      { type: 'mrkdwn', text: `*Category*\n${clean(event.category.replaceAll('_', ' '))}` },
      { type: 'mrkdwn', text: `*Reading time*\n${event.readingMinutes} min` },
    ] },
    { type: 'section', text: { type: 'mrkdwn', text: `*Summary*\n${clean(event.excerpt)}` } },
    { type: 'section', text: { type: 'mrkdwn', text: `*Sources*\n${slackSourceLinks(event.sourceUrls) || 'No valid sources available.'}` } },
    { type: 'context', elements: [{ type: 'mrkdwn', text: published
      ? `:white_check_mark: Agent 8 published this automatically at <${event.publishedUrl}|getcreddy.com/blog>. Slideshow approval remains separate.`
      : failed
        ? `:warning: Automatic Agent 8 publishing failed. ${clean(event.publishError || 'Check protected CMS configuration, then use Retry publish.')}`
        : ':hourglass_flowing_sand: Agent 8 automatic website publishing is in progress. Slideshow approval remains separate.' }] },
    {
      type: 'actions',
      elements: actions,
    },
  ];
}

export async function notifyCreddyArticleReady(
  event: CreddyArticleReadySlackEvent,
): Promise<CreddyContentReadySlackResult> {
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  const channel = process.env.SLACK_SOCIAL_UPDATES_CHANNEL_ID?.trim();
  if (!token || !channel) return { sent: false, error: 'SLACK_BOT_TOKEN or SLACK_SOCIAL_UPDATES_CHANNEL_ID is missing' };
  if (!event.articleImagePaths.length) return { sent: false, error: 'At least one article image is required' };
  const published = event.publishStatus === 'published' && Boolean(event.publishedUrl);
  try {
    const fileIds = await uploadArticleFilesToSlack(token, channel, event);
    const message = await slackApi<{ ok?: boolean; error?: string; ts?: string }>('chat.postMessage', token, {
      channel,
      text: published ? `Creddy website article published: ${event.title}` : `Creddy website article publishing status: ${event.title}`,
      blocks: articleReadyReviewBlocks(event),
      unfurl_links: false,
      unfurl_media: false,
    });
    return { sent: true, channel, messageTs: message.ts, fileIds };
  } catch (error) {
    const lastError = (error as Error).message;
    console.error('[Creddy Slack] article review notification failed:', lastError);
    return { sent: false, channel, error: lastError };
  }
}

export async function notifyCreddyEmbeddedArticlePreview(
  event: CreddyArticleReadySlackEvent,
): Promise<CreddyContentReadySlackResult> {
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  const channel = process.env.SLACK_SOCIAL_UPDATES_CHANNEL_ID?.trim();
  if (!token || !channel) return { sent: false, error: 'SLACK_BOT_TOKEN or SLACK_SOCIAL_UPDATES_CHANNEL_ID is missing' };
  try {
    const bytes = await selfContainedArticlePreview(event);
    const filename = `${event.id}-complete-preview.html`;
    const ticket = await slackApi<{ ok?: boolean; error?: string; upload_url?: string; file_id?: string }>(
      'files.getUploadURLExternal', token, { filename, length: bytes.byteLength }, 'form',
    );
    if (!ticket.upload_url || !ticket.file_id) throw new Error('Slack did not return an embedded preview upload ticket');
    const upload = await fetch(ticket.upload_url, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: Buffer.from(bytes),
      signal: AbortSignal.timeout(30_000),
    });
    if (!upload.ok) throw new Error(`Embedded preview upload returned HTTP ${upload.status}`);
    await slackApi('files.completeUploadExternal', token, {
      files: [{ id: ticket.file_id, title: `Complete Creddy article with embedded images: ${event.title}` }],
      channel_id: channel,
      initial_comment: `:newspaper: Updated self-contained HTML for *${clean(event.title)}*. Its approved images are embedded and will display when this file is downloaded and opened.`,
    });
    return { sent: true, channel, fileIds: [ticket.file_id] };
  } catch (error) {
    return { sent: false, channel, error: (error as Error).message };
  }
}

export function contentReadyReviewBlocks(event: CreddyContentReadySlackEvent): SlackBlock[] {
  const hashtags = event.hashtags.map((tag) => tag.startsWith('#') ? tag : `#${tag}`).join(' ');
  const copy = `*Instagram caption*\n${clean(event.instagramCaption)}\n\n*TikTok caption*\n${clean(event.tiktokCaption)}\n\n*Hashtags*\n${clean(hashtags)}`;
  const manualFacts = event.verificationGate?.socialStatus === 'manual_confirmation_required';
  const conflict = event.verificationGate?.socialStatus === 'conflicting';
  const verificationContext = event.verificationGate
    ? conflict
      ? ':no_entry: Official evidence conflicts with a material claim. Correct the content before approval.'
      : manualFacts
        ? `:warning: Official verification was ${event.verificationGate.official.status}. Review the evidence, then use *Facts verified and approve*.`
        : ':white_check_mark: Official factual verification passed.'
    : undefined;
  return [
    { type: 'header', text: { type: 'plain_text', text: ':sparkles: Agent 7: post ready for review', emoji: true } },
    { type: 'section', text: { type: 'mrkdwn', text: `*${clean(event.hook)}*\nAll six rendered slides are attached in Slack. Review the exact copy below.` } },
    { type: 'section', text: { type: 'mrkdwn', text: copy.slice(0, 2900) } },
    ...(verificationContext ? [{ type: 'context', elements: [{ type: 'mrkdwn', text: verificationContext }] }] : []),
    {
      type: 'actions',
      elements: [
        ...(!conflict ? [{ type: 'button', style: 'primary', action_id: manualFacts ? 'creddy_content_facts_verify' : 'creddy_content_approve', value: event.id, text: { type: 'plain_text', text: manualFacts ? '✓ Facts verified and approve' : '✓ Approve in portal', emoji: true }, confirm: { title: { type: 'plain_text', text: manualFacts ? 'Confirm facts and approve?' : 'Approve this post?' }, text: { type: 'mrkdwn', text: manualFacts ? 'I reviewed the unresolved claims and source evidence. Record my identity and approval. This will not schedule or publish anything.' : 'This marks the post approved in Creddy. It will *not* publish or schedule anything.' }, confirm: { type: 'plain_text', text: manualFacts ? 'Facts verified' : 'Approve' }, deny: { type: 'plain_text', text: 'Cancel' } } }] : []),
        { type: 'button', style: 'danger', action_id: 'creddy_content_reject', value: event.id, text: { type: 'plain_text', text: 'Reject', emoji: true }, confirm: { title: { type: 'plain_text', text: 'Reject this post?' }, text: { type: 'mrkdwn', text: 'This moves the post to Rejected in Creddy. You can undo it later from the portal.' }, confirm: { type: 'plain_text', text: 'Reject' }, deny: { type: 'plain_text', text: 'Cancel' } } },
        { type: 'button', action_id: 'creddy_content_open', value: event.id, text: { type: 'plain_text', text: 'View full review in Slack', emoji: true } },
      ],
    },
  ];
}

export async function notifyCreddyContentReady(
  event: CreddyContentReadySlackEvent,
): Promise<CreddyContentReadySlackResult> {
  const token = process.env.SLACK_BOT_TOKEN?.trim();
  const channel = process.env.SLACK_SOCIAL_UPDATES_CHANNEL_ID?.trim();
  if (!token || !channel) return { sent: false, error: 'SLACK_BOT_TOKEN or SLACK_SOCIAL_UPDATES_CHANNEL_ID is missing' };
  if (event.slideImagePaths.length !== 6) return { sent: false, error: 'Exactly 6 slide images are required' };

  const blocks = contentReadyReviewBlocks(event);

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

  const blocks: Array<Record<string, unknown>> = [
    { type: 'header', text: { type: 'plain_text', text: ':white_check_mark: Creddy post published', emoji: true } },
    {
      type: 'section',
      text: {
        type: 'mrkdwn',
        text: `*${clean(event.hook)}*\n*Platform:* ${clean(event.platform)}\n*Account:* ${clean(event.account)}\n*Published at:* ${clean(new Date(event.publishedAt).toLocaleString('en-US', { timeZone: 'Asia/Kolkata', timeZoneName: 'short' }))}${event.publishedUrl ? `\n*Public post:* <${event.publishedUrl}|Open post>` : ''}`,
      },
    },
    {
      type: 'actions',
      elements: [{ type: 'button', action_id: 'creddy_content_open', value: event.id, text: { type: 'plain_text', text: 'View details in Slack', emoji: true } }],
    },
  ];
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
