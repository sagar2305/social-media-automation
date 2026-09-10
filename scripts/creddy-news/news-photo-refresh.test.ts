import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import sharp from 'sharp';
import type { NewsImageReplacement, NewsService } from '../../shared/creddy-news/creddy-news-service.js';
import type { NewsItem } from '../../shared/creddy-news/creddy-news-types.js';
import { editorialImageObjectPath } from '../creddy/editorial-image-delivery.js';
import { applyNewsPhotos, planNewsPhotos } from './news-photo-refresh.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'news-photo-refresh-'));
  const projectRef = 'exampleproject';
  const row = { id: 'news-example', revision: 3, status: 'published', provenance: { evidence: 'retained' },
    content: { headline: 'A travel rewards story', summary: 'Original summary', published_at: 1780000000000, image_url: null },
  } as unknown as NewsItem;
  let writes = 0, uploads = 0;
  const service = { get: async () => structuredClone(row),
    setImage: async (id: string, revision: number, image: NewsImageReplacement) => {
      assert.equal(id, row.id); assert.equal(revision, row.revision); writes++;
      row.revision++; row.content.image_url = image.url; row.provenance.imageRights = image;
      return structuredClone(row);
    } } as unknown as NewsService;
  const upload = async (path: string, label: string) => {
    uploads++;
    const bytes = await sharp(await readFile(path)).webp({ quality: 88 }).toBuffer();
    return `https://${projectRef}.supabase.co/storage/v1/object/public/creddy-blog-assets/${editorialImageObjectPath(label, bytes)}`;
  };
  const planned = await planNewsPhotos(root, [{ newsId: row.id, photoAssetId: 'seattle-waterfront', reason: 'Reviewed illustrative destination.' }], service, projectRef);
  return { root, projectRef, row, service, upload, planned, counts: () => ({ writes, uploads }) };
}
test('photo refresh preserves copy and preimage; same-plan retry performs no upload or mutation', async () => {
  const f = await fixture();
  const first = await applyNewsPhotos(f.root, f.planned.path, f);
  assert.equal(first.results[0]?.status, 'updated');
  assert.equal(f.row.content.published_at, 1780000000000); assert.equal(f.row.provenance.evidence, 'retained');
  const second = await applyNewsPhotos(f.root, f.planned.path, f);
  assert.equal(second.results[0]?.status, 'noop'); assert.deepEqual(f.counts(), { writes: 1, uploads: 1 });
  const saved = JSON.parse(await readFile(join(f.planned.path, '..', 'news-example-preimage.json'), 'utf8'));
  assert.equal(saved.revision, 3); assert.equal(saved.content.image_url, null);
});
test('stale revision and deleted News fail before upload', async () => {
  const f = await fixture(); f.row.revision++;
  assert.equal((await applyNewsPhotos(f.root, f.planned.path, f)).results[0]?.status, 'retry');
  f.row.revision--; f.row.status = 'deleted';
  assert.equal((await applyNewsPhotos(f.root, f.planned.path, f)).results[0]?.status, 'retry');
  assert.deepEqual(f.counts(), { writes: 0, uploads: 0 });
});
test('changed preview and wrong project cannot publish', async () => {
  const f = await fixture();
  await assert.rejects(applyNewsPhotos(f.root, f.planned.path, { ...f, projectRef: 'otherproject' }));
  await writeFile(f.planned.plan.items[0]!.preview.assetPath, 'tampered preview');
  assert.equal((await applyNewsPhotos(f.root, f.planned.path, f)).results[0]?.status, 'retry');
  assert.deepEqual(f.counts(), { writes: 0, uploads: 0 });
});
