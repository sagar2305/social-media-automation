import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { composeEditorialPhoto, editorialPhotoRegistry, resolveEditorialPhoto, validatePhotoCredit } from './editorial-photos.js';
import { editorialBrandRegistry, matchEditorialBrands, resolveEditorialBrands } from './brand-asset-registry.js';
import { blogPhotoCandidateOrder, publishedBlogCoverContext } from './blog-cover-context.js';

test('published cover context reads only bounded published history and strips private metadata', async () => {
  const env = { CREDDY_SUPABASE_URL: 'https://testproject123.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only' };
  const result = await publishedBlogCoverContext(env, (async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.searchParams.get('publish_state'), 'eq.published');
    assert.equal(url.searchParams.get('limit'), '20');
    assert.equal(url.searchParams.get('order'), 'published_at.desc,slug.asc');
    assert.ok(init?.signal);
    return Response.json(Array.from({ length: 22 }, (_, i) => ({ slug: `story-${i}`,
      published_at: '2026-09-06T00:00:00Z', hero_id: 'hero', assets: [null,
        { id: 'inline', photoAssetId: 'wrong' }, { id: 'hero', photoAssetId: 'tokyo', altText: 'Tokyo skyline', assetPath: '/private/file' }] })));
  }) as typeof fetch);
  assert.equal(result.status, 'available');
  assert.equal(result.covers.length, 20);
  assert.deepEqual(result.covers[0], { slug: 'story-0', publishedAt: '2026-09-06T00:00:00Z', photoAssetId: 'tokyo', subject: 'Tokyo skyline' });
  assert.ok(!JSON.stringify(result).includes('/private/'));
});

test('published history distinguishes absent hero, empty archive and unavailable service safely', async () => {
  const env = { CREDDY_SUPABASE_URL: 'https://testproject123.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'fixture-only' };
  for (const response of [Response.json([]), Response.json([{ slug: 'no-hero', published_at: '2026-09-06', assets: [] }])]) {
    assert.equal((await publishedBlogCoverContext(env, (async () => response) as typeof fetch)).status, 'available');
  }
  const missingId = await publishedBlogCoverContext(env, (async () => Response.json([
    { slug: 'missing-id', published_at: '2026-09-06', assets: [{ photoAssetId: 'not-a-hero' }] },
  ])) as typeof fetch);
  assert.equal(missingId.covers[0]?.photoAssetId, undefined);
  for (const fetcher of [async () => Response.json({ bad: true }), async () => Response.json([null]),
    async () => new Response('private error', { status: 500 }), async () => { throw new Error('private timeout'); }]) {
    assert.deepEqual(await publishedBlogCoverContext(env, fetcher as typeof fetch), { status: 'unavailable', covers: [] });
  }
  let fetchedWithoutConfiguration = false;
  assert.deepEqual(await publishedBlogCoverContext({}, (async () => { fetchedWithoutConfiguration = true; return Response.json([]); }) as typeof fetch),
    { status: 'unavailable', covers: [] });
  assert.equal(fetchedWithoutConfiguration, false);
});

test('photo tie-break order is stable per story, input-order independent and varies across stories', () => {
  const ids = ['a', 'b', 'c', 'd', 'e', 'f'];
  const first = blogPhotoCandidateOrder('story-one', ids);
  assert.deepEqual(first, blogPhotoCandidateOrder('story-one', [...ids].reverse()));
  assert.deepEqual([...first].sort(), ids);
  assert.notDeepEqual(first, blogPhotoCandidateOrder('story-two', ids));
  assert.deepEqual(ids, ['a', 'b', 'c', 'd', 'e', 'f']);
});

test('reviewed photographs have integrity, no-cost licenses and a separate selection namespace', async () => {
  const photos = await editorialPhotoRegistry();
  for (const id of ['sfo-terminal', 'marriott-putrajaya-pool', 'paris-skyline', 'southwest-cabin', 'waikiki-beach',
    'seattle-waterfront', 'tokyo-skyline', 'new-york-skyline', 'santa-fe-hotel-room', 'taipei-hotel-lobby']) {
    assert.ok(photos.some(photo => photo.id === id), `retain diverse subject ${id}`);
  }
  for (const id of ['hilton-waikiki', 'klm-787', 'marriott-st-kitts', 'jal-singapore-2024',
    'alaska-anchorage-2020', 'delta-taoyuan-2026', 'american-heathrow-2024',
    'jetblue-boston-2025', 'southwest-bwi-2025']) {
    assert.ok(photos.some(photo => photo.id === id), `retain reviewed photo ${id}`);
  }
  const brands = await editorialBrandRegistry();
  for (const photo of photos) {
    const resolved = await resolveEditorialPhoto(photo.id);
    assert.ok(resolved.bytes.length > 100_000);
    assert.ok(!brands.some(brand => brand.id === photo.id));
    assert.ok(!matchEditorialBrands(photo.subject, brands).some(brand => brand.id === photo.id));
    await assert.rejects(resolveEditorialBrands([photo.id]), /Unknown/);
  }
  await assert.rejects(resolveEditorialPhoto('not-reviewed'), /Unknown/);
  const photo = photos[0]!;
  await assert.rejects(resolveEditorialPhoto(photo.id, Promise.resolve([{ ...photo, sha256: 'wrong' }])), /integrity/);
  await assert.rejects(resolveEditorialPhoto(photo.id, Promise.resolve([{ ...photo, file: '../secret.jpg' }])), /unsafe/);
  assert.throws(() => validatePhotoCredit({ ...photo.credit, licenseUrl: 'https://example.com/not-a-license' }), /license/);
  assert.throws(() => validatePhotoCredit({ ...photo.credit, sourceUrl: 'javascript:alert(1)' }), /HTTPS/);
});

test('photo renderer produces deterministic full-bleed heroes with complete visible-credit metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-photo-test-'));
  for (const photo of await editorialPhotoRegistry()) {
    const first = await composeEditorialPhoto({ root, photoId: photo.id, usage: 'hero' });
    const bytes = await readFile(first.assetPath);
    const metadata = await sharp(bytes).metadata();
    assert.equal(metadata.width, 1600);
    assert.equal(metadata.height, 900);
    assert.equal(first.altText, photo.subject);
    assert.ok(first.caption.length <= 220);
    assert.deepEqual(first.photoCredit, photo.credit);
    assert.match(first.provenanceText, /https:\/\/creativecommons.org\//);
    assert.equal((await composeEditorialPhoto({ root, photoId: photo.id, usage: 'hero' })).fingerprint, first.fingerprint);
    await assert.rejects(composeEditorialPhoto({ root, photoId: photo.id, usage: 'inline' }), /restricted/);
  }
});
