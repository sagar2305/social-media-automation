import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { composeEditorialPhoto, editorialPhotoRegistry, resolveEditorialPhoto, validatePhotoCredit } from './editorial-photos.js';
import { editorialBrandRegistry, matchEditorialBrands, resolveEditorialBrands } from './brand-asset-registry.js';

test('reviewed photographs have integrity, no-cost licenses and a separate selection namespace', async () => {
  const photos = await editorialPhotoRegistry();
  assert.equal(photos.length, 3);
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
