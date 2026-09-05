import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { NewsService } from '../../shared/creddy-news/creddy-news-service.js';
import type { NewsItem } from '../../shared/creddy-news/creddy-news-types.js';
import { readJson, safeDataPath, writeJsonAtomic } from '../creddy/pipeline-store.js';
import { reconcilePendingNewsImages } from './news-image-repair.js';

const env = { CREDDY_NEWS_ENABLED: 'true', CREDDY_NEWS_SLACK_CHANNEL_ID: 'CNEWS' };
const image = { url: 'https://assets.example.com/official-brand.webp', rights: 'editorial_reference' as const,
  attribution: 'Official brand mark used for editorial identification.' };

async function fixture(count = 1) {
  const root = await mkdtemp(join(tmpdir(), 'news-image-repair-'));
  const rows = new Map<string, NewsItem>();
  const writes: Array<{ id: string; revision: number }> = [];
  for (let index = 0; index < count; index++) {
    const id = `news-${index}`;
    await writeJsonAtomic(safeDataPath(root, 'reports', 'news-image-pending', `canonical-${index}.json`), {
      id: `canonical-${index}`, newsId: id, reason: 'Image unavailable', status: 'pending_image_refresh',
    });
    rows.set(id, { id, source_key: `https://example.com/${index}`, status: 'published', revision: 3,
      content: { headline: `Brand ${index}`, summary: 'Original copy', category: 'Credit cards', publisher: 'Test Publisher',
        source_url: `https://example.com/${index}`, image_url: null, published_at: 1780000000000 },
      provenance: { original: true }, validation_error: null, manually_edited: true, created_at: 'original', updated_at: 'original',
      slack_channel: 'CNEWS', slack_ts: '1.2', slack_revision: 3, slack_error: null });
  }
  const service = {
    get: async (id: string) => structuredClone(rows.get(id)!),
    setImage: async (id: string, revision: number, replacement: typeof image) => {
      const row = rows.get(id)!;
      assert.equal(row.revision, revision);
      writes.push({ id, revision });
      row.content.image_url = replacement.url; row.provenance.imageRights = replacement; row.revision++;
      return structuredClone(row);
    },
  } as unknown as NewsService;
  const notify = async (_service: NewsService, id: string) => { const row = rows.get(id)!; row.slack_revision = row.revision; };
  const record = (index = 0) => readJson<{ status: string; attempts: number; previousImage?: unknown }>(
    safeDataPath(root, 'reports', 'news-image-pending', `canonical-${index}.json`));
  return { root, rows, writes, service, notify, record };
}

test('repair isolates a failed composition and confirms the next image and notification', async () => {
  const f = await fixture(2);
  const result = await reconcilePendingNewsImages(f.root, { env, service: f.service, notify: f.notify,
    prepareImage: async (_root, title) => { if (title === 'Brand 0 Original copy') throw new Error('unavailable'); return image; } });
  assert.equal(result.attempted, 2); assert.equal(result.failed, 1); assert.equal(result.completed, 1); assert.equal(result.pending, 1);
  assert.deepEqual(f.writes, [{ id: 'news-1', revision: 3 }]);
  assert.equal((await f.record(0)).status, 'pending_image_refresh');
  assert.equal((await f.record(1)).status, 'complete');
  assert.deepEqual((await f.record(1)).previousImage, { url: null, imageRights: null, revision: 3 });
  assert.equal(f.rows.get('news-1')!.content.published_at, 1780000000000);
});

test('a notifier no-op remains pending and retry reconciles without regenerating or writing the image', async () => {
  const f = await fixture();
  let composed = 0;
  const prepareImage = async () => { composed++; return image; };
  const first = await reconcilePendingNewsImages(f.root, { env, service: f.service, prepareImage, notify: async () => {} });
  assert.equal(first.updated, 1); assert.equal(first.completed, 0); assert.equal(first.pending, 1);
  assert.equal((await f.record()).status, 'pending_image_refresh');
  const second = await reconcilePendingNewsImages(f.root, { env, service: f.service, prepareImage, notify: f.notify });
  assert.equal(second.updated, 0); assert.equal(second.completed, 1);
  assert.equal(composed, 1); assert.equal(f.writes.length, 1);
});

test('published maintenance preserves deleted, withheld and unapproved existing images', async () => {
  const f = await fixture(3);
  f.rows.get('news-0')!.status = 'deleted'; f.rows.get('news-1')!.status = 'not_published';
  f.rows.get('news-2')!.content.image_url = 'https://example.com/unreviewed.webp';
  let composed = 0;
  const result = await reconcilePendingNewsImages(f.root, { env, service: f.service, notify: f.notify,
    prepareImage: async () => { composed++; return image; } });
  assert.equal(result.completed, 0); assert.equal(result.pending, 3);
  assert.equal(f.writes.length, 0); assert.equal(composed, 0);
});

test('unknown brand stays durable while bounded retries rotate to avoid starvation', async () => {
  const f = await fixture(6);
  const tried: string[] = [];
  const options = { env, service: f.service, notify: f.notify,
    prepareImage: async (_root: string, title: string) => { tried.push(title); return undefined; } };
  const first = await reconcilePendingNewsImages(f.root, options);
  assert.equal(first.attempted, 5); assert.equal(first.pending, 6); assert.equal(tried.length, 5);
  tried.length = 0;
  await reconcilePendingNewsImages(f.root, options);
  assert.equal(tried[0], 'Brand 5 Original copy');
  assert.equal(f.writes.length, 0);
});

test('disabled repair never reads queue or calls services', async () => {
  const service = {} as NewsService;
  const result = await reconcilePendingNewsImages('/missing-root', { service, env: {} });
  assert.equal(result.disabled, true); assert.equal(result.attempted, 0);
});
