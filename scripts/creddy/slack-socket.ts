import { pathToFileURL } from 'node:url';

import dotenv from 'dotenv';
import { handleNewsSlack, isNewsSlackPayload, newsSlackAcknowledgement, type NewsSlackPayload } from '../../shared/creddy-news/creddy-news-slack.js';

import {
  approveCreddyContentFromSlack,
  loadCreddySlackFullReview,
  rejectCreddyContentFromSlack,
  undoCreddyContentDecisionFromSlack,
  verifyFactsAndApproveCreddyContentFromSlack,
} from './slack-content-store.js';
import type { CreddySlackFullReview } from './slack-content-store.js';
import { autoPublishWebsiteArticle, unpublishWebsiteArticle } from './article-approval-service.js';
import { publishApprovedWebsiteArticlesImmediately, unpublishWebsiteArticleImmediately } from './instant-website-publish.js';
import { resolveCreddyDataRoot } from './pipeline-store.js';

dotenv.config({ path: '.env.local', quiet: true });

type SlackBlock = Record<string, unknown> & { type?: string };
type SlackActionPayload = {
  type?: string;
  team?: { id?: string };
  view?: NewsSlackPayload['view'];
  user?: { id?: string; username?: string; name?: string };
  trigger_id?: string;
  channel?: { id?: string };
  container?: { channel_id?: string; message_ts?: string };
  message?: { ts?: string; text?: string; blocks?: SlackBlock[] };
  actions?: Array<{ action_id?: string; value?: string }>;
};
type SocketEnvelope = {
  envelope_id?: string;
  type?: string;
  payload?: SlackActionPayload;
};

function required(name: 'SLACK_APP_TOKEN' | 'SLACK_BOT_TOKEN'): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for Slack Socket Mode`);
  return value;
}

async function slackApi<T extends { ok?: boolean; error?: string }>(
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const response = await fetch(`https://slack.com/api/${method}`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${required('SLACK_BOT_TOKEN')}`,
      'content-type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`${method} returned HTTP ${response.status}`);
  const result = await response.json() as T;
  if (!result.ok) throw new Error(result.error || `${method} was rejected by Slack`);
  return result;
}

function clean(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function section(text: string): SlackBlock {
  return { type: 'section', text: { type: 'mrkdwn', text: text.slice(0, 2900) } };
}

function sourceLinks(urls: string[]): string {
  return urls.flatMap((value, index) => {
    try {
      const url = new URL(value);
      return ['http:', 'https:'].includes(url.protocol) ? [`<${url.toString()}|Source ${index + 1}>`] : [];
    } catch {
      return [];
    }
  }).join('  •  ');
}

export function fullReviewModal(payload: SlackActionPayload, details?: CreddySlackFullReview): Record<string, unknown> {
  if (details) {
    const history = details.reviewHistory.length
      ? details.reviewHistory.slice(-10).map((entry) =>
        `• ${clean(entry.actor)} — ${entry.action} — ${clean(new Date(entry.changedAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', timeZoneName: 'short' }))}`,
      ).join('\n')
      : 'No approval or rejection decisions yet.';
    const claims = details.factualClaims.slice(0, 12).map((claim) =>
      `• ${clean(String(claim.field ?? 'Claim'))}: ${clean(String(claim.value ?? ''))}${claim.confidence == null ? '' : ` (${claim.confidence}% confidence)`}`,
    ).join('\n');
    const blocks: SlackBlock[] = [
      section(`*Status:* ${clean(details.status.replaceAll('_', ' '))}\n*Revision:* ${details.revision}\n*Post ID:* \`${clean(details.id)}\``),
      section(`*Hook*\n${clean(details.hook)}`),
      section(`*Script*\n${details.scriptLines.map((line, index) => `${index + 1}. ${clean(line)}`).join('\n')}`),
      section(`*Instagram caption*\n${clean(details.instagramCaption)}`),
      section(`*TikTok caption*\n${clean(details.tiktokCaption)}`),
      section(`*Hashtags*\n${clean(details.hashtags.map((tag) => tag.startsWith('#') ? tag : `#${tag}`).join(' '))}`),
    ];
    if (details.brief) blocks.push(section(`*Creative brief*\n${clean(details.brief)}`));
    if (details.cta?.label || details.cta?.deepLink) {
      blocks.push(section(`*CTA*\n${clean(details.cta.label ?? '')}${details.cta.deepLink ? ` → \`${clean(details.cta.deepLink)}\`` : ''}`));
    }
    if (claims) blocks.push(section(`*Verified factual claims*\n${claims}`));
    if (details.verificationGate) {
      const gate = details.verificationGate;
      const unresolved = gate.official.claimOutcomes
        .filter((outcome) => outcome.status !== 'verified')
        .map((outcome) => `• ${clean(outcome.field)} — ${clean(outcome.status)}: ${clean(outcome.notes)}`)
        .join('\n');
      const attempted = sourceLinks(gate.official.attemptedUrls.slice(0, 12));
      const failures = gate.official.failureReasons.slice(0, 8)
        .map((reason) => `• ${clean(reason)}`)
        .join('\n');
      blocks.push(section(
        `*Official verification*\nStatus: *${clean(gate.official.status)}*\nSocial gate: *${clean(gate.socialStatus.replaceAll('_', ' '))}*` +
        `${gate.factsVerifiedBy ? `\nConfirmed by ${clean(gate.factsVerifiedBy)} at ${clean(gate.factsVerifiedAt ?? '')}` : ''}` +
        `${unresolved ? `\n\n*Unresolved claims*\n${unresolved}` : ''}` +
        `${attempted ? `\n\n*Official URLs attempted*\n${attempted}` : ''}` +
        `${failures ? `\n\n*Verification failures*\n${failures}` : ''}`,
      ));
    }
    if (details.article) {
      blocks.push(
        { type: 'divider' },
        section(`*Website article*\n*${clean(details.article.title)}*\n${clean(details.article.dek)}`),
        section(`*Article summary*\n${clean(details.article.excerpt)}\n\n*Category:* ${clean(details.article.category.replaceAll('_', ' '))}  •  *Reading time:* ${details.article.readingMinutes} min  •  *Structured blocks:* ${details.article.blocks.length}`),
        { type: 'context', elements: [{ type: 'mrkdwn', text: details.articlePreviewAttached
          ? ':newspaper: The complete HTML article preview and approved 16:9 images are attached with the website-review message in the channel.'
          : ':warning: The complete article preview is not attached.' }] },
      );
    }
    if (details.sourceUrls.length) blocks.push(section(`*Sources*\n${sourceLinks(details.sourceUrls) || 'No valid web sources available.'}`));
    blocks.push(
      section(`*Decision log*\n${history}`),
      { type: 'divider' },
      { type: 'context', elements: [{ type: 'mrkdwn', text: ':frame_with_picture: The six full-resolution slides are attached directly above the review message in the channel.' }] },
    );
    return {
      type: 'modal',
      callback_id: 'creddy_content_full_review',
      title: { type: 'plain_text', text: 'Creddy full review', emoji: true },
      close: { type: 'plain_text', text: 'Close', emoji: true },
      blocks,
    };
  }
  const source = payload.message?.blocks ?? [];
  const blocks = source
    .filter((block) => block.type !== 'actions')
    .slice(0, 90);
  blocks.push(
    { type: 'divider' },
    {
      type: 'context',
      elements: [{
        type: 'mrkdwn',
        text: ':frame_with_picture: The six full-resolution slides are attached directly above this review message in the channel.',
      }],
    },
  );
  return {
    type: 'modal',
    callback_id: 'creddy_content_full_review',
    title: { type: 'plain_text', text: 'Creddy full review', emoji: true },
    close: { type: 'plain_text', text: 'Close', emoji: true },
    blocks,
  };
}

export function resolvedMessageBlocks(payload: SlackActionPayload, text: string): SlackBlock[] {
  const open = (payload.message?.blocks ?? [])
    .filter((block) => block.type === 'actions')
    .flatMap((block) => Array.isArray(block.elements) ? block.elements as SlackBlock[] : [])
    .find((element) => element.action_id === 'creddy_content_open');
  const id = typeof open?.value === 'string' ? open.value : undefined;
  return [
    ...(payload.message?.blocks ?? []).filter((block) => block.type !== 'actions' && block.block_id !== 'creddy_resolution_status'),
    { type: 'section', block_id: 'creddy_resolution_status', text: { type: 'mrkdwn', text } },
    ...(open && id ? [{
      type: 'actions',
      elements: [
        open,
        { type: 'button', action_id: 'creddy_content_undo', value: id, text: { type: 'plain_text', text: 'Undo decision', emoji: true }, confirm: { title: { type: 'plain_text', text: 'Undo this decision?' }, text: { type: 'mrkdwn', text: 'This returns the post to Pending Review. It will not schedule or publish anything.' }, confirm: { type: 'plain_text', text: 'Undo' }, deny: { type: 'plain_text', text: 'Cancel' } } },
      ],
    }] : []),
  ];
}

function pendingMessageBlocks(payload: SlackActionPayload, id: string, text: string): SlackBlock[] {
  return [
    ...(payload.message?.blocks ?? []).filter((block) => block.type !== 'actions' && block.block_id !== 'creddy_resolution_status'),
    { type: 'section', block_id: 'creddy_resolution_status', text: { type: 'mrkdwn', text } },
    {
      type: 'actions',
      elements: [
        { type: 'button', style: 'primary', action_id: 'creddy_content_approve', value: id, text: { type: 'plain_text', text: '✓ Approve in portal', emoji: true } },
        { type: 'button', style: 'danger', action_id: 'creddy_content_reject', value: id, text: { type: 'plain_text', text: 'Reject', emoji: true } },
        { type: 'button', action_id: 'creddy_content_open', value: id, text: { type: 'plain_text', text: 'View full review in Slack', emoji: true } },
      ],
    },
  ];
}

async function postError(payload: SlackActionPayload, message: string): Promise<void> {
  const channel = payload.channel?.id || payload.container?.channel_id;
  const user = payload.user?.id;
  if (!channel || !user) {
    console.error(`[Creddy Slack Socket] ${message}`);
    return;
  }
  await slackApi('chat.postEphemeral', {
    channel,
    user,
    text: `:warning: Creddy could not apply this action: ${message}`,
  });
}

async function updateResolvedMessage(payload: SlackActionPayload, text: string): Promise<void> {
  const channel = payload.channel?.id || payload.container?.channel_id;
  const ts = payload.message?.ts || payload.container?.message_ts;
  if (!channel || !ts) throw new Error('Slack message location is missing');
  await slackApi('chat.update', {
    channel,
    ts,
    text,
    blocks: resolvedMessageBlocks(payload, text),
  });
}

async function updateArticleMessage(
  payload: SlackActionPayload,
  text: string,
  action: 'delete' | 'repost' | 'retry',
): Promise<void> {
  const channel = payload.channel?.id || payload.container?.channel_id;
  const ts = payload.message?.ts || payload.container?.message_ts;
  const id = payload.actions?.[0]?.value;
  if (!channel || !ts || !id) throw new Error('Slack article message location is missing');
  const open = { type: 'button', action_id: 'creddy_content_open', value: id, text: { type: 'plain_text', text: 'View full article', emoji: true } };
  const management = action === 'delete'
    ? { type: 'button', style: 'danger', action_id: 'creddy_website_delete', value: id, text: { type: 'plain_text', text: 'Undo publish', emoji: true } }
    : { type: 'button', style: 'primary', action_id: 'creddy_website_repost', value: id, text: { type: 'plain_text', text: action === 'retry' ? 'Retry publish' : 'Repost article', emoji: true } };
  await slackApi('chat.update', {
    channel,
    ts,
    text,
    blocks: [
      ...(payload.message?.blocks ?? []).filter((block) => block.type !== 'actions' && block.block_id !== 'creddy_resolution_status'),
      { type: 'section', block_id: 'creddy_resolution_status', text: { type: 'mrkdwn', text } },
      { type: 'actions', elements: [management, open] },
    ],
  });
}

export async function handleSlackAction(payload: SlackActionPayload): Promise<void> {
  const action = payload.actions?.[0];
  const actor = payload.user?.username || payload.user?.name || payload.user?.id;
  if (!action?.action_id || !action.value || !payload.user?.id || !actor) {
    throw new Error('Unsupported Slack action');
  }
  if (action.action_id === 'creddy_content_open') {
    if (!payload.trigger_id) throw new Error('Slack modal trigger is missing');
    const details = await loadCreddySlackFullReview(action.value);
    await slackApi('views.open', { trigger_id: payload.trigger_id, view: fullReviewModal(payload, details) });
    console.log(`[Creddy Slack Socket] Opened full review for ${action.value}.`);
    return;
  }
  if (action.action_id === 'creddy_content_approve') {
    await approveCreddyContentFromSlack({ id: action.value, approvedBy: `Slack: ${actor}` });
    const text = `:white_check_mark: Creddy post approved in the portal by ${actor}. Nothing was scheduled or published.`;
    await updateResolvedMessage(payload, text);
    console.log(`[Creddy Slack Socket] ${action.value} approved by ${actor}.`);
    return;
  }
  if (action.action_id === 'creddy_content_facts_verify') {
    await verifyFactsAndApproveCreddyContentFromSlack({ id: action.value, approvedBy: `Slack: ${actor}` });
    const text = `:white_check_mark: Facts verified and Creddy post approved by ${actor}. The audit record was saved. Nothing was scheduled or published.`;
    await updateResolvedMessage(payload, text);
    console.log(`[Creddy Slack Socket] ${action.value} facts verified and approved by ${actor}.`);
    return;
  }
  if (action.action_id === 'creddy_website_approve' || action.action_id === 'creddy_website_repost') {
    const published = await autoPublishWebsiteArticle({
      root: resolveCreddyDataRoot(),
      id: action.value,
      websiteBaseUrl: process.env.CREDDY_WEBSITE_BASE_URL,
      publish: () => publishApprovedWebsiteArticlesImmediately(),
    });
    const text = `:white_check_mark: Website article approved by ${actor} and published at <${published.liveUrl}|Open live article>. The slideshow remains unchanged.`;
    await updateArticleMessage(payload, text, 'delete');
    console.log(`[Creddy Slack Socket] ${action.value} website article reposted and CMS sync completed for ${actor}.`);
    return;
  }
  if (action.action_id === 'creddy_website_delete') {
    const deleted = await unpublishWebsiteArticle({
      root: resolveCreddyDataRoot(),
      id: action.value,
      unpublishedBy: `Slack: ${actor}`,
      unpublish: (slug) => unpublishWebsiteArticleImmediately({ slug }),
    });
    const text = `:leftwards_arrow_with_hook: Website publication undone by ${actor}. ${deleted.removedAssets} CMS image assets were removed. The slideshow remains unchanged.`;
    await updateArticleMessage(payload, text, 'repost');
    console.log(`[Creddy Slack Socket] ${action.value} website article deleted by ${actor}.`);
    return;
  }
  if (action.action_id === 'creddy_content_reject') {
    await rejectCreddyContentFromSlack({
      id: action.value,
      rejectedBy: `Slack: ${actor}`,
      reason: `Rejected from the Slack Agent 7 review by ${actor}`,
    });
    const text = `:x: Creddy post rejected by ${actor}. It is stored in the portal's Rejected section and can be restored there.`;
    await updateResolvedMessage(payload, text);
    console.log(`[Creddy Slack Socket] ${action.value} rejected by ${actor}.`);
    return;
  }
  if (action.action_id === 'creddy_content_undo') {
    await undoCreddyContentDecisionFromSlack({ id: action.value, undoneBy: `Slack: ${actor}` });
    const channel = payload.channel?.id || payload.container?.channel_id;
    const ts = payload.message?.ts || payload.container?.message_ts;
    if (!channel || !ts) throw new Error('Slack message location is missing');
    await slackApi('chat.update', {
      channel,
      ts,
      text: `Creddy post returned to review by ${actor}`,
      blocks: pendingMessageBlocks(payload, action.value, `:leftwards_arrow_with_hook: Decision undone by ${actor}. The post is back in the portal's Review Queue.`),
    });
    console.log(`[Creddy Slack Socket] ${action.value} decision undone by ${actor}.`);
    return;
  }
  throw new Error('Unsupported Slack action');
}

async function openSocketUrl(): Promise<string> {
  const response = await fetch('https://slack.com/api/apps.connections.open', {
    method: 'POST',
    headers: { authorization: `Bearer ${required('SLACK_APP_TOKEN')}` },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`apps.connections.open returned HTTP ${response.status}`);
  const result = await response.json() as { ok?: boolean; error?: string; url?: string };
  if (!result.ok || !result.url) throw new Error(result.error || 'Slack did not return a Socket Mode URL');
  return result.url;
}

async function runConnection(): Promise<void> {
  const url = await openSocketUrl();
  await new Promise<void>((resolveConnection, rejectConnection) => {
    const socket = new WebSocket(url);
    let opened = false;
    socket.addEventListener('open', () => {
      opened = true;
      console.log('[Creddy Slack Socket] Connected; full review, approval, and rejection actions are active.');
    });
    socket.addEventListener('message', (event) => {
      void (async () => {
        let envelope: SocketEnvelope;
        try {
          envelope = JSON.parse(String(event.data)) as SocketEnvelope;
        } catch {
          console.error('[Creddy Slack Socket] Ignored a non-JSON message from Slack.');
          return;
        }
        if (envelope.type === 'disconnect') {
          socket.close(1000, 'Slack requested reconnect');
          return;
        }
        if (!envelope.envelope_id || envelope.type !== 'interactive' || !envelope.payload) return;
        if (isNewsSlackPayload(envelope.payload)) {
          try {
            const ack = newsSlackAcknowledgement(envelope.payload);
            socket.send(JSON.stringify({ envelope_id: envelope.envelope_id, payload: ack }));
            await handleNewsSlack(envelope.payload);
          } catch (error) {
            const message = (error as Error).message;
            if (envelope.payload.view) socket.send(JSON.stringify({ envelope_id: envelope.envelope_id,
              payload: { response_action: 'errors', errors: { headline: message } } }));
            else { socket.send(JSON.stringify({ envelope_id: envelope.envelope_id })); await postError(envelope.payload, message); }
          }
          return;
        }
        socket.send(JSON.stringify({ envelope_id: envelope.envelope_id }));
        try {
          await handleSlackAction(envelope.payload);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Slack action failed';
          console.error(`[Creddy Slack Socket] Action failed: ${message}`);
          try {
            await postError(envelope.payload, message);
          } catch (postFailure) {
            console.error(`[Creddy Slack Socket] Could not send error confirmation: ${(postFailure as Error).message}`);
          }
        }
      })();
    });
    socket.addEventListener('error', () => {
      if (!opened) rejectConnection(new Error('Slack Socket Mode connection failed'));
    });
    socket.addEventListener('close', () => resolveConnection());
  });
}

export async function runSlackSocketWorker(): Promise<never> {
  required('SLACK_APP_TOKEN');
  required('SLACK_BOT_TOKEN');
  let delay = 1_000;
  while (true) {
    try {
      await runConnection();
      delay = 1_000;
    } catch (error) {
      console.error(`[Creddy Slack Socket] Connection failed: ${(error as Error).message}`);
      delay = Math.min(delay * 2, 30_000);
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, delay));
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runSlackSocketWorker().catch((error) => {
    console.error(`[Creddy Slack Socket] Fatal error: ${(error as Error).message}`);
    process.exitCode = 1;
  });
}
