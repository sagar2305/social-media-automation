import assert from 'node:assert/strict';
import test from 'node:test';
import type { CreddyBlogCmsRow } from '../creddy/website-cms-stage.js';
import { matchingNewsBlog, newsPhotoFromBlog, prepareNewsPhotoImage } from './news-photo-image.js';
const url = 'https://exampleproject.supabase.co';
function blog(): CreddyBlogCmsRow {
  return { publish_state: 'published', content_bank_id: 'article-production-ranking-story1',
    content: { article: { heroVisualId: 'hero', sourceUrls: ['https://example.com/story/'] },
      visuals: { assets: [{ id: 'hero', usage: 'hero', assetType: 'licensed_photo', aspectRatio: '16:9',
        assetPath: `${url}/storage/v1/object/public/creddy-blog-assets/blogs/story/hero.webp`,
        photoAssetId: 'reviewed-photo', provenance: 'Photographer. Pexels. Illustrative photograph.',
        photoCredit: { creator: 'Photographer', license: 'Pexels', licenseUrl: 'https://www.pexels.com/license/',
          sourceUrl: 'https://www.pexels.com/photo/12345/', modifications: 'Cropped to 16:9.' } }] } },
  } as CreddyBlogCmsRow;
}
test('News shares the exact reviewed hosted photo while retaining full provenance', () => {
  const b = blog();
  assert.deepEqual(newsPhotoFromBlog(b, url), { url: b.content.visuals.assets[0]!.assetPath,
    rights: 'licensed', attribution: b.content.visuals.assets[0]!.provenance });
});
test('story matching supports old/new banks and normalized source identity, never keyword guesses', () => {
  const b = blog();
  assert.equal(matchingNewsBlog([b], { canonicalId: 'story1' }), b);
  b.content_bank_id = 'slideshow-visual-copy-ranking-story1';
  assert.equal(matchingNewsBlog([b], { canonicalId: 'story1' }), b);
  assert.equal(matchingNewsBlog([b], { sourceUrl: 'https://example.com/story?utm_source=test#x' }), b);
  assert.equal(matchingNewsBlog([b], { canonicalId: 'story' }), undefined);
  assert.equal(matchingNewsBlog([b, structuredClone(b)], { canonicalId: 'story1' }), undefined);
});
test('withholds attribution-required photos, logos, malformed credits, off-project assets and unpublished blogs', () => {
  const edits = [
    (b: CreddyBlogCmsRow) => { b.content.visuals.assets[0]!.photoCredit!.license = 'CC-BY-4.0'; b.content.visuals.assets[0]!.photoCredit!.licenseUrl = 'https://creativecommons.org/licenses/by/4.0/'; },
    (b: CreddyBlogCmsRow) => { b.content.visuals.assets[0]!.assetType = 'editorial_illustration'; },
    (b: CreddyBlogCmsRow) => { b.content.visuals.assets[0]!.photoCredit!.creator = ''; },
    (b: CreddyBlogCmsRow) => { b.content.visuals.assets[0]!.assetPath = 'https://other.example/image.webp'; },
    (b: CreddyBlogCmsRow) => { b.content.article.heroVisualId = 'other'; },
  ];
  for (const edit of edits) { const b = blog(); edit(b); assert.equal(newsPhotoFromBlog(b, url), undefined); }
});
test('no story identity leaves imagery pending without contacting a provider', async () => {
  assert.equal(await prepareNewsPhotoImage('/tmp', 'Hilton Marriott Chase', {}), undefined);
});
