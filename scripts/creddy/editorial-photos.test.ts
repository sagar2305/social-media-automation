import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { composeEditorialPhoto, editorialPhotoRegistry, resolveEditorialPhoto, validatePhotoCredit } from './editorial-photos.js';
import { editorialBrandRegistry, matchEditorialBrands, resolveEditorialBrands } from './brand-asset-registry.js';
import { publishedBlogCoverContext } from './blog-cover-context.js';
import { canonicalPhotoSource, importOnlinePhoto } from './online-photo-selection.js';

async function onlineFixture() {
  const { bytes } = await resolveEditorialPhoto('tokyo-skyline');
  const dimensions = await sharp(bytes).metadata();
  const info = { url: 'https://upload.wikimedia.org/wikipedia/commons/1/12/Fixture.jpg',
    mime: 'image/jpeg', width: dimensions.width, height: dimensions.height, size: bytes.length,
    sha1: createHash('sha1').update(bytes).digest('hex'), extmetadata: {
      LicenseShortName: { value: 'CC0' }, LicenseUrl: { value: 'http://creativecommons.org/publicdomain/zero/1.0/deed.en' },
      Artist: { value: '<a href="https://example.com">Fixture Photographer</a>' },
    } };
  const selection = { storyId: 'fixture-story', sourcePageUrl: 'https://commons.wikimedia.org/wiki/File:Fixture.jpg',
    subject: 'Fixture city view', usageNotes: 'Illustrative fixture, not an airline route claim.' };
  const fetcher = (async (url, init) => {
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    assert.equal(init?.headers, undefined, 'no credentials sent to photo provider');
    return String(url).includes('/w/api.php') ? Response.json({ query: { pages: { 1: { imageinfo: [info] } } } }) : new Response(bytes);
  }) as typeof fetch;
  return { bytes, info, selection, fetcher };
}

test('online photo selection imports one immutable choice without changing the library', async () => {
  const root = await mkdtemp(join(tmpdir(), 'online-photo-'));
  const fixture = await onlineFixture();
  const before = await editorialPhotoRegistry();
  const imported = await importOnlinePhoto(root, fixture.selection, fixture.fetcher);
  assert.match(imported.photoAssetId, /^online-[a-f0-9]{64}$/);
  assert.equal(imported.photoCredit.creator, 'Fixture Photographer');
  assert.deepEqual(await importOnlinePhoto(root, fixture.selection, fixture.fetcher), imported);
  assert.deepEqual(await editorialPhotoRegistry(), before);
  assert.ok((await resolveEditorialPhoto(imported.photoAssetId, undefined, root)).bytes.equals(fixture.bytes));
  const composed = await composeEditorialPhoto({ root, photoId: imported.photoAssetId, usage: 'hero' });
  assert.equal((await sharp(composed.assetPath).metadata()).width, 1600);
  const receipt = JSON.parse(await readFile(imported.receiptPath, 'utf8'));
  receipt.entry.focalPoint.x = 0.1;
  await writeFile(imported.receiptPath, JSON.stringify(receipt));
  await assert.rejects(resolveEditorialPhoto(imported.photoAssetId, undefined, root), /integrity/);
  receipt.entry.focalPoint.x = 0.5;
  receipt.entry.subject = 'Changed subject';
  await writeFile(imported.receiptPath, JSON.stringify(receipt));
  await assert.rejects(resolveEditorialPhoto(imported.photoAssetId, undefined, root), /integrity/);
});

test('online import accepts Commons license URLs with or without a trailing slash', async () => {
  const root = await mkdtemp(join(tmpdir(), 'online-photo-license-'));
  for (const suffix of ['', '/', '/deed.en']) {
    const fixture = await onlineFixture();
    fixture.info.extmetadata.LicenseShortName.value = 'CC BY 4.0';
    fixture.info.extmetadata.LicenseUrl.value = `https://creativecommons.org/licenses/by/4.0${suffix}`;
    const imported = await importOnlinePhoto(root, fixture.selection, fixture.fetcher);
    assert.equal(imported.photoCredit.license, 'CC-BY-4.0');
  }
});

test('online selection rejects unsafe hosts, unknown rights and changed source bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'online-photo-fail-'));
  for (const url of ['http://commons.wikimedia.org/wiki/File:Photo.jpg', 'https://evil.test/wiki/File:Photo.jpg',
    'https://user:pass@commons.wikimedia.org/wiki/File:Photo.jpg', 'https://commons.wikimedia.org/wiki/Category:Photos']) {
    assert.throws(() => canonicalPhotoSource(url));
  }
  assert.equal(canonicalPhotoSource('https://commons.wikimedia.org/wiki/File:Photo_name.jpg?width=100#details'),
    canonicalPhotoSource('https://commons.wikimedia.org/wiki/File:Photo%20name.jpg'));
  for (const mutate of [
    (x: any) => { x.extmetadata.LicenseShortName.value = 'All rights reserved'; },
    (x: any) => { x.extmetadata.LicenseUrl.value = 'https://evil.test/license'; },
    (x: any) => { x.url = 'http://127.0.0.1/private'; },
    (x: any) => { x.size = 30 * 1024 * 1024; },
    (x: any) => { x.sha1 = 'wrong'; },
    (x: any) => { x.extmetadata.Artist.value = ''; },
    (x: any) => { x.mime = 'image/svg+xml'; },
  ]) {
    const fixture = await onlineFixture(); mutate(fixture.info);
    await assert.rejects(importOnlinePhoto(root, fixture.selection, fixture.fetcher));
  }
});

test('online import rejects failed downloads and does not bypass altered cached bytes', async () => {
  const root = await mkdtemp(join(tmpdir(), 'online-photo-bytes-'));
  const fixture = await onlineFixture();
  await assert.rejects(importOnlinePhoto(root, fixture.selection, (async () => new Response(null, { status: 302 })) as typeof fetch));
  const imported = await importOnlinePhoto(root, fixture.selection, fixture.fetcher);
  await writeFile(imported.assetPath, 'changed');
  await assert.rejects(resolveEditorialPhoto(imported.photoAssetId, undefined, root), /integrity/);
});

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
        { id: 'inline', photoAssetId: 'wrong' }, { id: 'hero', photoAssetId: 'tokyo', altText: 'Tokyo skyline', assetPath: '/private/file',
          photoCredit: { sourceUrl: 'https://commons.wikimedia.org/wiki/File:Tokyo.jpg' } }] })));
  }) as typeof fetch);
  assert.equal(result.status, 'available');
  assert.equal(result.covers.length, 20);
  assert.deepEqual(result.covers[0], { slug: 'story-0', publishedAt: '2026-09-06T00:00:00Z', photoAssetId: 'tokyo', subject: 'Tokyo skyline', sourceUrl: 'https://commons.wikimedia.org/wiki/File:Tokyo.jpg' });
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
