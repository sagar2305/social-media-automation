import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { configuredNewsService, requireNewsWrites, type NewsService } from './creddy-news-service';
import { NEWS_CATEGORIES, publicHttps, validateNewsPatch, type NewsItem, type NewsPatch } from './creddy-news-types';

type SlackView = { id?: string; callback_id?: string; private_metadata?: string;
  state?: { values?: Record<string, Record<string, { value?: string; selected_option?: { value?: string } }>> } };
export type NewsSlackPayload = { type?: string; team?: { id?: string }; user?: { id?: string };
  trigger_id?: string; channel?: { id?: string }; container?: { channel_id?: string; message_ts?: string };
  actions?: Array<{ action_id?: string; value?: string }>; view?: SlackView };
type Meta = { id: string; revision: number; channel: string };
type SlackCall = (method: string, body: Record<string, unknown>) => Promise<Record<string, unknown>>;

function api(env: NodeJS.ProcessEnv): SlackCall {
  return async (method, body) => {
    if (!env.SLACK_BOT_TOKEN) throw new Error('Slack bot is not configured.');
    const response = await fetch(`https://slack.com/api/${method}`, {
      method: 'POST', headers: { authorization: `Bearer ${env.SLACK_BOT_TOKEN}`, 'content-type': 'application/json' },
      body: JSON.stringify(body), signal: AbortSignal.timeout(10_000),
    });
    const result = await response.json() as Record<string, unknown>;
    if (!response.ok || !result.ok) throw new Error(`Slack ${method} failed. Check bot access and channel configuration.`);
    return result;
  };
}
function secret(env: NodeJS.ProcessEnv): string {
  if (!env.SLACK_SIGNING_SECRET) throw new Error('Slack signing secret is required for news actions.');
  return env.SLACK_SIGNING_SECRET;
}
function seal(meta: Meta, env: NodeJS.ProcessEnv): string {
  const data = Buffer.from(JSON.stringify(meta)).toString('base64url');
  return `${data}.${createHmac('sha256', secret(env)).update(data).digest('hex')}`;
}
function unseal(value: string, env: NodeJS.ProcessEnv): Meta {
  const [data, signature] = value.split('.');
  const expected = createHmac('sha256', secret(env)).update(data ?? '').digest('hex');
  if (!signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error('Invalid news action.');
  const meta = JSON.parse(Buffer.from(data, 'base64url').toString()) as Meta;
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(meta.id) || !Number.isSafeInteger(meta.revision)) throw new Error('Invalid news action.');
  return meta;
}
export function isNewsSlackPayload(payload: NewsSlackPayload): boolean {
  return payload.view?.callback_id === 'creddy_news_save' || !!payload.actions?.[0]?.action_id?.startsWith('creddy_news_');
}
export function authorizeNewsSlack(payload: NewsSlackPayload, env = process.env): Meta {
  requireNewsWrites(env);
  const editors = new Set((env.CREDDY_NEWS_SLACK_EDITOR_IDS ?? '').split(',').map(id => id.trim()).filter(Boolean));
  if (!env.CREDDY_NEWS_SLACK_TEAM_ID || payload.team?.id !== env.CREDDY_NEWS_SLACK_TEAM_ID
    || !payload.user?.id || !editors.has(payload.user.id)) throw new Error('You are not an authorized Creddy News editor.');
  const value = payload.view?.private_metadata ?? payload.actions?.[0]?.value ?? '';
  const meta = unseal(value, env);
  const channel = payload.channel?.id ?? payload.container?.channel_id ?? meta.channel;
  if (!env.CREDDY_NEWS_SLACK_CHANNEL_ID || channel !== env.CREDDY_NEWS_SLACK_CHANNEL_ID || meta.channel !== channel) throw new Error('News actions are restricted to the configured channel.');
  return meta;
}
function text(value: string) { return { type: 'plain_text', text: value }; }
export function newsMessage(item: NewsItem, channel: string, env = process.env): Record<string, unknown> {
  const hasEditors = (env.CREDDY_NEWS_SLACK_EDITOR_IDS ?? '').split(',').some(id => id.trim());
  const label = item.status === 'published' ? 'Published in app' : item.status === 'deleted' ? 'Deleted from app' : 'Not published';
  const blocks: Record<string, unknown>[] = [
    { type: 'header', text: text('Creddy app News') },
    { type: 'section', text: text(`${label} · Revision ${item.revision}\n${item.content.headline}`.slice(0, 2900)) },
    { type: 'section', text: text(item.content.summary.slice(0, 2900) || 'No summary available.') },
    { type: 'context', elements: [text(`${item.content.publisher} · ${item.content.category}`)] },
  ];
  if (publicHttps(item.content.source_url)) blocks.push({ type: 'section', text: { type: 'mrkdwn',
    text: `<${item.content.source_url.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('|', '%7C')}|Original source>` } });
  if (item.validation_error) blocks.push({ type: 'section', text: text(item.validation_error.slice(0, 2900)) });
  if (item.status === 'published' && hasEditors) {
    const value = seal({ id: item.id, revision: item.revision, channel }, env);
    blocks.push({ type: 'actions', elements: [
    { type: 'button', action_id: 'creddy_news_edit', value, text: text('Edit news') },
    { type: 'button', action_id: 'creddy_news_delete', value, style: 'danger', text: text('Delete from app'), confirm: {
      title: text('Delete this news?'), text: text('Remove it from the app and prevent automatic re-import. Website articles and slideshows stay unchanged.'),
      confirm: text('Delete'), deny: text('Cancel'),
    } },
    ] });
  }
  return { text: `${label}: ${item.content.headline}`, blocks, unfurl_links: false, unfurl_media: false };
}
export async function notifyNews(service: NewsService, id: string, env = process.env, call = api(env)): Promise<void> {
  const item = await service.claimNotification(id);
  if (!item) return;
  try {
    const channel = env.CREDDY_NEWS_SLACK_CHANNEL_ID;
    if (!channel || !env.CREDDY_NEWS_SLACK_TEAM_ID) throw new Error('Configure the News Slack channel and workspace.');
    if (item.slack_channel && item.slack_channel !== channel) throw new Error('News channel changed. Reconcile existing notification receipts before switching channels.');
    const body = { channel, ...newsMessage(item, channel, env) };
    const hash = createHash('sha256').update(`creddy-news:${id}`).digest('hex');
    const clientId = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-4${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
    const response = item.slack_ts
      ? await call('chat.update', { ...body, ts: item.slack_ts })
      : await call('chat.postMessage', { ...body, client_msg_id: clientId });
    const ts = typeof response.ts === 'string' ? response.ts : item.slack_ts;
    if (!ts) throw new Error('Slack returned no message receipt.');
    await service.notificationResult(item, { channel, ts });
  } catch (error) {
    await service.notificationResult(item, { error: (error as Error).message });
    throw error;
  }
}

export async function notifyWithheldNewsDigest(
  items: Array<{ headline: string; reason: string }>,
  digestKey: string,
  dashboardUrl: string | undefined,
  env = process.env,
  call = api(env),
): Promise<{ sent: boolean; ts?: string }> {
  if (items.length === 0) return { sent: false };
  const channel = env.CREDDY_NEWS_SLACK_CHANNEL_ID;
  if (!channel || !env.CREDDY_NEWS_SLACK_TEAM_ID) throw new Error('Configure the News Slack channel and workspace.');
  const lines = items.slice(0, 5).map((item, index) =>
    `${index + 1}. *${item.headline.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}*\n${item.reason.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}`,
  );
  if (items.length > 5) lines.push(`_${items.length - 5} additional withheld candidate(s) remain in the dashboard._`);
  if (dashboardUrl) lines.push(`<${dashboardUrl.replace(/\/$/, '')}/creddy/news|Open Creddy News manager>`);
  const digestHash = createHash('sha256').update(`creddy-news-withheld:${digestKey}`).digest('hex');
  const clientId = `${digestHash.slice(0, 8)}-${digestHash.slice(8, 12)}-4${digestHash.slice(13, 16)}-8${digestHash.slice(17, 20)}-${digestHash.slice(20, 32)}`;
  const response = await call('chat.postMessage', {
    channel,
    client_msg_id: clientId,
    text: `${items.length} Creddy News candidate(s) withheld`,
    blocks: [
      { type: 'header', text: text('Creddy News · Withheld this hour') },
      { type: 'section', text: { type: 'mrkdwn', text: lines.join('\n\n').slice(0, 2900) } },
    ],
    unfurl_links: false,
    unfurl_media: false,
  });
  return { sent: true, ts: typeof response.ts === 'string' ? response.ts : undefined };
}
function patchFrom(payload: NewsSlackPayload): NewsPatch {
  const values = payload.view?.state?.values ?? {};
  return { headline: values.headline?.value?.value ?? '', summary: values.summary?.value?.value ?? '',
    category: values.category?.value?.selected_option?.value as NewsPatch['category'] };
}
function statusView(message: string): Record<string, unknown> {
  return { type: 'modal', title: text('Creddy News'), close: text('Close'), blocks: [{ type: 'section', text: text(message) }] };
}
/** Return synchronously so Socket Mode and HTTP can acknowledge before network writes. */
export function newsSlackAcknowledgement(payload: NewsSlackPayload, env = process.env): Record<string, unknown> {
  authorizeNewsSlack(payload, env);
  if (payload.view?.callback_id !== 'creddy_news_save') return {};
  validateNewsPatch(patchFrom(payload));
  return { response_action: 'update', view: statusView('Saving changes to app News...') };
}
export async function handleNewsSlack(payload: NewsSlackPayload, env = process.env,
  service = configuredNewsService(env), call = api(env)): Promise<void> {
  const meta = authorizeNewsSlack(payload, env);
  let openedViewId: string | undefined;
  try {
    if (payload.actions?.[0]?.action_id === 'creddy_news_edit') {
      if (!payload.trigger_id) throw new Error('Edit session expired. Click Edit news again.');
      // Open a modal before fetching the item, within Slack's short trigger lifetime.
      const opened = await call('views.open', { trigger_id: payload.trigger_id, view: statusView('Loading news...') });
      const viewId = (opened.view as { id?: string } | undefined)?.id;
      openedViewId = viewId;
      if (!viewId) throw new Error('Slack returned no edit session.');
      const item = await service.get(meta.id);
      if (item.status !== 'published') { await call('views.update', { view_id: viewId, view: statusView('This story is no longer published.') }); return; }
      const option = (category: string) => ({ text: text(category), value: category });
      await call('views.update', { view_id: viewId, view: {
        type: 'modal', callback_id: 'creddy_news_save', private_metadata: seal({ ...meta, revision: item.revision }, env),
        title: text('Edit app News'), submit: text('Save to app'), close: text('Cancel'), blocks: [
          { type: 'context', elements: [text('Edits go live immediately. Keep claims consistent with the source.')] },
          ...(['headline', 'summary'] as const).map(key => ({ type: 'input', block_id: key, label: text(key === 'headline' ? 'Headline' : 'Summary'),
            element: { type: 'plain_text_input', action_id: 'value', initial_value: item.content[key], multiline: key === 'summary', min_length: key === 'headline' ? 10 : 80, max_length: key === 'headline' ? 160 : 480 } })),
          { type: 'input', block_id: 'category', label: text('Category'), element: { type: 'static_select', action_id: 'value',
            initial_option: option(item.content.category), options: NEWS_CATEGORIES.map(option) } },
        ],
      } });
      return;
    }
    const isSave = payload.view?.callback_id === 'creddy_news_save';
    if (!isSave && payload.actions?.[0]?.action_id !== 'creddy_news_delete') throw new Error('Unsupported news action.');
    await service.manage(meta.id, meta.revision, isSave ? 'edit' : 'delete', isSave ? patchFrom(payload) : null, `slack:${payload.user!.id}`);
    let message = isSave ? 'Saved to app News.' : 'Deleted from app News.';
    try { await notifyNews(service, meta.id, env, call); }
    catch { message += ' The channel notification is pending retry.'; }
    if (payload.view?.id) await call('views.update', { view_id: payload.view.id, view: statusView(message) });
  } catch (error) {
    const message = (error as Error).message;
    const viewId = payload.view?.id ?? openedViewId;
    if (viewId) await call('views.update', { view_id: viewId, view: statusView(`${message} Close this window and reopen Edit news to retry.`) });
    else await call('chat.postEphemeral', { channel: meta.channel, user: payload.user!.id, text: message });
  }
}
