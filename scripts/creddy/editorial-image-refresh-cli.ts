import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { editorialBrandRegistry, matchEditorialBrands, composeEditorialImage } from './brand-asset-registry.js';
import { refreshPublishedBlogImages } from './blog-image-refresh.js';
import { uploadEditorialImage } from './editorial-image-delivery.js';
import { resolveWebsiteCmsCredentials } from './instant-website-publish.js';
import { resolveCreddyDataRoot, safeDataPath, writeJsonAtomic, pathExists } from './pipeline-store.js';
import { createWebsiteRevalidator, type CreddyBlogCmsRow } from './website-cms-stage.js';
import { configuredNewsService } from '../../shared/creddy-news/creddy-news-service.js';
import { notifyNews } from '../../shared/creddy-news/creddy-news-slack.js';
import type { NewsItem } from '../../shared/creddy-news/creddy-news-types.js';
import { composeEditorialPhoto } from './editorial-photos.js';
import { replaceBlogVisuals, validatePhotoRefreshPreview, type BlogVisualReplacement } from './blog-image-refresh.js';

type PlannedImage = Omit<BlogVisualReplacement, 'assetPath'> & { path: string; sha256: string };
type PlannedItem = { kind: 'blog' | 'news'; id: string; title: string; expectedHash?: string; expectedRevision?: number;
  brands: string[]; images: PlannedImage[]; status: 'ready' | 'pending'; reason?: string };
type RefreshPlan = { version: 1; projectRef: string; items: PlannedItem[] };
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

async function main() {
  const command = process.argv[2];
  if (!['plan', 'plan-photos', 'apply'].includes(command)) throw new Error('Use editorial-images plan, plan-photos <selections.json>, or apply <plan.json>');
  const credentials = resolveWebsiteCmsCredentials();
  const client = createClient(credentials.url, credentials.serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(15_000) }) } });
  const root = resolveCreddyDataRoot();
  const news = configuredNewsService();
  if (command === 'plan-photos') {
    if (!process.argv[3]) throw new Error('Explicit reviewed photo selections are required');
    const selections = JSON.parse(await readFile(resolve(process.argv[3]), 'utf8')) as Array<{ slug: string; photoAssetId: string; reason: string }>;
    if (!Array.isArray(selections) || !selections.length || new Set(selections.map(item => item.slug)).size !== selections.length
        || selections.some(item => !/^[a-z0-9][a-z0-9-]{1,99}$/.test(item.slug) || !item.photoAssetId || !item.reason?.trim())) {
      throw new Error('Each photo selection requires a unique slug, reviewed photo ID and editorial reason');
    }
    const plan: RefreshPlan = { version: 1, projectRef: credentials.projectRef, items: [] };
    for (const selection of selections) {
      const response = await client.from('creddy_blog_articles').select('*').eq('slug', selection.slug).eq('publish_state', 'published').maybeSingle();
      if (response.error || !response.data) throw new Error('Selected published blog could not be read');
      const blog = response.data as CreddyBlogCmsRow;
      const rendered = await composeEditorialPhoto({ root, photoId: selection.photoAssetId, usage: 'hero' });
      const image: PlannedImage = { id: blog.content.article.heroVisualId, path: rendered.assetPath, sha256: hash(await readFile(rendered.assetPath)),
        photoAssetId: selection.photoAssetId, photoCredit: rendered.photoCredit,
        altText: rendered.altText, caption: rendered.caption, provenance: rendered.provenanceText };
      // Validate the hero/block boundary before creating an applicable plan.
      replaceBlogVisuals(blog.content, [{ ...image, assetPath: 'https://preview.invalid/reviewed-photo.png' }]);
      plan.items.push({ kind: 'blog', id: blog.slug, title: blog.title, expectedHash: blog.content_sha256,
        brands: [], images: [image], status: 'ready', reason: selection.reason });
    }
    const path = safeDataPath(root, 'reports', 'editorial-image-refresh', randomUUID(), 'plan.json');
    await writeJsonAtomic(path, plan);
    console.log(JSON.stringify({ path, blogs: plan.items.length, images: plan.items.map(item => ({ slug: item.id, path: item.images[0]!.path })) }, null, 2));
    return;
  }
  if (command === 'plan') {
    const registry = await editorialBrandRegistry();
    const blogs: CreddyBlogCmsRow[] = [];
    for (let offset = 0; ; offset += 100) {
      const response = await client.from('creddy_blog_articles').select('*').eq('publish_state', 'published').order('slug').range(offset, offset + 99);
      if (response.error) throw new Error('Published blog inventory could not be read');
      blogs.push(...response.data as CreddyBlogCmsRow[]);
      if (response.data.length < 100) break;
    }
    const newsItems: NewsItem[] = [];
    for (let offset = 0; ; offset += 100) {
      const page = await news.list(offset); newsItems.push(...page.filter(item => item.status === 'published'));
      if (page.length < 100) break;
    }
    const plan: RefreshPlan = { version: 1, projectRef: credentials.projectRef, items: [] };
    for (const source of [...blogs.map(blog => ({ kind: 'blog' as const, id: blog.slug, title: blog.title, blog })),
      ...newsItems.map(item => ({ kind: 'news' as const, id: item.id, title: item.content.headline, news: item }))]) {
      const identity = 'blog' in source ? `${source.title} ${source.blog.slug.replace(/-/g, ' ')} ${source.blog.content.article.dek} ${source.blog.content.article.blocks.flatMap(block =>
        block.type === 'paragraph' ? [block.text] : block.type === 'key_takeaways' ? block.items : block.type === 'comparison_table' ? block.rows.flat() : []).join(' ').slice(0, 5000)}`
        : `${source.title} ${source.news.content.summary}`;
      const brands = matchEditorialBrands(identity, registry).map(brand => brand.id);
      const item: PlannedItem = { kind: source.kind, id: source.id, title: source.title, brands, images: [], status: 'ready',
        ...('blog' in source ? { expectedHash: source.blog.content_sha256 } : { expectedRevision: source.news.revision }) };
      plan.items.push(item);
      if (source.kind === 'news' && !brands.length) {
        item.status = 'pending'; item.reason = 'No reviewed brand asset matches; existing News image retained.'; continue;
      }
      try {
        const visuals = 'blog' in source ? source.blog.content.visuals.assets : [{ id: 'hero', usage: 'hero' as const, articleBlockId: '' }];
        if ('blog' in source && visuals.length !== 3) throw new Error('Unexpected blog image count');
        for (const [index, visual] of visuals.entries()) {
          const block = 'blog' in source ? source.blog.content.article.blocks.find(block => block.id === visual.articleBlockId) : undefined;
          const section = block && ('text' in block ? block.text : 'caption' in block ? block.caption : 'title' in block ? block.title : '');
          const rendered = await composeEditorialImage({ root, title: `${source.title} ${section || ''}`,
            usage: visual.usage === 'hero' ? 'hero' : index === visuals.length - 1 ? 'comparison' : 'inline', brandIds: brands });
          item.images.push({ id: visual.id, path: rendered.assetPath, sha256: hash(await readFile(rendered.assetPath)),
            altText: rendered.altText, caption: rendered.caption, provenance: rendered.provenanceText });
        }
      } catch { item.status = 'pending'; item.reason = 'Composition failed; item retained for a fresh plan and retry.'; }
    }
    const path = safeDataPath(root, 'reports', 'editorial-image-refresh', randomUUID(), 'plan.json');
    await writeJsonAtomic(path, plan);
    console.log(JSON.stringify({ path, blogs: blogs.length, news: newsItems.length, ready: plan.items.filter(item => item.status === 'ready').length,
      pending: plan.items.filter(item => item.status === 'pending').map(item => ({ id: item.id, reason: item.reason })),
      flatFallbackBlogs: plan.items.filter(item => item.kind === 'blog' && !item.brands.length).map(item => item.id) }, null, 2));
    return;
  }
  const path = resolve(process.argv[3] || '');
  if (!process.argv[3]) throw new Error('An explicit reviewed plan path is required');
  const plan = JSON.parse(await readFile(path, 'utf8')) as RefreshPlan;
  if (plan.version !== 1 || plan.projectRef !== credentials.projectRef || !Array.isArray(plan.items)) throw new Error('Refresh plan project or version mismatch');
  const revalidate = createWebsiteRevalidator({ websiteBaseUrl: process.env.CREDDY_WEBSITE_BASE_URL, secret: process.env.CREDDY_WEBSITE_REVALIDATE_SECRET });
  // Every attempt has its own results: retries cannot erase prior receipts.
  const resultPath = safeDataPath(dirname(path), `results-${randomUUID()}.json`);
  const results: Record<string, unknown>[] = [];
  for (const item of plan.items) {
    if (item.status !== 'ready') {
      if (item.kind === 'news' && /^[a-zA-Z0-9_-]{1,90}$/.test(item.id)) {
        await writeJsonAtomic(safeDataPath(root, 'reports', 'news-image-pending', `backfill-${item.id}.json`), {
          id: `backfill-${item.id}`, newsId: item.id, status: 'pending_image_refresh', reason: item.reason, recordedAt: new Date().toISOString(),
        });
      }
      results.push({ kind: item.kind, id: item.id, status: 'pending', reason: item.reason }); continue;
    }
    try {
      if (!/^[a-zA-Z0-9_-]{1,100}$/.test(item.id)) throw new Error('Invalid item ID');
      const replacements = [];
      for (const image of item.images) {
        if (hash(await readFile(image.path)) !== image.sha256) throw new Error('Preview image changed after planning');
        if (image.photoAssetId) {
          if (item.kind !== 'blog' || item.images.length !== 1) throw new Error('Archive photos are blog hero only');
          await validatePhotoRefreshPreview(image, root);
        }
        replacements.push({ id: image.id, assetPath: await uploadEditorialImage(image.path, `${item.id}-${image.id}`),
          altText: image.altText, caption: image.caption, provenance: image.provenance,
          photoAssetId: image.photoAssetId, photoCredit: image.photoCredit });
      }
      if (item.kind === 'blog') {
        const result = await refreshPublishedBlogImages({ client, slug: item.id, expectedHash: item.expectedHash!, replacements, root });
        const revalidation = result.status === 'updated' || result.status === 'noop' ? await revalidate(['/blog', `/blog/${item.id}`]) : 'not_attempted';
        results.push({ kind: item.kind, id: item.id, ...result, revalidation });
      } else if (item.kind === 'news') {
        if (replacements.length !== 1) throw new Error('News requires one reviewed image');
        const previous = await news.get(item.id);
        const image = replacements[0]!;
        const desired = { url: image.assetPath, rights: 'editorial_reference' as const, attribution: image.provenance };
        const previousRights = previous.provenance.imageRights as typeof desired | undefined;
        const alreadyApplied = previous.content.image_url === desired.url && previousRights?.url === desired.url
          && previousRights.rights === desired.rights && previousRights.attribution === desired.attribution;
        if (previous.status !== 'published' || (!alreadyApplied && previous.revision !== item.expectedRevision)) throw new Error('News changed since planning');
        const preimagePath = safeDataPath(dirname(path), `${item.id}-preimage.json`);
        // Keep the first preimage across retries of this plan.
        if (!await pathExists(preimagePath)) await writeJsonAtomic(preimagePath, previous);
        const updated = alreadyApplied ? previous : await news.setImage(item.id, item.expectedRevision!, desired, 'editorial-image-refresh');
        let notification = 'pending';
        try {
          await notifyNews(news, updated.id, process.env);
          const receipt = await news.get(updated.id);
          if (receipt.slack_revision >= receipt.revision && receipt.slack_ts && receipt.slack_channel && !receipt.slack_error) notification = 'confirmed';
        } catch { /* Retain pending receipt for an idempotent same-plan retry. */ }
        results.push({ kind: item.kind, id: item.id, status: alreadyApplied ? 'noop' : 'updated', revision: updated.revision, notification, preimagePath });
      } else throw new Error('Unsupported image refresh kind');
    } catch { results.push({ kind: item.kind, id: item.id, status: 'retry', reason: 'Image refresh failed or content changed; no content overwrite was attempted without a matching revision.' }); }
    await writeJsonAtomic(resultPath, results);
  }
  await writeJsonAtomic(resultPath, results);
  console.log(JSON.stringify({ resultPath, results }, null, 2));
}

main().catch(() => { console.error('Editorial image operation failed. No credentials are included in this error. Check the reviewed plan and service configuration.'); process.exitCode = 1; });
