import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import sharp from 'sharp';
import { importPexelsPhoto, pexelsPhotoId, searchPexelsPhotos } from './pexels-photos.js';
import { composeEditorialPhoto, resolveEditorialPhoto } from './editorial-photos.js';

async function fixture() {
  const bytes = await sharp({ create: { width: 1600, height: 1600, channels: 3, background: '#235777' } }).jpeg().toBuffer();
  const photo = { id: 12345, width: 1600, height: 1600, url: 'https://www.pexels.com/photo/travel-scene-12345/',
    photographer: 'Fixture photographer', photographer_url: 'https://www.pexels.com/@fixture/',
    src: { original: 'https://images.pexels.com/photos/12345/pexels-photo-12345.jpeg' }, alt: 'Illustrative travel scene' };
  const selection = { storyId: 'photo-fixture', sourcePageUrl: photo.url, subject: 'Illustrative travel scene',
    usageNotes: 'General travel illustration, not a named property or endorsement.', focalPoint: { x: 0.5, y: 0.2 } };
  const fetcher = (async (url, init) => {
    assert.equal(init?.redirect, 'error');
    assert.ok(init?.signal);
    if (String(url).startsWith('https://api.pexels.com/')) {
      assert.deepEqual(init?.headers, { Authorization: 'fixture-key' });
      return Response.json(String(url).includes('/search?') ? { photos: [photo] } : photo);
    }
    assert.equal(init?.headers, undefined);
    return new Response(bytes);
  }) as typeof fetch;
  return { bytes, photo, selection, fetcher };
}

test('Pexels search is bounded, explicit, and does not download photos', async () => {
  const x = await fixture();
  const result = await searchPexelsPhotos('travelers airport', 'fixture-key', x.fetcher);
  assert.equal(result.candidates.length, 1);
  assert.equal(result.candidates[0].id, 12345);
  assert.equal(result.providerUrl, 'https://www.pexels.com');
  assert.ok(!JSON.stringify(result).includes('fixture-key'));
  const many = await searchPexelsPhotos('travel', 'fixture-key', (async (url) => {
    assert.equal(new URL(String(url)).searchParams.get('per_page'), '6');
    return Response.json({ photos: Array(10).fill(x.photo) });
  }) as typeof fetch);
  assert.equal(many.candidates.length, 6);
  await assert.rejects(searchPexelsPhotos('', 'fixture-key', x.fetcher));
});

test('Pexels imports authoritative credit and immutable reviewed focal point', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pexels-test-'));
  const x = await fixture();
  const imported = await importPexelsPhoto(root, x.selection, 'fixture-key', x.fetcher);
  assert.equal(imported.photoCredit.license, 'Pexels');
  assert.equal(imported.photoCredit.creator, x.photo.photographer);
  const receipt = JSON.parse(await readFile(imported.receiptPath, 'utf8'));
  assert.equal(receipt.version, 2);
  assert.deepEqual(receipt.entry.focalPoint, { x: 0.5, y: 0.2 });
  assert.ok(!JSON.stringify(receipt).includes('fixture-key'));
  assert.deepEqual(await importPexelsPhoto(root, x.selection, 'fixture-key', x.fetcher), imported);
  const rendered = await composeEditorialPhoto({ root, photoId: imported.photoAssetId, usage: 'hero' });
  assert.equal((await sharp(rendered.assetPath).metadata()).width, 1600);
  const alternate = await importPexelsPhoto(root, { ...x.selection, focalPoint: { x: 0.5, y: 0.8 } }, 'fixture-key', x.fetcher);
  assert.notEqual(imported.photoAssetId, alternate.photoAssetId);
  assert.notEqual(rendered.fingerprint, (await composeEditorialPhoto({ root, photoId: alternate.photoAssetId, usage: 'hero' })).fingerprint);
  receipt.entry.focalPoint.y = 0.8;
  await writeFile(imported.receiptPath, JSON.stringify(receipt));
  await assert.rejects(resolveEditorialPhoto(imported.photoAssetId, undefined, root), /integrity/);
});

test('Pexels rejects unsafe URLs, wrong identity, unknown source and invalid dimensions', async () => {
  for (const url of ['http://www.pexels.com/photo/test-12345/', 'https://evil.test/photo/test-12345/',
    'https://user:pass@www.pexels.com/photo/test-12345/', 'https://www.pexels.com/search/travel/',
    'https://www.pexels.com/photo/test-12345/?x=1']) assert.throws(() => pexelsPhotoId(url));
  assert.equal(pexelsPhotoId('https://www.pexels.com/photo/travel-12345/'), 12345);
  const root = await mkdtemp(join(tmpdir(), 'pexels-invalid-'));
  for (const mutate of [
    (p: any) => { p.id = 999; }, (p: any) => { p.url = 'https://www.pexels.com/photo/another-999/'; },
    (p: any) => { p.src.original = 'https://evil.test/photo.jpeg'; },
    (p: any) => { p.src.original = 'https://images.pexels.com/photos/999/photo.jpeg'; },
    (p: any) => { p.photographer = ''; }, (p: any) => { p.photographer_url = 'https://evil.test/@user'; },
    (p: any) => { p.width = 800; }, (p: any) => { p.height = 999999; },
  ]) {
    const x = await fixture(); mutate(x.photo);
    await assert.rejects(importPexelsPhoto(root, x.selection, 'fixture-key', x.fetcher), /metadata/);
  }
  const x = await fixture();
  for (const value of [-0.1, 1.1, NaN, Infinity]) {
    await assert.rejects(importPexelsPhoto(root, { ...x.selection, focalPoint: { x: value, y: 0.5 } }, 'fixture-key', x.fetcher), /focal/);
  }
});

test('Pexels failures never expose provider payloads, key, or transport errors', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pexels-errors-'));
  const x = await fixture();
  await assert.rejects(importPexelsPhoto(root, x.selection, '', x.fetcher), /not configured/);
  for (const response of [new Response('fixture-key', { status: 429 }), new Response('fixture-key'),
    new Response(null, { status: 302 }), new Response('{}', { headers: { 'content-length': String(2 * 1024 * 1024) } })]) {
    await assert.rejects(importPexelsPhoto(root, x.selection, 'fixture-key', (async () => response) as typeof fetch),
      error => error instanceof Error && error.message === 'Pexels API request failed; check configuration or retry later');
  }
  await assert.rejects(importPexelsPhoto(root, x.selection, 'fixture-key', (async () => { throw new Error('fixture-key'); }) as typeof fetch), /API request failed/);
  for (const response of [new Response('bad bytes'), new Response(null, { status: 302 }),
    new Response(x.bytes, { headers: { 'content-length': String(21 * 1024 * 1024) } })]) {
    await assert.rejects(importPexelsPhoto(root, x.selection, 'fixture-key', (async url =>
      String(url).includes('api.pexels.com') ? Response.json(x.photo) : response) as typeof fetch));
  }
});

test('Pexels rejects EXIF rotation that leaves insufficient horizontal crop detail', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pexels-exif-'));
  const x = await fixture();
  const bytes = await sharp({ create: { width: 1600, height: 900, channels: 3, background: '#123456' } })
    .withMetadata({ orientation: 6 }).jpeg().toBuffer();
  x.photo.height = 900;
  await assert.rejects(importPexelsPhoto(root, x.selection, 'fixture-key', (async url =>
    String(url).includes('api.pexels.com') ? Response.json(x.photo) : new Response(bytes)) as typeof fetch), /crop validation/);
});
