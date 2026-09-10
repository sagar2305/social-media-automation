import { createClient } from '@supabase/supabase-js';
import type { NewsImageReplacement } from '../../shared/creddy-news/creddy-news-service.js';
import { publicHttps } from '../../shared/creddy-news/creddy-news-types.js';
import { validatePhotoCredit } from '../creddy/editorial-photos.js';
import { resolveWebsiteCmsCredentials } from '../creddy/instant-website-publish.js';
import type { CreddyBlogCmsRow } from '../creddy/website-cms-stage.js';

export type NewsPhotoIdentity = { canonicalId?: string; sourceUrl?: string };

function sourceIdentity(value: string): string {
  const url = new URL(value); url.hash = '';
  for (const key of [...url.searchParams.keys()]) if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
  url.searchParams.sort(); url.pathname = url.pathname.replace(/\/$/, '') || '/';
  return url.toString();
}

/** Native News has no credit/caption field yet. CC BY/SA requires a public
 * attribution surface and is deliberately excluded. Pexels/CC0 allow reuse
 * without required attribution; the credited blog and full provenance remain.
 */
export function newsPhotoFromBlog(blog: CreddyBlogCmsRow, projectUrl: string): NewsImageReplacement | undefined {
  if (blog.publish_state !== 'published') return;
  const heroes = blog.content.visuals.assets.filter(asset => asset.usage === 'hero');
  const hero = heroes[0];
  if (heroes.length !== 1 || !hero || hero.id !== blog.content.article.heroVisualId
      || hero.assetType !== 'licensed_photo' || hero.aspectRatio !== '16:9'
      || !hero.photoAssetId || !hero.photoCredit || !hero.provenance?.trim() || hero.provenance.length > 4000) return;
  try { validatePhotoCredit(hero.photoCredit); } catch { return; }
  if (!['CC0-1.0', 'Pexels'].includes(hero.photoCredit.license)) return;
  if (!publicHttps(hero.assetPath) || !hero.assetPath.startsWith(`${projectUrl}/storage/v1/object/public/creddy-blog-assets/blogs/`)
      || new URL(hero.assetPath).search || new URL(hero.assetPath).hash) return;
  return { url: hero.assetPath, rights: 'licensed', attribution: hero.provenance };
}

/** Match story identity, never brand keywords or unrelated library photographs. */
export function matchingNewsBlog(blogs: CreddyBlogCmsRow[], identity: NewsPhotoIdentity): CreddyBlogCmsRow | undefined {
  const candidates = blogs.filter(blog => blog.publish_state === 'published' && (
    identity.canonicalId && ['article-production-ranking-', 'slideshow-visual-copy-ranking-']
      .some(prefix => blog.content_bank_id === `${prefix}${identity.canonicalId}`)
    || identity.sourceUrl && blog.content.article.sourceUrls.some(source => {
      try { return sourceIdentity(source) === sourceIdentity(identity.sourceUrl!); } catch { return false; }
    })
  ));
  // Ambiguous relationships require editorial selection, not a recency guess.
  return candidates.length === 1 ? candidates[0] : undefined;
}

/** Shares the published, reviewed blog hero. No extra photo provider or schedule.
 * News publishes promptly; its existing durable queue retries until the blog is ready.
 */
export async function prepareNewsPhotoImage(_root: string, _title: string, env = process.env,
  identity: NewsPhotoIdentity = {}): Promise<NewsImageReplacement | undefined> {
  if (!identity.canonicalId && !identity.sourceUrl) return;
  const credentials = resolveWebsiteCmsCredentials(env);
  const client = createClient(credentials.url, credentials.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10_000) }) } });
  const blogs: CreddyBlogCmsRow[] = [];
  for (let offset = 0; ; offset += 100) {
    const response = await client.from('creddy_blog_articles').select('*').eq('publish_state', 'published').order('slug').range(offset, offset + 99);
    if (response.error) throw new Error('Reviewed blog cover lookup is unavailable.');
    blogs.push(...response.data as CreddyBlogCmsRow[]);
    if (response.data.length < 100) break;
  }
  const blog = matchingNewsBlog(blogs, identity);
  return blog ? newsPhotoFromBlog(blog, credentials.url) : undefined;
}
