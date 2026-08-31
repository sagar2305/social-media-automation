import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { approveAndPublishWebsiteArticle, autoPublishWebsiteArticle, requestWebsiteArticleChanges, unpublishWebsiteArticle } from './article-approval-service.js';
import { initializeCreddyDataRoot, readJson, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import { CREDDY_PIPELINE_VERSION, type ContentBankRecord } from './pipeline-types.js';

async function fixture(): Promise<{ root: string; bankPath: string; previewPath: string; packagePath: string }> {
  const root = await mkdtemp(join(tmpdir(), 'creddy-article-approval-'));
  await initializeCreddyDataRoot(root);
  const previewPath = safeDataPath(root, '06-content-packages', 'articles', 'approval-test', 'index.html');
  await mkdir(dirname(previewPath), { recursive: true });
  await writeJsonAtomic(safeDataPath(root, '06-content-packages', 'approval-package.json'), {
    id: 'approval-package',
    article: { slug: 'approval-test-article' },
  });
  await writeFile(previewPath, '<!doctype html><title>Approval test</title>');
  const bank: ContentBankRecord = {
    version: CREDDY_PIPELINE_VERSION,
    id: 'approval-bank',
    contentPackageId: 'approval-package',
    createdAt: '2026-08-27T00:00:00.000Z',
    status: 'pending_review',
    revision: 1,
    articlePreviewPath: previewPath,
    articleReview: { status: 'pending_review', blockers: [] },
  };
  const bankPath = safeDataPath(root, '09-pending-approval', `${bank.id}.json`);
  await writeJsonAtomic(bankPath, bank);
  return { root, bankPath, previewPath, packagePath: safeDataPath(root, '06-content-packages', 'approval-package.json') };
}

async function writeSuccessReceipt(root: string, bankPath: string): Promise<void> {
  const bank = await readJson<ContentBankRecord>(bankPath);
  await writeJsonAtomic(safeDataPath(root, 'reports', 'website-cms-published', 'approval-test-article.json'), {
    version: 1,
    slug: 'approval-test-article',
    approvedAt: bank.articleReview!.approvedAt,
    contentSha256: 'a'.repeat(64),
    publishedAt: '2026-08-27T00:05:00.000Z',
    revalidation: 'revalidated',
    cmsIdentifier: 'approval-test-article',
    liveUrl: 'https://getcreddy.com/blog/approval-test-article',
  });
}

test('shared website approval records approval, publishing, receipt details, and leaves social status unchanged', async (t) => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  const result = await approveAndPublishWebsiteArticle({
    root: item.root,
    id: 'approval-bank',
    approvedBy: 'dashboard-reviewer',
    publish: async () => {
      const publishing = await readJson<ContentBankRecord>(item.bankPath);
      assert.equal(publishing.articleReview?.status, 'publishing');
      await writeSuccessReceipt(item.root, item.bankPath);
      return { published: 1, skipped: 0, failures: [] };
    },
  });
  const bank = await readJson<ContentBankRecord>(item.bankPath);
  assert.equal(result.publishState, 'published');
  assert.equal(bank.status, 'pending_review');
  assert.equal(bank.articleReview?.status, 'published');
  assert.equal(bank.articleReview?.approvedBy, 'dashboard-reviewer');
  assert.match(bank.articleReview?.approvedContentSha256 ?? '', /^[a-f0-9]{64}$/);
  assert.equal(bank.articleReview?.cmsIdentifier, 'approval-test-article');
  assert.equal(bank.articleReview?.publishedUrl, result.liveUrl);
});

test('failed publication retains approval and retry succeeds without a second approval', async (t) => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  await assert.rejects(approveAndPublishWebsiteArticle({
    root: item.root,
    id: 'approval-bank',
    approvedBy: 'slack-reviewer',
    publish: async () => { throw new Error('network detail that must not be stored'); },
  }), /Agent 8 could not publish/);
  const failed = await readJson<ContentBankRecord>(item.bankPath);
  assert.equal(failed.articleReview?.status, 'publish_failed');
  assert.equal(failed.articleReview?.approvedBy, 'slack-reviewer');
  const approvedAt = failed.articleReview?.approvedAt;
  assert.doesNotMatch(failed.articleReview?.publishError ?? '', /network detail/);

  await approveAndPublishWebsiteArticle({
    root: item.root,
    id: 'approval-bank',
    approvedBy: 'different-clicker',
    publish: async () => {
      await writeSuccessReceipt(item.root, item.bankPath);
      return { published: 1, skipped: 0, failures: [] };
    },
  });
  const published = await readJson<ContentBankRecord>(item.bankPath);
  assert.equal(published.articleReview?.status, 'published');
  assert.equal(published.articleReview?.approvedAt, approvedAt);
  assert.equal(published.articleReview?.approvedBy, 'slack-reviewer');
  assert.equal(published.articleReview?.publishAttempts, 2);
});

test('repeated and concurrent approval callbacks publish once and then skip the receipt', async (t) => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  let publishCalls = 0;
  const invoke = () => approveAndPublishWebsiteArticle({
    root: item.root,
    id: 'approval-bank',
    approvedBy: 'reviewer',
    publish: async () => {
      publishCalls += 1;
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 30));
      await writeSuccessReceipt(item.root, item.bankPath);
      return { published: 1, skipped: 0, failures: [] };
    },
  });
  const [first, second] = await Promise.all([invoke(), invoke()]);
  const third = await invoke();
  assert.equal(publishCalls, 1);
  assert.deepEqual([first.publishState, second.publishState, third.publishState].sort(), ['published', 'skipped', 'skipped']);
});

test('requesting article changes clears website approval without changing slideshow status or invoking publishing', async (t) => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  const bank = await readJson<ContentBankRecord>(item.bankPath);
  bank.articleReview = { status: 'approved', approvedBy: 'reviewer', approvedAt: '2026-08-27T00:01:00.000Z', approvedContentSha256: 'a'.repeat(64) };
  await writeJsonAtomic(item.bankPath, bank);
  await requestWebsiteArticleChanges({ root: item.root, id: bank.id, requestedBy: 'editor', notes: 'Please correct the comparison table.' });
  const changed = await readJson<ContentBankRecord>(item.bankPath);
  assert.equal(changed.status, 'pending_review');
  assert.equal(changed.articleReview?.status, 'changes_requested');
  assert.equal(changed.articleReview?.approvedAt, undefined);
  assert.equal(changed.articleReview?.changeNotes, 'Please correct the comparison table.');
});

test('content changed after approval is moved back to changes requested and is not published', async (t) => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  await assert.rejects(approveAndPublishWebsiteArticle({
    root: item.root,
    id: 'approval-bank',
    approvedBy: 'reviewer',
    publish: async () => { throw new Error('first publish fails'); },
  }));
  await writeJsonAtomic(item.packagePath, {
    id: 'approval-package',
    article: { slug: 'approval-test-article', title: 'Changed after approval' },
  });
  let publishCalls = 0;
  await assert.rejects(approveAndPublishWebsiteArticle({
    root: item.root,
    id: 'approval-bank',
    approvedBy: 'reviewer',
    publish: async () => { publishCalls += 1; return { published: 1, skipped: 0, failures: [] }; },
  }), /requires Agent 7 reapproval/);
  const changed = await readJson<ContentBankRecord>(item.bankPath);
  assert.equal(publishCalls, 0);
  assert.equal(changed.articleReview?.status, 'changes_requested');
  assert.equal(changed.articleReview?.approvedAt, undefined);
  assert.match(changed.articleReview?.changeNotes ?? '', /changed after approval/);
});

test('Agent 7 automatic retry fingerprints the latest generated article before publishing', async (t) => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  await assert.rejects(autoPublishWebsiteArticle({
    root: item.root,
    id: 'approval-bank',
    publish: async () => { throw new Error('first publish fails'); },
  }));
  const failed = await readJson<ContentBankRecord>(item.bankPath);
  const firstFingerprint = failed.articleReview?.approvedContentSha256;
  await writeFile(item.previewPath, '<!doctype html><title>Updated automatic article</title>');
  await autoPublishWebsiteArticle({
    root: item.root,
    id: 'approval-bank',
    publish: async () => {
      await writeSuccessReceipt(item.root, item.bankPath);
      return { published: 1, skipped: 0, failures: [] };
    },
  });
  const published = await readJson<ContentBankRecord>(item.bankPath);
  assert.equal(published.articleReview?.status, 'published');
  assert.equal(published.articleReview?.approvedBy, 'Agent 7 automatic website release');
  assert.notEqual(published.articleReview?.approvedContentSha256, firstFingerprint);
});

test('Agent 7 auto-publishes without a human click, delete is idempotent, and repost keeps social state separate', async (t) => {
  const item = await fixture();
  t.after(() => rm(item.root, { recursive: true, force: true }));
  await autoPublishWebsiteArticle({
    root: item.root,
    id: 'approval-bank',
    publish: async () => {
      await writeSuccessReceipt(item.root, item.bankPath);
      return { published: 1, skipped: 0, failures: [] };
    },
  });
  let record = await readJson<ContentBankRecord>(item.bankPath);
  assert.equal(record.articleReview?.status, 'published');
  assert.equal(record.articleReview?.approvedBy, 'Agent 7 automatic website release');
  assert.equal(record.status, 'pending_review');

  let deleteCalls = 0;
  const remove = () => unpublishWebsiteArticle({
    root: item.root,
    id: 'approval-bank',
    unpublishedBy: 'dashboard-editor',
    unpublish: async () => { deleteCalls += 1; return { removedAssets: 3, revalidation: 'revalidated' }; },
  });
  assert.equal((await remove()).removedAssets, 3);
  assert.equal((await remove()).removedAssets, 0);
  assert.equal(deleteCalls, 1);
  record = await readJson<ContentBankRecord>(item.bankPath);
  assert.equal(record.articleReview?.status, 'unpublished');
  assert.equal(record.status, 'pending_review');

  await autoPublishWebsiteArticle({
    root: item.root,
    id: 'approval-bank',
    publish: async () => {
      await writeSuccessReceipt(item.root, item.bankPath);
      return { published: 1, skipped: 0, failures: [] };
    },
  });
  record = await readJson<ContentBankRecord>(item.bankPath);
  assert.equal(record.articleReview?.status, 'published');
  assert.equal(record.status, 'pending_review');
});
