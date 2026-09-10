import assert from 'node:assert/strict';
import test from 'node:test';
import { assertStorySpecificBlogCover, hasGenericBlogCover, hasGenericArchiveBlogCover } from './blog-cover-policy.js';
import type { CreddyArticleVisualPlan } from './pipeline-types.js';

function plan(overrides: Record<string, unknown> = {}): CreddyArticleVisualPlan {
  return { version: 'creddy-article-visuals-v1', designVersion: 'creddy-guides-v1', assets: [{
    id: 'hero', usage: 'hero', articleBlockId: 'hero-block', assetType: 'editorial_illustration',
    generationMode: 'compose', aspectRatio: '16:9', altText: 'Travel illustration',
    caption: 'Editorial illustration.', claimFields: [], provenance: 'Local compositor',
    brandAssetIds: [], ...overrides,
  }] } as CreddyArticleVisualPlan;
}

test('generic blog hero is rejected even with a prepopulated path or missing brand IDs', () => {
  for (const overrides of [{}, { brandAssetIds: undefined }, { assetPath: '/tmp/old-globe.png' }]) {
    assert.equal(hasGenericBlogCover(plan(overrides)), true);
    assert.throws(() => assertStorySpecificBlogCover(plan(overrides)), /Visual task remains pending/);
  }
});

test('old archive generic plans are blocked while reviewed photo plans and News remain valid', () => {
  const item = { kind: 'blog', brands: [], images: [{ provenance: 'Original Creddy flat editorial illustration; no third-party brand imagery.' }] };
  assert.equal(hasGenericArchiveBlogCover(item), true);
  assert.equal(hasGenericArchiveBlogCover({ ...item, brands: ['unrelated'], images: [{ ...item.images[0]!, usage: 'hero' }] }), true);
  assert.equal(hasGenericArchiveBlogCover({ ...item, kind: 'news' }), false);
  assert.equal(hasGenericArchiveBlogCover({ ...item, images: [{ photoAssetId: 'reviewed-photo', provenance: 'Pexels' }] }), false);
  assert.equal(hasGenericArchiveBlogCover({ ...item, brands: ['approved-brand'], images: [{ provenance: 'Approved brand composition' }] }), false);
  assert.equal(hasGenericArchiveBlogCover({ ...item, brands: ['approved-brand'], images: [
    { usage: 'hero', provenance: 'Approved brand composition' },
    { ...item.images[0]!, usage: 'inline' },
  ] }), false);
});

test('photo, brand art, deliberate generated/supplied art and non-hero compositions are unchanged', () => {
  for (const overrides of [
    { photoAssetId: 'reviewed-photo' }, { brandAssetIds: ['official-card'] },
    { generationMode: 'generate' }, { generationMode: 'supply' },
    { usage: 'inline' }, { usage: 'comparison' },
  ]) assert.doesNotThrow(() => assertStorySpecificBlogCover(plan(overrides)));
  assert.equal(hasGenericBlogCover(undefined), false);
});
