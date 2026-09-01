import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CREDDY_ARTICLE_IMAGE_BLOCK, CREDDY_ARTICLE_THEME } from './article-content.js';
import { reviewCreddyArticleSeo } from './article-seo-review.js';
import { initializeCreddyDataRoot, readJson, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import { CREDDY_PIPELINE_VERSION, type ContentBankRecord } from './pipeline-types.js';
import {
  publishApprovedWebsiteExportToCms,
  publishReadyWebsiteExportsToCms,
  unpublishWebsiteArticleFromCms,
  type CreddyBlogCmsRow,
  type WebsiteCmsClient,
} from './website-cms-stage.js';
import {
  CREDDY_WEBSITE_EXPORT_VERSION,
  creddyWebsiteAssetPath,
  type CreddyWebsiteExportPayload,
} from './website-stage.js';

function pngFixture(width: number, height: number): Uint8Array {
  const bytes = Buffer.alloc(12_000);
  bytes.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  bytes.writeUInt32BE(13, 8);
  bytes.write('IHDR', 12, 'ascii');
  bytes.writeUInt32BE(width, 16);
  bytes.writeUInt32BE(height, 20);
  return bytes;
}

async function approvedFixture(): Promise<{ root: string; exportPath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'creddy-website-cms-'));
  await initializeCreddyDataRoot(root);
  const sourceAssetPaths = ['hero', 'detail', 'summary'].map((id) => join(root, `${id}.png`));
  await Promise.all(sourceAssetPaths.map((path) => writeFile(path, pngFixture(1600, 900))));
  const previewPath = join(root, 'preview.html');
  await writeFile(previewPath, '<!doctype html><title>Approved preview</title>');
  const approvedAt = '2026-08-26T08:00:00.000Z';
  const slug = 'cms-test-article';
  const payload: CreddyWebsiteExportPayload = {
    version: CREDDY_WEBSITE_EXPORT_VERSION,
    contentBankId: 'bank-cms-1',
    approvedBy: 'boss-reviewer',
    approvedAt,
    route: `/blog/${slug}`,
    design: {
      version: 'creddy-guides-v1',
      tokens: CREDDY_ARTICLE_THEME,
      articleImageBlock: CREDDY_ARTICLE_IMAGE_BLOCK,
    },
    article: {
      version: 'creddy-article-v1', designVersion: 'creddy-guides-v1', id: 'article-cms-1', slug,
      category: 'guides', title: 'How Credit Card Benefit Resets Work', dek: 'A verified explanation of benefit reset timing.', excerpt: 'Understand credit card benefit reset timing before counting on the value.',
      seoTitle: 'How Credit Card Benefit Resets Work — Creddy', seoDescription: 'Learn how credit card benefit resets work, when the value renews, and what to verify before relying on a benefit in your budget.', authorName: 'Creddy Editorial',
      createdAt: approvedAt, updatedAt: approvedAt, readingMinutes: 4, heroVisualId: 'hero',
      blocks: [
        { id: 'hero-block', type: 'visual', visualId: 'hero', caption: 'Approved hero visual.' },
        { id: 'detail-block', type: 'visual', visualId: 'detail', caption: 'Approved detail visual.' },
        { id: 'summary-block', type: 'visual', visualId: 'summary', caption: 'Approved summary visual.' },
        { id: 'reset-heading', type: 'heading', level: 2, text: 'Understand the benefit reset clock' },
        { id: 'reset-copy', type: 'paragraph', text: 'A credit card benefit reset determines when a cardholder can use the next benefit period and which terms need confirmation.', claimFields: [] },
        { id: 'decision-heading', type: 'heading', level: 2, text: 'Verify the timing before deciding' },
      ],
      sourceUrls: ['https://example.com/source'], referralDisclosure: 'Creddy may earn a commission from approved links.',
    },
    visuals: {
      version: 'creddy-article-visuals-v1', designVersion: 'creddy-guides-v1', imageBlockStyle: 'creddy-abstract-editorial-v1',
      assets: ['hero', 'detail', 'summary'].map((id, index) => ({
        id,
        usage: index === 0 ? 'hero' as const : 'inline' as const,
        articleBlockId: `${id}-block`,
        assetType: 'editorial_illustration' as const,
        aspectRatio: '16:9' as const,
        generationMode: 'generate' as const,
        altText: `Abstract editorial visual ${index + 1}`,
        caption: `Approved visual ${index + 1}.`,
        claimFields: [],
        sourceAssetPath: sourceAssetPaths[index]!,
        assetPath: creddyWebsiteAssetPath(slug, id, sourceAssetPaths[index]!),
      })),
    },
    referrals: [],
    previewPath,
    publishState: 'ready_for_getcreddy_integration',
  };
  const seoReview = reviewCreddyArticleSeo({ article: payload.article, visuals: payload.visuals });
  const bank: ContentBankRecord = {
    version: CREDDY_PIPELINE_VERSION,
    id: payload.contentBankId,
    contentPackageId: 'package-cms-1',
    createdAt: approvedAt,
    status: 'pending_review',
    revision: 1,
    articleReview: {
      status: 'approved', approvedBy: payload.approvedBy, approvedAt,
      seoReview: {
        status: seoReview.status,
        reviewedAt: approvedAt,
        reportPath: join(root, 'reports', 'blog-seo-reviews', 'bank-cms-1.json'),
        contentSha256: seoReview.contentSha256,
        warnings: seoReview.warnings,
      },
    },
  };
  await writeJsonAtomic(safeDataPath(root, '09-pending-approval', `${bank.id}.json`), bank);
  const exportPath = safeDataPath(root, '14-website-ready', `${slug}.json`);
  await writeJsonAtomic(exportPath, payload);
  return { root, exportPath };
}

test('Agent 8 CMS publish requires the explicit external-write gate', async () => {
  const fixture = await approvedFixture();
  const client: WebsiteCmsClient = {
    uploadAsset: async () => { throw new Error('must not upload'); },
    upsertArticle: async () => { throw new Error('must not upsert'); },
  };
  await assert.rejects(
    publishApprovedWebsiteExportToCms(fixture.root, fixture.exportPath, { allowCmsPublish: false, client }),
    /CREDDY_WEBSITE_CMS_PUBLISH_ENABLED=true/,
  );
});

test('Agent 8 SEO failure happens before any CMS upload or mutation', async () => {
  const fixture = await approvedFixture();
  const payload = await readJson<CreddyWebsiteExportPayload>(fixture.exportPath);
  payload.article.seoTitle = 'Generic rewards guide';
  await writeJsonAtomic(fixture.exportPath, payload);
  let mutations = 0;
  const client: WebsiteCmsClient = {
    async uploadAsset() { mutations += 1; return 'https://example.com/asset'; },
    async upsertArticle() { mutations += 1; },
  };
  await assert.rejects(
    publishApprovedWebsiteExportToCms(fixture.root, fixture.exportPath, { allowCmsPublish: true, client }),
    /Article SEO review failed/,
  );
  assert.equal(mutations, 0);
});

test('Agent 8 rejects SEO-valid content whose hash no longer matches Agent 7 review', async () => {
  const fixture = await approvedFixture();
  const payload = await readJson<CreddyWebsiteExportPayload>(fixture.exportPath);
  payload.article.dek = 'An updated but still search-aligned explanation of credit card benefit reset timing.';
  await writeJsonAtomic(fixture.exportPath, payload);
  let mutations = 0;
  const client: WebsiteCmsClient = {
    async uploadAsset() { mutations += 1; return 'https://example.com/asset'; },
    async upsertArticle() { mutations += 1; },
  };
  await assert.rejects(
    publishApprovedWebsiteExportToCms(fixture.root, fixture.exportPath, { allowCmsPublish: true, client }),
    /no longer matches the approved article/,
  );
  assert.equal(mutations, 0);
});

test('Agent 8 unpublish removes the CMS row, immutable asset set, and revalidates singular blog routes', async () => {
  const calls: string[] = [];
  const client: WebsiteCmsClient = {
    async uploadAsset() { throw new Error('not used'); },
    async upsertArticle() { throw new Error('not used'); },
    async deleteArticle(slug) { calls.push(`row:${slug}`); },
    async deleteAssets(prefix) { calls.push(`assets:${prefix}`); return 3; },
  };
  const result = await unpublishWebsiteArticleFromCms({
    slug: 'cms-test-article',
    client,
    revalidate: async (paths) => { calls.push(...paths); return 'revalidated'; },
  });
  assert.equal(result.removedAssets, 3);
  assert.equal(result.revalidation, 'revalidated');
  assert.deepEqual(calls, [
    'row:cms-test-article',
    'assets:blogs/cms-test-article',
    '/blog',
    '/blog/cms-test-article',
    '/sitemap.xml',
  ]);
});

test('Agent 8 CMS publish validates, uploads immutable images, and strips local paths', async () => {
  const fixture = await approvedFixture();
  const objectPaths: string[] = [];
  let row: CreddyBlogCmsRow | undefined;
  let revalidated: string[] = [];
  const client: WebsiteCmsClient = {
    async uploadAsset(input) {
      objectPaths.push(input.objectPath);
      return `https://ibcwjcoswrxiebmospxc.supabase.co/storage/v1/object/public/creddy-blog-assets/${input.objectPath}`;
    },
    async upsertArticle(value) { row = value; },
  };
  const result = await publishApprovedWebsiteExportToCms(fixture.root, fixture.exportPath, {
    allowCmsPublish: true,
    client,
    now: new Date('2026-08-26T09:00:00.000Z'),
    revalidate: async (paths) => { revalidated = paths; return 'revalidated'; },
  });

  assert.equal(result.uploadedAssets, 3);
  assert.equal(objectPaths.length, 3);
  assert.match(objectPaths[0], /^blogs\/cms-test-article\/hero-[a-f0-9]{20}\.png$/);
  assert.equal(row?.approved_by, 'boss-reviewer');
  assert.equal(row?.publish_state, 'published');
  assert.match(row?.content_sha256 ?? '', /^[a-f0-9]{64}$/);
  assert.doesNotMatch(JSON.stringify(row?.content), /sourceAssetPath|previewPath/);
  assert.match(row?.content.visuals.assets[0].assetPath ?? '', /creddy-blog-assets\/blogs\/cms-test-article/);
  assert.deepEqual(revalidated, ['/blog', '/blog/cms-test-article', '/sitemap.xml']);
});

test('Agent 8 CMS publish can optimize approved images to fingerprinted WebP assets', async () => {
  const fixture = await approvedFixture();
  const uploads: Array<{ objectPath: string; byteLength: number; contentType: string }> = [];
  const client: WebsiteCmsClient = {
    async uploadAsset(input) {
      uploads.push({
        objectPath: input.objectPath,
        byteLength: input.bytes.byteLength,
        contentType: input.contentType,
      });
      return `https://ibcwjcoswrxiebmospxc.supabase.co/storage/v1/object/public/creddy-blog-assets/${input.objectPath}`;
    },
    async upsertArticle() {},
  };
  const result = await publishApprovedWebsiteExportToCms(fixture.root, fixture.exportPath, {
    allowCmsPublish: true,
    client,
    assetOptimizer: async () => ({
      bytes: Buffer.alloc(900),
      contentType: 'image/webp',
      extension: '.webp',
    }),
  });

  assert.match(uploads[0].objectPath, /^blogs\/cms-test-article\/hero-[a-f0-9]{20}\.webp$/);
  assert.equal(uploads[0].contentType, 'image/webp');
  assert.equal(uploads[0].byteLength, 900);
  assert.equal(result.originalAssetBytes, 36_000);
  assert.equal(result.uploadedAssetBytes, 2_700);
  assert.equal(result.storageSavedBytes, 33_300);
});

test('scheduled Agent 8 CMS publishing skips an approval already published successfully', async () => {
  const fixture = await approvedFixture();
  let uploads = 0;
  let upserts = 0;
  const client: WebsiteCmsClient = {
    async uploadAsset(input) {
      uploads += 1;
      return `https://ibcwjcoswrxiebmospxc.supabase.co/storage/v1/object/public/creddy-blog-assets/${input.objectPath}`;
    },
    async upsertArticle() { upserts += 1; },
  };
  const first = await publishReadyWebsiteExportsToCms(fixture.root, [fixture.exportPath], {
    allowCmsPublish: true,
    client,
  });
  const second = await publishReadyWebsiteExportsToCms(fixture.root, [fixture.exportPath], {
    allowCmsPublish: true,
    client,
  });
  assert.equal(first.published, 1);
  assert.equal(second.skipped, 1);
  assert.equal(uploads, 3);
  assert.equal(upserts, 1);
});

test('concurrent Agent 8 callbacks publish one row and one immutable set of three assets', async () => {
  const fixture = await approvedFixture();
  const objectPaths: string[] = [];
  let upserts = 0;
  const client: WebsiteCmsClient = {
    async uploadAsset(input) {
      objectPaths.push(input.objectPath);
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 10));
      return `https://projectrefalpha.supabase.co/storage/v1/object/public/creddy-blog-assets/${input.objectPath}`;
    },
    async upsertArticle() { upserts += 1; },
  };
  const publish = () => publishReadyWebsiteExportsToCms(fixture.root, [fixture.exportPath], {
    allowCmsPublish: true,
    client,
  });
  const [first, second] = await Promise.all([publish(), publish()]);

  assert.equal(first.published + second.published, 1);
  assert.equal(first.skipped + second.skipped, 1);
  assert.equal(upserts, 1);
  assert.equal(objectPaths.length, 3);
  assert.equal(new Set(objectPaths).size, 3);
});

test('a failed Agent 8 receipt permits retry without creating new asset object names', async () => {
  const fixture = await approvedFixture();
  const objectPaths: string[] = [];
  let failUpsert = true;
  let successfulUpserts = 0;
  const client: WebsiteCmsClient = {
    async uploadAsset(input) {
      objectPaths.push(input.objectPath);
      return `https://projectrefalpha.supabase.co/storage/v1/object/public/creddy-blog-assets/${input.objectPath}`;
    },
    async upsertArticle() {
      if (failUpsert) throw new Error('temporary database outage');
      successfulUpserts += 1;
    },
  };
  const first = await publishReadyWebsiteExportsToCms(fixture.root, [fixture.exportPath], {
    allowCmsPublish: true,
    client,
  });
  assert.equal(first.failures.length, 1);
  failUpsert = false;
  const second = await publishReadyWebsiteExportsToCms(fixture.root, [fixture.exportPath], {
    allowCmsPublish: true,
    client,
  });

  assert.equal(second.published, 1);
  assert.equal(successfulUpserts, 1);
  assert.equal(objectPaths.length, 6);
  assert.equal(new Set(objectPaths).size, 3);
});

test('scheduled Agent 8 CMS publishing can explicitly republish existing approved receipts', async () => {
  const fixture = await approvedFixture();
  let uploads = 0;
  const client: WebsiteCmsClient = {
    async uploadAsset(input) {
      uploads += 1;
      return `https://ibcwjcoswrxiebmospxc.supabase.co/storage/v1/object/public/creddy-blog-assets/${input.objectPath}`;
    },
    async upsertArticle() {},
  };
  await publishReadyWebsiteExportsToCms(fixture.root, [fixture.exportPath], {
    allowCmsPublish: true,
    client,
  });
  const repeated = await publishReadyWebsiteExportsToCms(fixture.root, [fixture.exportPath], {
    allowCmsPublish: true,
    client,
    forceRepublish: true,
  });

  assert.equal(repeated.published, 1);
  assert.equal(repeated.skipped, 0);
  assert.equal(uploads, 6);
});

test('CMS republish preserves the first publication timestamp', async () => {
  const fixture = await approvedFixture();
  let row: CreddyBlogCmsRow | undefined;
  const firstPublishedAt = '2026-08-20T10:00:00.000Z';
  const client: WebsiteCmsClient = {
    async uploadAsset(input) {
      return `https://projectrefalpha.supabase.co/storage/v1/object/public/creddy-blog-assets/${input.objectPath}`;
    },
    async getPublishedAt() { return firstPublishedAt; },
    async upsertArticle(value) { row = value; },
  };
  const result = await publishApprovedWebsiteExportToCms(fixture.root, fixture.exportPath, {
    allowCmsPublish: true,
    client,
    now: new Date('2026-09-01T10:00:00.000Z'),
  });

  assert.equal(row?.published_at, firstPublishedAt);
  assert.equal(result.publishedAt, firstPublishedAt);
});
