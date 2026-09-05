import assert from 'node:assert/strict';
import test from 'node:test';

import { NewsService, type NewsImageReplacement } from '../../shared/creddy-news/creddy-news-service.js';

const image: NewsImageReplacement = {
  url: 'https://assets.example.com/news/brand.webp', rights: 'editorial_reference',
  attribution: 'Official brand mark used for editorial identification.',
};

test('News image refresh calls the image-only RPC with expected revision and provenance', async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const service = new NewsService('https://cms.example.com', 'test-key', async (input, init) => {
    calls.push({ url: String(input), init });
    return new Response(JSON.stringify({ id: 'news-1', revision: 8 }), { status: 200 });
  });
  assert.equal((await service.setImage('news-1', 7, image, 'approved-image-refresh')).revision, 8);
  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, 'https://cms.example.com/rest/v1/rpc/creddy_news_set_image');
  assert.equal(calls[0]!.init!.method, 'POST');
  assert.deepEqual(JSON.parse(String(calls[0]!.init!.body)), {
    p_id: 'news-1', p_revision: 7, p_image_url: image.url, p_image_provenance: image, p_actor: 'approved-image-refresh',
  });
});

test('News image refresh refuses unsafe inputs before any request', async () => {
  const service = new NewsService('https://cms.example.com', 'test-key', async () => { throw new Error('must not request'); });
  for (const url of ['http://assets.example.com/a.webp', 'https://assets.example.com/a.webp?token=secret', 'https://127.0.0.1/a.webp']) {
    await assert.rejects(service.setImage('news-1', 7, { ...image, url }, 'image-refresh'), /approved public image/);
  }
  await assert.rejects(service.setImage('news-1', 0, image, 'image-refresh'), /identity/);
  await assert.rejects(service.setImage('news-1', 7, { ...image, attribution: '' }, 'image-refresh'), /approved public image/);
});

test('News stale image writes surface a sanitized reload error', async () => {
  const service = new NewsService('https://cms.example.com', 'test-key', async () => new Response('private database error', { status: 400 }));
  await assert.rejects(service.setImage('news-1', 7, image, 'image-refresh'), /Reload and try again/);
});
