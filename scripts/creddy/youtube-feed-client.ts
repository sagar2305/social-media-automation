import type { CreddySourceConfig } from './config.js';

export interface YouTubeFeedEntry {
  url: string;
  title: string;
  markdown: string;
  publishedAt?: string;
  providerMetadata: Record<string, unknown>;
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
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = entry.match(new RegExp(`<${escaped}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${escaped}>`, 'i'));
  return match ? decodeEntities(match[1].trim()) : undefined;
}

export function parseYouTubeAtom(xml: string, limit = 10): YouTubeFeedEntry[] {
  const entries = xml.match(/<entry(?:\s[^>]*)?>[\s\S]*?<\/entry>/gi) ?? [];
  const parsed: YouTubeFeedEntry[] = [];
  for (const entry of entries) {
    if (parsed.length >= limit) break;
    const url = entry.match(/<link\s[^>]*rel=["']alternate["'][^>]*href=["']([^"']+)["']/i)?.[1];
    const title = xmlField(entry, 'title')?.replace(/<[^>]+>/g, '').trim();
    if (!url || !title) continue;
    const description = xmlField(entry, 'media:description')?.trim() ?? '';
    const views = Number(entry.match(/<media:statistics\s[^>]*views=["'](\d+)["']/i)?.[1]);
    const likes = Number(entry.match(/<media:starRating\s[^>]*count=["'](\d+)["']/i)?.[1]);
    parsed.push({
      url: decodeEntities(url),
      title,
      markdown: `# ${title}\n\n${description}`.trim(),
      publishedAt: xmlField(entry, 'published'),
      providerMetadata: {
        collectionProvider: 'youtube_rss',
        ...(Number.isFinite(views) ? { views } : {}),
        ...(Number.isFinite(likes) ? { likes } : {}),
      },
    });
  }
  return parsed;
}

export async function fetchYouTubeFeed(
  source: CreddySourceConfig,
  limit: number,
  fetchImpl: typeof fetch = fetch,
): Promise<YouTubeFeedEntry[]> {
  if (source.sourceClass !== 'creator_signal') {
    throw new Error('YouTube feed collection may only be used for configured creator signals');
  }
  const response = await fetchImpl(source.url, {
    headers: {
      Accept: 'application/atom+xml, application/xml;q=0.9',
      'User-Agent': 'CreddyNewsCollector/1.0',
    },
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`YouTube feed failed with HTTP ${response.status}`);
  const entries = parseYouTubeAtom(await response.text(), limit);
  if (entries.length === 0) throw new Error('YouTube feed returned no video entries');
  return entries;
}
