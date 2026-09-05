import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import { renderBrandVisual, type ApprovedBrandVisualAsset } from './brand-visuals.js';

test('brand compositor produces a deterministic valid 16:9 PNG with untouched brand color and provenance', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-brand-visual-'));
  const assetPath = join(root, 'approved.png');
  await sharp({ create: { width: 400, height: 120, channels: 4, background: '#d40033' } }).png().toFile(assetPath);
  const brand: ApprovedBrandVisualAsset = { id: 'fixture', label: 'Approved fixture', assetPath, sourceUrl: 'https://example.com/brand', provenance: 'Approved test fixture' };
  const outputPath = join(root, 'hero.png');
  const result = await renderBrandVisual({ brands: [brand], title: 'Travel rewards', usage: 'hero', outputPath });
  const bytes = await readFile(outputPath);
  const metadata = await sharp(bytes).metadata();
  assert.equal(metadata.format, 'png');
  assert.equal(metadata.width, 1600);
  assert.equal(metadata.height, 900);
  assert.ok(bytes.length >= 10_000 && bytes.length <= 20 * 1024 * 1024);
  const center = await sharp(bytes).extract({ left: 800, top: 430, width: 1, height: 1 }).removeAlpha().raw().toBuffer();
  assert.deepEqual([...center], [212, 0, 51]);
  assert.deepEqual(result.provenance, [brand]);
  assert.match(result.altText, /Approved fixture/);
  await renderBrandVisual({ brands: [brand], title: 'Travel rewards', usage: 'hero', outputPath: join(root, 'repeat.png') });
  assert.deepEqual(await readFile(join(root, 'repeat.png')), bytes);
  for (const usage of ['inline', 'comparison'] as const) {
    const variant = join(root, `${usage}.png`);
    await renderBrandVisual({ brands: [brand], title: 'Travel rewards', usage, outputPath: variant });
    assert.notDeepEqual(await readFile(variant), bytes);
  }
});

test('unmatched brands get a real restrained editorial fallback without invented brand attribution', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-brand-fallback-'));
  for (const title of ['Travel rewards', 'Hotel stays', 'Credit card rewards']) {
    const outputPath = join(root, `${title}.png`);
    const result = await renderBrandVisual({ brands: [], title, usage: 'inline', outputPath });
    assert.deepEqual(result.provenance, []);
    assert.doesNotMatch(result.altText, /logo|official/i);
    const bytes = await readFile(outputPath);
    assert.ok(bytes.length >= 10_000);
    assert.equal((await sharp(bytes).metadata()).width, 1600);
  }
});

test('rejects executable/vector inputs and low resolution brand assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-brand-invalid-'));
  const assetPath = join(root, 'untrusted.svg');
  await writeFile(assetPath, '<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200"/></svg>');
  const brand: ApprovedBrandVisualAsset = { id: 'fixture', label: 'Fixture', assetPath, sourceUrl: 'https://example.com', provenance: 'Test fixture' };
  await assert.rejects(renderBrandVisual({ brands: [brand], title: '', usage: 'hero', outputPath: join(root, 'hero.png') }), /static PNG/);
  brand.assetPath = join(root, 'tiny.png');
  await sharp({ create: { width: 16, height: 16, channels: 4, background: 'red' } }).png().toFile(brand.assetPath);
  await assert.rejects(renderBrandVisual({ brands: [brand], title: '', usage: 'hero', outputPath: join(root, 'hero.png') }), /too small/);
  brand.assetPath = join(root, 'white.png');
  await sharp({ create: { width: 400, height: 120, channels: 4, background: 'white' } }).png().toFile(brand.assetPath);
  await assert.rejects(renderBrandVisual({ brands: [brand], title: '', usage: 'hero', outputPath: join(root, 'hero.png') }), /insufficient contrast/);
});
