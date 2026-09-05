import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { selfContainedArticlePreview } from './slack-notifications.js';
import { rawFilteringDate } from './filter-stage.js';
import { initializeCreddyDataRoot, readJson, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import { runPublishStage } from './publish-stage.js';
import { runSlideshowContentBankHandoff } from './slideshow-bank-stage.js';
import type { ContentBankRecord } from './pipeline-types.js';

test('test-only preloader blocks unmocked outbound requests', () => {
  const output = execFileSync(process.execPath, ['--import', new URL('./test-safety.mjs', import.meta.url).href,
    '--input-type=module', '-e', 'try { await fetch("https://example.invalid"); process.exit(1); } catch (error) { console.log(error.message); }'],
  { encoding: 'utf8' });
  assert.match(output, /Unmocked network request blocked by the Creddy test harness/);
});

test('Slack preview maps visual IDs to approved source pixels, including duplicate basenames and WebP', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-preview-mapping-'));
  const images = [];
  for (const id of ['hero', 'inline']) {
    await mkdir(join(root, id));
    const path = join(root, id, 'source.webp');
    await writeFile(path, Buffer.from(id));
    images.push({ previewFilename: `${id}.webp`, assetPath: path });
  }
  const preview = join(root, 'index.html');
  const html = '<img src="assets/hero.webp"><img src="assets/inline.webp">';
  await writeFile(preview, html);
  const event = { id: 'article', title: 'Title', dek: '', excerpt: '', category: 'guides', readingMinutes: 1,
    sourceUrls: [], articlePreviewPath: preview, articleImagePaths: images.map(i => i.assetPath), articleImages: images };
  const result = Buffer.from(await selfContainedArticlePreview(event)).toString();
  assert.match(result, new RegExp(Buffer.from('hero').toString('base64')));
  assert.match(result, new RegExp(Buffer.from('inline').toString('base64')));
  assert.doesNotMatch(result, /src="assets\//);
  assert.equal(await readFile(preview, 'utf8'), html);
  await assert.rejects(selfContainedArticlePreview({ ...event, articleImages: [images[0]!] }), /unresolved/);
  await assert.rejects(selfContainedArticlePreview({ ...event, articleImages: [images[0]!, images[0]!] }), /ambiguous/);
  await assert.rejects(selfContainedArticlePreview({ ...event, articleImagePaths: [] }), /approved.*mapping/);
});

test('legacy raw filtering retains one known import date without accepting arbitrary run IDs', () => {
  assert.equal(rawFilteringDate({ runId: 'creddy-seven-recovery-20260826T095500Z', fetchedAt: '2026-08-26T10:00:12.123Z' }), '2026-08-26');
  assert.throws(() => rawFilteringDate({ runId: 'other-20260826T095500Z', fetchedAt: '2026-08-26T00:00:00Z' }), /Invalid run id/);
  assert.throws(() => rawFilteringDate({ runId: 'creddy-seven-recovery-20260826T095500Z', fetchedAt: '2026-08-27T00:00:00Z' }), /acquisition date/);
});

test('historical slideshow manifests are never processed or changed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-archived-slides-'));
  await initializeCreddyDataRoot(root);
  const archived = safeDataPath(root, '07-slideshow-renders', 'revisions', 'plan', 'revision-1', 'manifest.json');
  await writeJsonAtomic(archived, { deliberately: 'invalid historical manifest' });
  const before = await readFile(archived, 'utf8');
  const result = await runSlideshowContentBankHandoff(root);
  assert.equal(result.eligible, 0);
  assert.deepEqual(result.failures, []);
  assert.equal(await readFile(archived, 'utf8'), before);
});

test('existing submissions reconcile without packages and survive a blocked new destination', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-legacy-reconcile-'));
  await initializeCreddyDataRoot(root);
  const path = safeDataPath(root, '11-scheduled', 'legacy.json');
  const bank: ContentBankRecord = { version: 1, id: 'legacy', contentPackageId: 'missing', createdAt: '2026-08-21T00:00:00Z',
    status: 'scheduled', revision: 1, destinations: [
      { platform: 'instagram', account: 'test', format: 'text_music', scheduledFor: '2026-08-22T00:00:00Z', status: 'submitted', submissionId: 'existing' },
      { platform: 'tiktok', account: 'test', format: 'text_music', scheduledFor: '2026-08-22T00:00:00Z', status: 'pending' },
    ] };
  await writeJsonAtomic(path, bank);
  let submissions = 0;
  const result = await runPublishStage(root, {
    getPostStatus: async () => ({ status: 'published', url: 'https://instagram.com/p/known' }),
    scheduleVideo: async () => { submissions++; throw new Error('Must not submit'); },
  });
  assert.equal(submissions, 0);
  assert.equal(result.outputCount, 1);
  assert.equal(result.failedCount, 1);
  assert.equal((await readJson<ContentBankRecord>(path)).destinations![0]!.status, 'published');
});

test('remote failure is isolated and TikTok inbox success is not public publication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-draft-reconcile-'));
  await initializeCreddyDataRoot(root);
  const path = safeDataPath(root, '11-scheduled', 'legacy.json');
  await writeJsonAtomic(path, { version: 1, id: 'legacy', contentPackageId: 'missing', createdAt: '2026-08-21T00:00:00Z',
    status: 'scheduled', revision: 1, destinations: [
      { platform: 'instagram', status: 'submitted', submissionId: 'unavailable' },
      { platform: 'tiktok', status: 'blotato_draft', submissionId: 'draft' },
    ] });
  const result = await runPublishStage(root, {
    getPostStatus: async id => { if (id === 'unavailable') throw new Error('offline'); return { status: 'published' }; },
    scheduleVideo: async () => { throw new Error('Must not submit'); },
  });
  assert.equal(result.failedCount, 1);
  assert.equal(result.outputCount, 0);
  const saved = await readJson<ContentBankRecord>(path);
  assert.equal(saved.destinations![1]!.status, 'draft_sent');
  assert.ok(saved.destinations![1]!.lastCheckedAt);
});
