import assert from 'node:assert/strict';
import test from 'node:test';
import { editorialImageObjectPath, prepareNewsBrandImage } from './editorial-image-delivery.js';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('new uploads retain the live website CMS Storage path allowlist', () => {
  const bytes = Buffer.from('immutable-image-bytes');
  const path = editorialImageObjectPath('Flying Blue / Hero', bytes);
  const publicUrl = `https://project.supabase.co/storage/v1/object/public/creddy-blog-assets/${path}`;
  assert.ok(new URL(publicUrl).pathname.startsWith('/storage/v1/object/public/creddy-blog-assets/blogs/'));
  assert.match(path, /^blogs\/editorial-v1\/[a-z0-9-]+-[a-f0-9]{64}\.webp$/);
  assert.equal(editorialImageObjectPath('Flying Blue / Hero', bytes), path);
  assert.notEqual(editorialImageObjectPath('Flying Blue / Hero', Buffer.from('new-image')), path);
  assert.ok(!editorialImageObjectPath('../../secret?token=hidden', bytes).includes('..'));
});

test('unmatched News uses an owned neutral illustration, not an invented brand asset', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-news-neutral-'));
  let uploads = 0;
  const image = await prepareNewsBrandImage(root, 'Plan your next rewards trip', {}, async (_path, label) => {
    uploads++;
    assert.equal(label, 'creddy-neutral-editorial');
    return 'https://example.com/owned.webp';
  });
  assert.equal(uploads, 1);
  assert.ok(image);
  assert.equal(image.rights, 'owned');
  assert.match(image.attribution, /Original Creddy flat editorial illustration; no third-party brand imagery/);
});
