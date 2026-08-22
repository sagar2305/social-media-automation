import type { CreddySourceConfig } from './config.js';

export interface RedditRssEntry {
  url: string;
  title: string;
  markdown: string;
  publishedAt?: string;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function xmlField(entry: string, name: string): string | undefined {
  const match = entry.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decodeEntities(match[1].trim()) : undefined;
}

function cleanHtml(value: string): string {
  return decodeEntities(value)
    .replace(/<\/?(?:p|div|blockquote|li|h[1-6]|tr)[^>]*>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<a\s[^>]*href=["']([^"']+)["'][^>]*>(.*?)<\/a>/gis, '$2 ($1)')
    .replace(/<[^>]+>/g, ' ')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function parseRedditAtom(xml: string, limit = 10): RedditRssEntry[] {
  const entries = xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) ?? [];
  const parsed: RedditRssEntry[] = [];
  for (const entry of entries) {
    if (parsed.length >= limit) break;
    const link = entry.match(/<link\s[^>]*href=["']([^"']+)["'][^>]*\/?\s*>/i)?.[1];
    const title = xmlField(entry, 'title')?.replace(/<[^>]+>/g, '').trim();
    const content = xmlField(entry, 'content');
    if (!link || !title || !content) continue;
    const url = decodeEntities(link);
    if (!/\/r\/[^/]+\/comments\//i.test(new URL(url).pathname)) continue;
    parsed.push({
      url,
      title,
      markdown: `# ${title}\n\n${cleanHtml(content)}`,
      publishedAt: xmlField(entry, 'updated'),
    });
  }
  return parsed;
}

export async function fetchRedditRss(
  source: CreddySourceConfig,
  limit: number,
  fetchImpl: typeof fetch = fetch,
): Promise<RedditRssEntry[]> {
  if (!source.id.startsWith('reddit-')) {
    throw new Error('Reddit RSS fallback may only be used for configured Reddit sources');
  }
  const primary = new URL('new/.rss', source.url);
  const community = new URL('.rss', source.url);
  const fallback = new URL(primary);
  fallback.hostname = 'old.reddit.com';
  const errors: string[] = [];
  // r/churning's `new` feed is frequently throttled while its community feed
  // remains available. Use one preferred endpoint first to avoid a retry burst.
  const endpoints = source.id === 'reddit-churning'
    ? [community, fallback]
    : [primary, community, fallback];
  for (const rssUrl of endpoints) {
    try {
      const response = await fetchImpl(rssUrl, {
        headers: {
          Accept: 'application/atom+xml, application/xml;q=0.9',
          'User-Agent': 'CreddyNewsCollector/1.0',
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (!response.ok) {
        errors.push(`${rssUrl.hostname} HTTP ${response.status}`);
        continue;
      }
      const entries = parseRedditAtom(await response.text(), limit);
      if (entries.length > 0) return entries;
      errors.push(`${rssUrl.hostname} returned no post entries`);
    } catch (error) {
      errors.push(`${rssUrl.hostname}: ${(error as Error).message}`);
    }
  }
  throw new Error(`Reddit RSS failed (${errors.join('; ')})`);
}
