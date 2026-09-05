import assert from 'node:assert/strict';
import test from 'node:test';
import { editorialImageObjectPath } from './editorial-image-delivery.js';

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
