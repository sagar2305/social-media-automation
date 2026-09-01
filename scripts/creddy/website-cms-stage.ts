import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, open, readFile, rm, stat, unlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, extname, join } from 'node:path';
import { promisify } from 'node:util';

import { createClient } from '@supabase/supabase-js';

import { inspectCreddyArticleImage } from './article-image-stage.js';
import { assertCreddyArticleSeo, loadCreddyArticleSeoPeers, reviewCreddyArticleSeo } from './article-seo-review.js';
import { pathExists, readJson, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import type { ContentBankRecord } from './pipeline-types.js';
import { assertAutoUrgentAuthorizationCurrent, assertProductionAuthorizationCurrent } from './publication-policy.js';
import {
  cleanWebsiteExport,
  readApprovedWebsiteExport,
  type WebsiteRegistryPayload,
} from './website-sync-stage.js';

export const CREDDY_BLOG_TABLE = 'creddy_blog_articles';
export const CREDDY_BLOG_BUCKET = 'creddy-blog-assets';

export type CreddyBlogCmsRow = {
  slug: string;
  content_bank_id: string;
  content: WebsiteRegistryPayload;
  title: string;
  excerpt: string;
  category: string;
  publish_state: 'published';
  approved_by: string;
  approved_at: string;
  content_sha256: string;
  published_at: string;
  source_updated_at: string;
};

export type WebsiteCmsClient = {
  uploadAsset(input: {
    objectPath: string;
    bytes: Uint8Array;
    contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  }): Promise<string>;
  upsertArticle(row: CreddyBlogCmsRow): Promise<void>;
  getPublishedAt?(slug: string): Promise<string | undefined>;
  deleteArticle?(slug: string): Promise<void>;
  deleteAssets?(prefix: string): Promise<number>;
};

export type WebsiteCmsAssetOptimizer = (input: {
  sourceAssetPath: string;
  bytes: Uint8Array;
  contentType: 'image/png' | 'image/jpeg';
}) => Promise<{
  bytes: Uint8Array;
  contentType: 'image/png' | 'image/jpeg' | 'image/webp';
  extension: '.png' | '.jpg' | '.webp';
}>;

export type WebsiteRevalidator = (
  paths: string[],
) => Promise<'revalidated' | 'not_configured' | 'failed'>;

export type CreddyWebsiteCmsPublishResult = {
  slug: string;
  cmsIdentifier: string;
  liveUrl: string;
  uploadedAssets: number;
  publicAssetUrls: string[];
  originalAssetBytes: number;
  uploadedAssetBytes: number;
  storageSavedBytes: number;
  contentSha256: string;
  publishedAt: string;
  revalidation: 'revalidated' | 'not_configured' | 'failed';
  policy: 'agent_7_approved_cms_only';
};

export type CreddyWebsiteCmsBatchResult = {
  reviewed: number;
  published: number;
  skipped: number;
  failures: Array<{ exportPath: string; reason: string }>;
  results: CreddyWebsiteCmsPublishResult[];
};

function safeSlug(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]{1,99}$/.test(value)) {
    throw new Error('Website article slug must be a safe slug');
  }
  return value;
}

async function withCmsPublishLock<T>(root: string, slug: string, action: () => Promise<T>): Promise<T> {
  const lockPath = safeDataPath(root, 'locks', `website-cms-${safeSlug(slug)}.lock`);
  await mkdir(dirname(lockPath), { recursive: true });
  for (let attempt = 0; attempt < 1_200; attempt += 1) {
    try {
      const lockStat = await stat(lockPath);
      if (Date.now() - lockStat.mtimeMs > 10 * 60 * 1000) await unlink(lockPath);
    } catch {
      // A missing lock is the normal path.
    }
    try {
      const handle = await open(lockPath, 'wx');
      try {
        await handle.writeFile(`${JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() })}\n`);
        return await action();
      } finally {
        await handle.close();
        await unlink(lockPath).catch(() => undefined);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 100));
    }
  }
  throw new Error('Website CMS publishing is already in progress');
}

function stableJson(value: unknown): string {
  return JSON.stringify(value);
}

function objectExtension(path: string, mimeType: string): '.png' | '.jpg' {
  const extension = extname(path).toLowerCase();
  if (mimeType === 'image/png' && extension === '.png') return '.png';
  if (mimeType === 'image/jpeg' && (extension === '.jpg' || extension === '.jpeg')) return '.jpg';
  throw new Error('Website CMS asset extension does not match its image container');
}

const execFileAsync = promisify(execFile);

export function createCwebpWebsiteCmsAssetOptimizer(
  quality = 88,
): WebsiteCmsAssetOptimizer {
  if (!Number.isInteger(quality) || quality < 75 || quality > 95) {
    throw new Error('Website CMS WebP quality must be an integer between 75 and 95');
  }
  return async ({ sourceAssetPath, bytes, contentType }) => {
    const originalExtension = objectExtension(sourceAssetPath, contentType);
    const workDirectory = await mkdtemp(join(tmpdir(), 'creddy-cms-webp-'));
    const outputPath = join(workDirectory, 'optimized.webp');
    try {
      await execFileAsync('cwebp', [
        '-quiet', '-q', String(quality), '-m', '6', '-metadata', 'none',
        sourceAssetPath, '-o', outputPath,
      ]);
      const optimized = await readFile(outputPath);
      if (optimized.byteLength >= bytes.byteLength) {
        return { bytes, contentType, extension: originalExtension };
      }
      return { bytes: optimized, contentType: 'image/webp', extension: '.webp' };
    } catch (error) {
      throw new Error(
        `Website CMS WebP optimization failed for ${sourceAssetPath}; install cwebp with brew install webp: ${(error as Error).message}`,
      );
    } finally {
      await rm(workDirectory, { recursive: true, force: true });
    }
  };
}

export function createSupabaseWebsiteCmsClient(
  url: string,
  serviceRoleKey: string,
): WebsiteCmsClient {
  if (!url.trim() || !serviceRoleKey.trim()) {
    throw new Error('Website CMS publishing requires Supabase URL and service-role credentials');
  }
  const supabase = createClient(url, serviceRoleKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  return {
    async uploadAsset({ objectPath, bytes, contentType }) {
      const { error } = await supabase.storage.from(CREDDY_BLOG_BUCKET).upload(
        objectPath,
        bytes,
        {
          cacheControl: '31536000',
          contentType,
          upsert: true,
        },
      );
      if (error) throw new Error(`Website CMS asset upload failed: ${error.message}`);
      const { data } = supabase.storage.from(CREDDY_BLOG_BUCKET).getPublicUrl(objectPath);
      if (!data.publicUrl) throw new Error('Website CMS asset upload returned no public URL');
      return data.publicUrl;
    },
    async upsertArticle(row) {
      const { error } = await supabase
        .from(CREDDY_BLOG_TABLE)
        .upsert(row, { onConflict: 'slug' });
      if (error) throw new Error(`Website CMS article upsert failed: ${error.message}`);
    },
    async getPublishedAt(slug) {
      const { data, error } = await supabase
        .from(CREDDY_BLOG_TABLE)
        .select('published_at')
        .eq('slug', slug)
        .maybeSingle();
      if (error) throw new Error(`Website CMS publication-date lookup failed: ${error.message}`);
      return data?.published_at;
    },
    async deleteArticle(slug) {
      const { error } = await supabase.from(CREDDY_BLOG_TABLE).delete().eq('slug', slug);
      if (error) throw new Error(`Website CMS article delete failed: ${error.message}`);
    },
    async deleteAssets(prefix) {
      const { data, error } = await supabase.storage.from(CREDDY_BLOG_BUCKET).list(prefix, { limit: 1000 });
      if (error) throw new Error(`Website CMS asset listing failed: ${error.message}`);
      const paths = (data ?? []).filter((item) => item.name).map((item) => `${prefix}/${item.name}`);
      if (!paths.length) return 0;
      const removed = await supabase.storage.from(CREDDY_BLOG_BUCKET).remove(paths);
      if (removed.error) throw new Error(`Website CMS asset delete failed: ${removed.error.message}`);
      return paths.length;
    },
  };
}

export async function unpublishWebsiteArticleFromCms(options: {
  slug: string;
  client: WebsiteCmsClient;
  revalidate?: WebsiteRevalidator;
}): Promise<{ removedAssets: number; revalidation: 'revalidated' | 'not_configured' | 'failed' }> {
  const slug = safeSlug(options.slug);
  if (!options.client.deleteArticle || !options.client.deleteAssets) {
    throw new Error('Website CMS client does not support article deletion');
  }
  await options.client.deleteArticle(slug);
  const removedAssets = await options.client.deleteAssets(`blogs/${slug}`);
  const revalidation = await (options.revalidate ?? (async () => 'not_configured' as const))([
    '/blog',
    `/blog/${slug}`,
    '/sitemap.xml',
  ]);
  return { removedAssets, revalidation };
}

export function createWebsiteRevalidator(options: {
  websiteBaseUrl?: string;
  secret?: string;
  fetcher?: typeof fetch;
}): WebsiteRevalidator {
  const base = options.websiteBaseUrl?.trim().replace(/\/$/, '');
  const secret = options.secret?.trim();
  if (!base || !secret) return async () => 'not_configured';
  const fetcher = options.fetcher ?? fetch;
  return async (paths) => {
    try {
      const response = await fetcher(`${base}/api/revalidate`, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${secret}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({ paths }),
      });
      return response.ok ? 'revalidated' : 'failed';
    } catch {
      return 'failed';
    }
  };
}

export async function publishApprovedWebsiteExportToCms(
  root: string,
  exportPath: string,
  options: {
    allowCmsPublish: boolean;
    client: WebsiteCmsClient;
    assetOptimizer?: WebsiteCmsAssetOptimizer;
    revalidate?: WebsiteRevalidator;
    websiteBaseUrl?: string;
    now?: Date;
  },
): Promise<CreddyWebsiteCmsPublishResult> {
  if (!options.allowCmsPublish) {
    throw new Error('Website CMS publishing requires explicit CREDDY_WEBSITE_CMS_PUBLISH_ENABLED=true');
  }
  const payload = await readApprovedWebsiteExport(root, exportPath);
  const clean = cleanWebsiteExport(payload);
  const slug = safeSlug(payload.article.slug);
  const seoReview = reviewCreddyArticleSeo({
    article: payload.article,
    visuals: payload.visuals,
    peers: await loadCreddyArticleSeoPeers(root, payload.article.id),
  });
  const bank = await readJson<ContentBankRecord>(
    safeDataPath(root, '09-pending-approval', `${payload.contentBankId}.json`),
  );
  const mutationNow = options.now ?? new Date();
  await assertProductionAuthorizationCurrent(root, bank, mutationNow);
  if (bank.approvalMode === 'auto_urgent' || bank.productionAuthorization?.approvalMode === 'auto_urgent') {
    await assertAutoUrgentAuthorizationCurrent(root, bank, mutationNow);
  }
  const seoCheckedAt = (options.now ?? new Date()).toISOString();
  const seoCheckedAtSlug = seoCheckedAt.replace(/[^0-9A-Za-z]+/g, '').slice(0, 24);
  await writeJsonAtomic(
    safeDataPath(root, 'reports', 'blog-seo-reviews', `${payload.contentBankId}-prepublish-${seoCheckedAtSlug}-${seoReview.contentSha256.slice(0, 12)}.json`),
    { ...seoReview, contentBankId: payload.contentBankId, approvedAt: payload.approvedAt, checkedAt: seoCheckedAt, stage: 'agent_8_prepublish' },
  );
  assertCreddyArticleSeo(seoReview);
  if (
    bank.articleReview?.seoReview?.status !== 'pass' ||
    bank.articleReview.seoReview.contentSha256 !== seoReview.contentSha256
  ) {
    throw new Error('Article SEO review is missing, failed, or no longer matches the approved article');
  }
  if (payload.visuals.assets.length !== 3) throw new Error('Website CMS publishing requires exactly three approved article images');
  const publicAssetUrls: string[] = [];
  const assets = [];
  let originalAssetBytes = 0;
  let uploadedAssetBytes = 0;

  for (const asset of payload.visuals.assets) {
    const bytes = await readFile(asset.sourceAssetPath);
    const metadata = inspectCreddyArticleImage(bytes);
    if (metadata.width * 9 !== metadata.height * 16 || asset.aspectRatio !== '16:9') {
      throw new Error(`Website CMS visual ${asset.id} must be exact 16:9`);
    }
    originalAssetBytes += bytes.byteLength;
    const upload = options.assetOptimizer
      ? await options.assetOptimizer({
        sourceAssetPath: asset.sourceAssetPath,
        bytes,
        contentType: metadata.mimeType,
      })
      : {
        bytes,
        contentType: metadata.mimeType,
        extension: objectExtension(asset.sourceAssetPath, metadata.mimeType),
      };
    uploadedAssetBytes += upload.bytes.byteLength;
    const fingerprint = createHash('sha256').update(upload.bytes).digest('hex').slice(0, 20);
    const safeAssetId = asset.id.replace(/[^a-zA-Z0-9_-]+/g, '-');
    const objectPath = `blogs/${slug}/${safeAssetId}-${fingerprint}${upload.extension}`;
    const publicUrl = await options.client.uploadAsset({
      objectPath,
      bytes: upload.bytes,
      contentType: upload.contentType,
    });
    publicAssetUrls.push(publicUrl);
    assets.push({
      ...clean.visuals.assets.find((candidate) => candidate.id === asset.id)!,
      assetPath: publicUrl,
    });
  }

  const content: WebsiteRegistryPayload = {
    ...clean,
    visuals: {
      ...clean.visuals,
      assets,
    },
    publishState: 'ready_for_getcreddy_integration',
  };
  const contentSha256 = createHash('sha256').update(stableJson(content)).digest('hex');
  const now = options.now ?? new Date();
  const publishedAt = await options.client.getPublishedAt?.(slug) ?? now.toISOString();
  await options.client.upsertArticle({
    slug,
    content_bank_id: payload.contentBankId,
    content,
    title: payload.article.title,
    excerpt: payload.article.excerpt,
    category: payload.article.category,
    publish_state: 'published',
    approved_by: payload.approvedBy,
    approved_at: payload.approvedAt,
    content_sha256: contentSha256,
    published_at: publishedAt,
    source_updated_at: payload.article.updatedAt,
  });
  const revalidation = await (options.revalidate ?? (async () => 'not_configured' as const))([
    '/blog',
    `/blog/${slug}`,
    '/sitemap.xml',
  ]);
  return {
    slug,
    cmsIdentifier: slug,
    liveUrl: `${(options.websiteBaseUrl?.trim() || 'https://getcreddy.com').replace(/\/$/, '')}/blog/${slug}`,
    uploadedAssets: assets.length,
    publicAssetUrls,
    originalAssetBytes,
    uploadedAssetBytes,
    storageSavedBytes: originalAssetBytes - uploadedAssetBytes,
    contentSha256,
    publishedAt,
    revalidation,
    policy: 'agent_7_approved_cms_only',
  };
}

export async function publishReadyWebsiteExportsToCms(
  root: string,
  exportPaths: string[],
  options: {
    allowCmsPublish: boolean;
    client: WebsiteCmsClient;
    assetOptimizer?: WebsiteCmsAssetOptimizer;
    forceRepublish?: boolean;
    revalidate?: WebsiteRevalidator;
    websiteBaseUrl?: string;
    now?: Date;
  },
): Promise<CreddyWebsiteCmsBatchResult> {
  const batch: CreddyWebsiteCmsBatchResult = {
    reviewed: exportPaths.length,
    published: 0,
    skipped: 0,
    failures: [],
    results: [],
  };
  for (const exportPath of exportPaths) {
    try {
      const payload = await readJson<{ article: { slug: string }; approvedAt: string }>(exportPath);
      const slug = safeSlug(payload.article.slug);
      const receiptPath = safeDataPath(root, 'reports', 'website-cms-published', `${slug}.json`);
      const outcome = await withCmsPublishLock(root, slug, async () => {
        if (!options.forceRepublish && await pathExists(receiptPath)) {
          const receipt = await readJson<{ approvedAt?: string; contentSha256?: string }>(receiptPath);
          if (receipt.approvedAt === payload.approvedAt && receipt.contentSha256) return { skipped: true as const };
        }
        const result = await publishApprovedWebsiteExportToCms(root, exportPath, options);
        await writeJsonAtomic(receiptPath, {
          version: 1,
          slug: result.slug,
          approvedAt: payload.approvedAt,
          contentSha256: result.contentSha256,
          publishedAt: result.publishedAt,
          revalidation: result.revalidation,
          cmsIdentifier: result.cmsIdentifier,
          liveUrl: result.liveUrl,
        });
        await unlink(safeDataPath(root, 'reports', 'website-cms-failed', `${slug}.json`)).catch(() => undefined);
        return { skipped: false as const, result };
      });
      if (outcome.skipped) batch.skipped += 1;
      else {
        batch.results.push(outcome.result);
        batch.published += 1;
      }
    } catch (error) {
      const reason = (error as Error).message;
      batch.failures.push({ exportPath, reason });
      try {
        const failedPayload = await readJson<{ article: { slug: string }; approvedAt: string }>(exportPath);
        const failedSlug = safeSlug(failedPayload.article.slug);
        await writeJsonAtomic(safeDataPath(root, 'reports', 'website-cms-failed', `${failedSlug}.json`), {
          version: 1,
          slug: failedSlug,
          approvedAt: failedPayload.approvedAt,
          failedAt: (options.now ?? new Date()).toISOString(),
          reason: 'Agent 8 could not publish this approved article.',
        });
      } catch {
        // Invalid exports remain visible in the batch failure without creating a misleading receipt.
      }
    }
  }
  return batch;
}
