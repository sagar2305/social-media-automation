import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createClient } from '@supabase/supabase-js';

import { CREDDY_ARTICLE_IMAGE_BLOCK, CREDDY_ARTICLE_THEME } from './article-content.js';
import { refreshPublishedBlogImages, replaceBlogVisuals, validatePhotoRefreshPreview, type BlogVisualReplacement } from './blog-image-refresh.js';
import type { CreddyBlogCmsRow } from './website-cms-stage.js';
import type { WebsiteRegistryPayload } from './website-sync-stage.js';
import { composeEditorialPhoto, resolveEditorialPhoto } from './editorial-photos.js';

const replacements: BlogVisualReplacement[] = ['hero', 'detail', 'summary'].map((id) => ({
  id, assetPath: `https://assets.example.com/blogs/new-${id}.webp`,
  altText: `Authentic brand composition for ${id}`, caption: `Brand editorial image: ${id}.`,
  provenance: 'Official brand asset, composed without altering the supplied logo.',
}));

function fixture(): CreddyBlogCmsRow {
  const date = '2026-08-21T08:00:00.000Z';
  const content: WebsiteRegistryPayload = {
    version: 'creddy-website-export-v2', contentBankId: 'bank-1', approvedBy: 'reviewer', approvedAt: date,
    route: '/blog/test-article', publishState: 'ready_for_getcreddy_integration', referrals: [],
    design: { version: 'creddy-guides-v1', tokens: CREDDY_ARTICLE_THEME, articleImageBlock: CREDDY_ARTICLE_IMAGE_BLOCK },
    article: {
      version: 'creddy-article-v1', designVersion: 'creddy-guides-v1', id: 'article-1', slug: 'test-article',
      category: 'guides', title: 'Original title', dek: 'Original dek', excerpt: 'Original excerpt',
      seoTitle: 'Original SEO title', seoDescription: 'Original SEO description', authorName: 'Creddy Editorial',
      createdAt: date, updatedAt: date, readingMinutes: 3, heroVisualId: 'hero',
      sourceUrls: ['https://example.com/source'], referralDisclosure: 'Original disclosure',
      blocks: [
        { id: 'copy', type: 'paragraph', text: 'Preserve every original article word.', claimFields: ['terms'] },
        { id: 'comparison', type: 'comparison_table', caption: 'Preserve this non-image caption.', columns: ['Value'], rows: [['Original']], claimFields: [] },
        ...['hero', 'detail', 'summary'].map((id) => ({ id: `${id}-block`, type: 'visual' as const, visualId: id, caption: `Old ${id}` })),
      ],
    },
    visuals: {
      version: 'creddy-article-visuals-v1', designVersion: 'creddy-guides-v1', imageBlockStyle: 'creddy-abstract-editorial-v1',
      assets: ['hero', 'detail', 'summary'].map((id) => ({
        id, usage: id === 'hero' ? 'hero' as const : 'inline' as const, articleBlockId: `${id}-block`,
        assetType: 'editorial_illustration', aspectRatio: '16:9', generationMode: 'generate',
        altText: `Old ${id}`, caption: `Old ${id}`, claimFields: [], assetPath: `https://assets.example.com/old-${id}.png`,
      })),
    },
  };
  return {
    slug: content.article.slug, content_bank_id: 'bank-1', content, title: content.article.title,
    excerpt: content.article.excerpt, category: 'guides', publish_state: 'published', approved_by: 'reviewer',
    approved_at: date, content_sha256: createHash('sha256').update(JSON.stringify(content)).digest('hex'),
    published_at: date, source_updated_at: date,
  };
}

function fakeCms(initial: CreddyBlogCmsRow, options: { race?: boolean; failure?: boolean; hidden?: boolean } = {}) {
  let row = structuredClone(initial);
  const writes: Array<{ url: URL; body: Record<string, unknown> }> = [];
  const client = createClient('https://cms.example.com', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: {
      fetch: async (input, init) => {
        const url = new URL(String(input));
        if (init?.method === 'PATCH') {
          const body = JSON.parse(String(init.body));
          writes.push({ url, body });
          if (options.failure) return new Response(JSON.stringify({ message: 'Sensitive backend error must not escape' }), { status: 500 });
          if (options.race) return new Response('[]', { headers: { 'Content-Type': 'application/json' } });
          row = { ...row, ...body };
          return new Response(JSON.stringify([{ slug: row.slug, content_sha256: row.content_sha256 }]), { headers: { 'Content-Type': 'application/json' } });
        }
        assert.equal(url.searchParams.get('slug'), 'eq.test-article');
        assert.equal(url.searchParams.get('publish_state'), 'eq.published');
        return new Response(JSON.stringify(options.hidden ? [] : [row]), { headers: { 'Content-Type': 'application/json' } });
      },
    },
  });
  return { client, writes, row: () => row };
}

test('visual replacement preserves every non-image field and does not mutate its input', () => {
  const original = fixture().content;
  const snapshot = structuredClone(original);
  const updated = replaceBlogVisuals(original, replacements);
  const restored = structuredClone(updated);
  restored.visuals.assets = structuredClone(original.visuals.assets);
  restored.article.blocks = restored.article.blocks.map((block, index) => block.type === 'visual' ? original.article.blocks[index]! : block);
  assert.deepEqual(restored, original);
  assert.deepEqual(original, snapshot);
  for (const asset of updated.visuals.assets) assert.equal(asset.assetPath, replacements.find((item) => item.id === asset.id)!.assetPath);
  assert.deepEqual(replaceBlogVisuals(updated, replacements), updated);
});

test('replacement rejects incomplete IDs, duplicates and unsafe asset URLs', () => {
  const content = fixture().content;
  assert.throws(() => replaceBlogVisuals(content, replacements.slice(1)), /exactly three/);
  assert.throws(() => replaceBlogVisuals(content, [replacements[0]!, replacements[0]!, replacements[2]!]), /each existing/);
  for (const assetPath of ['http://example.com/a.png', 'https://user:password@example.com/a.png', 'https://example.com/a.png?token=secret']) {
    assert.throws(() => replaceBlogVisuals(content, replacements.map((item) => ({ ...item, assetPath }))), /public HTTPS/);
  }
});

test('reviewed photo refresh changes only the rendered hero and its caption', async () => {
  const original = fixture();
  const { entry } = await resolveEditorialPhoto('marriott-st-kitts');
  const photo = { ...replacements[0]!, photoAssetId: entry.id, photoCredit: entry.credit };
  const updated = replaceBlogVisuals(original.content, [photo]);
  assert.deepEqual(updated.visuals.assets.slice(1), original.content.visuals.assets.slice(1));
  assert.deepEqual(updated.article.blocks.filter(block => block.id !== 'hero-block'), original.content.article.blocks.filter(block => block.id !== 'hero-block'));
  assert.equal(updated.visuals.assets[0]!.assetType, 'licensed_photo');
  assert.equal(updated.visuals.assets[0]!.brandAssetIds, undefined);
  assert.deepEqual(updated.visuals.assets[0]!.photoCredit, entry.credit);
  const cms = fakeCms(original);
  const root = await mkdtemp(join(tmpdir(), 'photo-refresh-test-'));
  const result = await refreshPublishedBlogImages({ client: cms.client, slug: original.slug, expectedHash: original.content_sha256, replacements: [photo], root });
  assert.equal(result.status, 'updated');
  assert.equal(cms.row().published_at, original.published_at);
  assert.equal(cms.row().approved_at, original.approved_at);
  assert.equal(cms.row().content.article.updatedAt, original.content.article.updatedAt);
  assert.deepEqual(cms.row().content.visuals.assets.slice(1), original.content.visuals.assets.slice(1));
  const again = await refreshPublishedBlogImages({ client: cms.client, slug: original.slug, expectedHash: original.content_sha256, replacements: [photo], root });
  assert.equal(again.status, 'noop');
  assert.equal(cms.writes.length, 1);
  const illustration = replaceBlogVisuals(updated, replacements);
  assert.equal(illustration.visuals.assets[0]!.photoCredit, undefined);
  assert.equal(illustration.visuals.assets[0]!.photoAssetId, undefined);
});

test('photo refresh rejects inline, unrendered, unknown and forged-credit photos before writing', async () => {
  const original = fixture();
  const { entry } = await resolveEditorialPhoto('marriott-st-kitts');
  const photo = { ...replacements[0]!, photoAssetId: entry.id, photoCredit: entry.credit };
  assert.throws(() => replaceBlogVisuals(original.content, [{ ...photo, id: 'detail' }]), /rendered article hero/);
  assert.throws(() => replaceBlogVisuals(original.content, [photo, ...replacements.slice(1)]), /only one hero/);
  const unrendered = structuredClone(original.content);
  unrendered.article.blocks = unrendered.article.blocks.filter(block => block.id !== 'hero-block');
  assert.throws(() => replaceBlogVisuals(unrendered, [photo]), /rendered article hero/);
  const cms = fakeCms(original);
  const root = await mkdtemp(join(tmpdir(), 'photo-invalid-test-'));
  for (const replacement of [{ ...photo, photoAssetId: 'unknown' }, { ...photo, photoCredit: { ...entry.credit, creator: 'Imitation' } }]) {
    await assert.rejects(refreshPublishedBlogImages({ client: cms.client, slug: original.slug, expectedHash: original.content_sha256, replacements: [replacement], root }), /photo|Photo/);
  }
  assert.equal(cms.writes.length, 0);
});

test('photo preview revalidation rejects tampered bytes hash and metadata before upload', async () => {
  const root = await mkdtemp(join(tmpdir(), 'photo-preview-test-'));
  const photo = await composeEditorialPhoto({ root, photoId: 'marriott-st-kitts', usage: 'hero' });
  const image = { id: 'hero', path: photo.assetPath, sha256: createHash('sha256').update(await readFile(photo.assetPath)).digest('hex'),
    photoAssetId: 'marriott-st-kitts', photoCredit: photo.photoCredit, altText: photo.altText, caption: photo.caption, provenance: photo.provenanceText };
  await validatePhotoRefreshPreview(image, root);
  for (const mutation of [{ sha256: '0'.repeat(64) }, { altText: 'Different subject' }, { caption: 'Changed caption' },
    { provenance: 'Invented license' }, { photoCredit: { ...photo.photoCredit, creator: 'Imitation' } }]) {
    await assert.rejects(validatePhotoRefreshPreview({ ...image, ...mutation }, root), /registry composition/);
  }
});

test('published image refresh writes only content and hash under a three-condition CAS with a durable backup', async () => {
  const original = fixture();
  const cms = fakeCms(original);
  const root = await mkdtemp(join(tmpdir(), 'blog-refresh-test-'));
  const result = await refreshPublishedBlogImages({ client: cms.client, slug: original.slug, expectedHash: original.content_sha256, replacements, root });
  assert.equal(result.status, 'updated');
  assert.equal(cms.writes.length, 1);
  assert.deepEqual(Object.keys(cms.writes[0]!.body).sort(), ['content', 'content_sha256']);
  assert.equal(cms.writes[0]!.url.searchParams.get('slug'), `eq.${original.slug}`);
  assert.equal(cms.writes[0]!.url.searchParams.get('content_sha256'), `eq.${original.content_sha256}`);
  assert.equal(cms.writes[0]!.url.searchParams.get('publish_state'), 'eq.published');
  assert.equal(cms.row().published_at, original.published_at);
  assert.equal(cms.row().source_updated_at, original.source_updated_at);
  assert.deepEqual(JSON.parse(await readFile(result.preimagePath!, 'utf8')), original);
  assert.equal(JSON.parse(await readFile(result.manifestPath!, 'utf8')).status, 'updated');
  const again = await refreshPublishedBlogImages({ client: cms.client, slug: original.slug, expectedHash: result.contentSha256!, replacements, root });
  assert.equal(again.status, 'noop');
  assert.equal(cms.writes.length, 1);
});

test('stale hash and unpublished rows refuse writes', async () => {
  const original = fixture();
  const root = await mkdtemp(join(tmpdir(), 'blog-refresh-stale-'));
  for (const hidden of [false, true]) {
    const cms = fakeCms(original, { hidden });
    const result = await refreshPublishedBlogImages({ client: cms.client, slug: original.slug, expectedHash: '0'.repeat(64), replacements, root });
    assert.equal(result.status, 'retry');
    assert.equal(result.reason, hidden ? 'not_published' : 'content_changed');
    assert.equal(cms.writes.length, 0);
  }
});

test('concurrent publication changes and failed updates remain retryable with retained preimages', async () => {
  const original = fixture();
  const root = await mkdtemp(join(tmpdir(), 'blog-refresh-race-'));
  for (const options of [{ race: true }, { failure: true }]) {
    const cms = fakeCms(original, options);
    const result = await refreshPublishedBlogImages({ client: cms.client, slug: original.slug, expectedHash: original.content_sha256, replacements, root });
    assert.equal(result.status, 'retry');
    assert.equal(result.reason, 'race' in options ? 'content_changed' : 'update_failed');
    assert.deepEqual(cms.row(), original);
    assert.deepEqual(JSON.parse(await readFile(result.preimagePath!, 'utf8')), original);
    assert.doesNotMatch(JSON.stringify(result), /Sensitive backend/);
  }
});
