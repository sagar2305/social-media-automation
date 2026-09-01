// Server-side only: imported by API routes and pipeline, never client components.
import type { NewsContent, NewsItem, NewsPatch } from './creddy-news-types';
import { validateNewsContent, validateNewsPatch } from './creddy-news-types';

export class NewsService {
  constructor(private readonly url: string, private readonly key: string, private readonly fetcher = fetch) {}
  private async request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const response = await this.fetcher(`${this.url}/rest/v1/${path}`, {
      method, headers: { apikey: this.key, authorization: `Bearer ${this.key}`, 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      cache: 'no-store', signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) {
      if (response.status === 400) throw new Error('News changed or failed validation. Reload and try again.');
      throw new Error(`News service unavailable (HTTP ${response.status}). Check the migration and server configuration.`);
    }
    if (response.status === 204) return undefined as T;
    return await response.json() as T;
  }
  async list(offset = 0): Promise<NewsItem[]> {
    return this.request(`creddy_news_items?select=*&order=updated_at.desc,id.asc&limit=100&offset=${offset}`);
  }
  async get(id: string): Promise<NewsItem> {
    const rows = await this.request<NewsItem[]>(`creddy_news_items?id=eq.${encodeURIComponent(id)}&select=*`);
    if (!rows[0]) throw new Error('News item not found.');
    return rows[0];
  }
  async ingest(input: { id: string; sourceKey: string; content: NewsContent; provenance: Record<string, unknown>; error: string | null }): Promise<NewsItem> {
    if (!input.error) validateNewsContent(input.content);
    return this.request('rpc/creddy_news_ingest', 'POST', { p_id: input.id, p_source_key: input.sourceKey,
      p_content: input.content, p_provenance: input.provenance, p_error: input.error });
  }
  async manage(id: string, revision: number, action: 'edit' | 'delete', patch: NewsPatch | null, actor: string): Promise<NewsItem> {
    if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id) || !Number.isSafeInteger(revision) || revision < 1) throw new Error('Invalid news identity.');
    if (action === 'edit') { if (!patch) throw new Error('News text is required.'); validateNewsPatch(patch); }
    return this.request('rpc/creddy_news_manage', 'POST', { p_id: id, p_revision: revision, p_action: action, p_patch: patch, p_actor: actor });
  }
  async claimNotification(id: string): Promise<NewsItem | undefined> {
    return (await this.request<NewsItem[]>('rpc/creddy_news_claim_notification', 'POST', { p_id: id }))[0];
  }
  async notificationResult(item: NewsItem, result: { channel?: string; ts?: string; error?: string }): Promise<void> {
    await this.request(`creddy_news_items?id=eq.${encodeURIComponent(item.id)}`, 'PATCH', {
      slack_lease_until: null,
      ...(result.error ? { slack_error: result.error } : {
        slack_channel: result.channel, slack_ts: result.ts, slack_revision: item.revision, slack_error: null,
      }),
    });
  }
}

export function configuredNewsService(env = process.env): NewsService {
  const url = env.CREDDY_SUPABASE_URL?.trim();
  const key = env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !key || !/^https:\/\/[a-z0-9]+\.supabase\.co$/.test(url)) throw new Error('Configure the Creddy news database URL and server credential.');
  if (key.split('.').length === 3) {
    let claims: { role?: string; ref?: string };
    try { claims = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()); }
    catch { throw new Error('Invalid news server credential.'); }
    if (claims.role !== 'service_role' || (claims.ref && !url.includes(`://${claims.ref}.`))) throw new Error('News server credential does not match the Creddy database.');
  }
  return new NewsService(url, key);
}
export function requireNewsWrites(env = process.env): void {
  if (env.CREDDY_NEWS_ENABLED !== 'true') throw new Error('App News publishing and management are disabled.');
}
