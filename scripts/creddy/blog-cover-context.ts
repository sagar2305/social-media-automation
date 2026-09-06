import { resolveWebsiteCmsCredentials } from './instant-website-publish.js';

export type PublishedBlogCover = {
  slug: string; publishedAt: string; photoAssetId?: string; subject?: string; sourceUrl?: string;
};

/** Editorial hints only: no writes, publication authority, or shadow history. */
export async function publishedBlogCoverContext(
  env: NodeJS.ProcessEnv = process.env, fetcher: typeof fetch = fetch,
): Promise<{ status: 'available' | 'unavailable'; covers: PublishedBlogCover[] }> {
  try {
    const credentials = resolveWebsiteCmsCredentials(env);
    const url = new URL('/rest/v1/creddy_blog_articles', credentials.url);
    url.searchParams.set('select', 'slug,published_at,hero_id:content->article->>heroVisualId,assets:content->visuals->assets');
    url.searchParams.set('publish_state', 'eq.published');
    url.searchParams.set('order', 'published_at.desc,slug.asc');
    url.searchParams.set('limit', '20');
    const response = await fetcher(url, { headers: {
      apikey: credentials.serviceRoleKey, Authorization: `Bearer ${credentials.serviceRoleKey}`,
    }, signal: AbortSignal.timeout(5000) });
    if (!response.ok) throw new Error('History unavailable');
    const rows: unknown = await response.json();
    if (!Array.isArray(rows)) throw new Error('Invalid history');
    const covers = rows.slice(0, 20).map((row): PublishedBlogCover => {
      if (!row || typeof row.slug !== 'string' || !Number.isFinite(Date.parse(row.published_at))) {
        throw new Error('Invalid history row');
      }
      const hero = typeof row.hero_id === 'string' && row.hero_id && Array.isArray(row.assets)
        ? row.assets.find((asset: { id?: string } | null) => asset?.id === row.hero_id) : undefined;
      return { slug: row.slug, publishedAt: row.published_at,
        photoAssetId: typeof hero?.photoAssetId === 'string' ? hero.photoAssetId : undefined,
        subject: typeof hero?.altText === 'string' ? hero.altText : undefined,
        sourceUrl: typeof hero?.photoCredit?.sourceUrl === 'string' ? hero.photoCredit.sourceUrl : undefined };
    });
    return { status: 'available', covers };
  } catch {
    // Never expose credentials/response errors or mislabel unavailable as an empty archive.
    return { status: 'unavailable', covers: [] };
  }
}
