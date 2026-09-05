import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { computeArticleApprovalFingerprint } from './article-approval-integrity.js';
import { readDeliveryStatuses } from './delivery-status.js';
import { safeDataPath, writeJsonAtomic } from './pipeline-store.js';

const current = { canonicalId: 'canonical-one', analysisInputHash: 'current-input', decisionHash: 'current-decision' };
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await mkdtemp(join(tmpdir(), 'creddy-delivery-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const put = (folder: string, id: string, value: unknown) => writeJsonAtomic(safeDataPath(root, folder, `${id}.json`), value);
  const get = async () => (await readDeliveryStatuses(root, [current])).get(current.canonicalId)!;
  return { root, put, get };
}

test('News requires a receipt bound to the current analysis and decision', async t => {
  const { put, get } = await fixture(t);
  assert.equal((await get()).news, 'unknown');
  await put('reports/news-delivery', current.canonicalId, { ...current, revision: 1, status: 'published', decisionHash: 'old' });
  assert.equal((await get()).news, 'unknown');
  await put('reports/news-delivery', current.canonicalId, { ...current, revision: 1, status: 'published' });
  assert.equal((await get()).news, 'published');
  await put('reports/news-delivery', current.canonicalId, { ...current, revision: 2, status: 'deleted' });
  assert.equal((await get()).news, 'deleted');
});

test('current News failure is visible without a publication revision', async t => {
  const { put, get } = await fixture(t);
  await put('reports/news-delivery', current.canonicalId, { ...current, status: 'failed' });
  assert.equal((await get()).news, 'failed');
  await put('reports/news-delivery', current.canonicalId, { ...current, status: 'failed', analysisInputHash: 'old' });
  assert.equal((await get()).news, 'unknown');
  await put('reports/news-delivery', current.canonicalId, { ...current, status: 'published' });
  assert.equal((await get()).news, 'unknown');
});

test('social ignores old revisions and skipped or incomplete Slack receipts', async t => {
  const { put, get } = await fixture(t);
  await put('06-content-packages', 'package', { id: 'package', ...current, productionAuthorization: current });
  const bank = { id: 'bank', contentPackageId: 'package', revision: 2, createdAt: '2026-09-05', mediaType: 'slideshow' };
  await put('09-pending-approval', 'bank', bank);
  await put('12-published', 'bank', { ...bank, revision: 1, destinations: [{ platform: 'instagram', status: 'published', publishedAt: 'today', submissionId: 'remote' }] });
  await put('reports/slack-content-ready', 'bank-revision-2', { id: 'bank', revision: 2, sent: false, skippedAt: 'today' });
  assert.equal((await get()).social, 'pending');
  await put('reports/slack-content-ready', 'bank-revision-2', { id: 'bank', revision: 2, sentAt: 'today', channel: 'channel', messageTs: 'timestamp' });
  assert.equal((await get()).social, 'sent_to_slack');
  await put('06-content-packages', 'package', { id: 'package', ...current, productionAuthorization: { ...current, analysisInputHash: 'old' } });
  assert.equal((await get()).social, 'unknown');
});

test('blog requires a matching CMS receipt and unchanged approved content', async t => {
  const { root, put, get } = await fixture(t);
  await put('06-content-packages', 'package', { id: 'package', ...current, productionAuthorization: current, article: { slug: 'article-one' } });
  const preview = join(root, 'preview.html');
  await writeFile(preview, 'approved article');
  const bank = { id: 'bank', contentPackageId: 'package', revision: 1, createdAt: 'today', mediaType: 'article', articlePreviewPath: preview,
    articleReview: { status: 'published', approvedAt: 'approval', approvedContentSha256: '' } };
  bank.articleReview.approvedContentSha256 = await computeArticleApprovalFingerprint(root, bank);
  await put('09-pending-approval', 'bank', bank);
  assert.equal((await get()).blog, 'pending');
  await put('reports/website-cms-published', 'article-one', { approvedAt: 'approval', contentSha256: 'cms-hash', publishedAt: 'today' });
  assert.equal((await get()).blog, 'published');
  await writeFile(preview, 'changed article');
  assert.equal((await get()).blog, 'pending');
});
