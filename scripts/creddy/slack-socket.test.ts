import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { articleReadyReviewBlocks, contentReadyReviewBlocks, selfContainedArticlePreview } from './slack-notifications.js';
import {
  approveCreddyContentFromSlack,
  loadCreddySlackFullReview,
  rejectCreddyContentFromSlack,
  undoCreddyContentDecisionFromSlack,
  verifyFactsAndApproveCreddyContentFromSlack,
} from './slack-content-store.js';
import { fullReviewModal, resolvedMessageBlocks } from './slack-socket.js';

const event = {
  id: 'slideshow-review-1',
  hook: 'A review hook',
  instagramCaption: 'Instagram copy',
  tiktokCaption: 'TikTok copy',
  hashtags: ['Creddy'],
  slideImagePaths: Array.from({ length: 6 }, (_, index) => `/tmp/slide-${index + 1}.png`),
};

test('Agent 7 review stays inside Slack and contains no expiring URL', () => {
  const blocks = contentReadyReviewBlocks(event);
  const actions = blocks.find((block) => block.type === 'actions') as {
    elements: Array<{ action_id: string; value?: string; url?: string; text?: { text?: string } }>;
  };
  const review = actions.elements.find((element) => element.action_id === 'creddy_content_open');
  assert.equal(review?.value, event.id);
  assert.equal(review?.url, undefined);
  assert.equal(review?.text?.text, 'View full review in Slack');

  const modal = fullReviewModal({ message: { blocks } });
  assert.equal(modal.type, 'modal');
  assert.doesNotMatch(JSON.stringify(modal), /trycloudflare|DASHBOARD_BASE_URL|https?:\/\//i);
});

test('unresolved official verification uses a distinct audited Slack approval action', () => {
  const blocks = contentReadyReviewBlocks({
    ...event,
    verificationGate: {
      portfolioRank: 1,
      selectedAt: '2026-08-31T12:00:00.000Z',
      socialStatus: 'manual_confirmation_required',
      official: {
        version: 1, id: 'official-verification-1', decisionId: 'decision-1', canonicalId: 'canonical-1',
        checkedAt: '2026-08-31T12:05:00.000Z', status: 'inconclusive', attemptedUrls: ['https://issuer.example/terms'],
        evidence: [], claimOutcomes: [], remainingRequirements: ['Confirm current terms.'], failureReasons: [],
      },
    },
  });
  const encoded = JSON.stringify(blocks);
  assert.match(encoded, /creddy_content_facts_verify/);
  assert.match(encoded, /Facts verified and approve/);
  assert.doesNotMatch(encoded, /creddy_content_approve/);
});

test('Slack facts verification records actor and time idempotently', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'creddy-slack-facts-'));
  t.after(async () => rm(parent, { recursive: true, force: true }));
  const bank = join(parent, 'creddy', '09-pending-approval');
  await mkdir(bank, { recursive: true });
  await mkdir(join(parent, 'creddy', '06-content-packages'), { recursive: true });
  await writeFile(join(parent, 'creddy', '06-content-packages', 'draft-1.json'), JSON.stringify({ id: 'draft-1', hook: 'Legacy fixture' }));
  await writeFile(join(bank, 'verify-me.json'), JSON.stringify({
    version: 1, id: 'verify-me', contentPackageId: 'draft-1', createdAt: '2026-08-31T12:00:00.000Z',
    status: 'pending_review', revision: 2, destinations: [],
    verificationGate: {
      portfolioRank: 1, selectedAt: '2026-08-31T11:00:00.000Z', socialStatus: 'manual_confirmation_required',
      official: {
        version: 1, id: 'official-verification-1', decisionId: 'decision-1', canonicalId: 'canonical-1',
        checkedAt: '2026-08-31T11:30:00.000Z', status: 'unavailable', attemptedUrls: [], evidence: [],
        claimOutcomes: [], remainingRequirements: ['Confirm manually.'], failureReasons: ['Official page unavailable.'],
      },
    },
  }));
  const env = { CREDDY_DATA_ROOT: parent };
  const now = new Date('2026-08-31T13:00:00.000Z');
  await verifyFactsAndApproveCreddyContentFromSlack({ id: 'verify-me', approvedBy: 'Slack: editor', env }, now);
  await verifyFactsAndApproveCreddyContentFromSlack({ id: 'verify-me', approvedBy: 'Slack: editor', env }, now);
  const stored = JSON.parse(await readFile(join(bank, 'verify-me.json'), 'utf8')) as {
    status: string;
    verificationGate: { socialStatus: string; factsVerifiedBy: string; factsVerifiedAt: string; factsVerificationRevision: number };
  };
  assert.equal(stored.status, 'approved');
  assert.deepEqual(stored.verificationGate, {
    ...stored.verificationGate,
    socialStatus: 'verified',
    factsVerifiedBy: 'Slack: editor',
    factsVerifiedAt: now.toISOString(),
    factsVerificationRevision: 2,
  });
});

test('website article management stays separate from slideshow approval and exposes delete or repost only', () => {
  const blocks = articleReadyReviewBlocks({
    id: 'slideshow-review-1',
    title: 'A complete website article',
    dek: 'Useful verified guidance.',
    excerpt: 'A practical summary.',
    category: 'guides',
    readingMinutes: 5,
    sourceUrls: ['https://example.com/source'],
    articleImagePaths: ['/tmp/hero.png'],
    articlePreviewPath: '/tmp/preview.html',
    publishStatus: 'published',
    publishedUrl: 'https://getcreddy.com/blog/article',
  });
  const encoded = JSON.stringify(blocks);
  assert.match(encoded, /creddy_website_delete|Undo publish/);
  assert.doesNotMatch(encoded, /creddy_website_approve|creddy_website_changes/);
  assert.doesNotMatch(encoded, /creddy_content_approve/);
  assert.doesNotMatch(JSON.stringify(contentReadyReviewBlocks(event)), /creddy_website_delete|creddy_website_repost/);

  const failed = JSON.stringify(articleReadyReviewBlocks({
    id: 'slideshow-review-1', title: 'Article', dek: 'Dek', excerpt: 'Excerpt', category: 'guides', readingMinutes: 5,
    sourceUrls: [], articleImagePaths: ['/tmp/hero.png'], articlePreviewPath: '/tmp/preview.html', publishStatus: 'publish_failed',
  }));
  assert.match(failed, /creddy_website_repost|Retry publish/);
  assert.doesNotMatch(failed, /creddy_website_delete|creddy_website_approve/);
});

test('Slack article HTML embeds approved images without changing the original preview', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'creddy-slack-html-'));
  t.after(async () => rm(directory, { recursive: true, force: true }));
  const imagePath = join(directory, 'hero.png');
  const previewPath = join(directory, 'preview.html');
  await writeFile(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const original = '<!doctype html><img src="assets/hero.png">';
  await writeFile(previewPath, original);
  const bytes = await selfContainedArticlePreview({
    id: 'article-1', title: 'Article', dek: 'Dek', excerpt: 'Excerpt', category: 'guides', readingMinutes: 4,
    sourceUrls: [], articleImagePaths: [imagePath], articlePreviewPath: previewPath,
  });
  assert.match(bytes.toString(), /src="data:image\/png;base64,/);
  assert.equal(await readFile(previewPath, 'utf8'), original);
});

test('resolved Slack messages keep full review and add undo, but remove approve and reject', () => {
  const blocks = contentReadyReviewBlocks(event);
  const resolved = resolvedMessageBlocks({ message: { blocks } }, ':white_check_mark: Approved');
  const actions = resolved.find((block) => block.type === 'actions') as { elements: Array<{ action_id: string }> };
  assert.deepEqual(actions.elements.map((element) => element.action_id), ['creddy_content_open', 'creddy_content_undo']);
  assert.doesNotMatch(JSON.stringify(actions), /creddy_content_approve|creddy_content_reject/);
  assert.match(JSON.stringify(resolved), /Approved/);
});

test('Socket Mode approval and rejection persist in portal directories', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'creddy-slack-socket-'));
  t.after(async () => rm(parent, { recursive: true, force: true }));
  const bank = join(parent, 'creddy', '09-pending-approval');
  const drafts = join(parent, 'creddy', '06-content-drafts');
  await mkdir(bank, { recursive: true });
  await mkdir(drafts, { recursive: true });
  await mkdir(join(parent, 'creddy', '06-content-packages'), { recursive: true });
  await writeFile(join(parent, 'creddy', '06-content-packages', 'draft-1.json'), JSON.stringify({ id: 'draft-1', hook: 'Legacy fixture' }));
  const base = {
    version: 1,
    contentPackageId: 'draft-1',
    createdAt: '2026-08-22T00:00:00.000Z',
    revision: 1,
    destinations: [],
  };
  await writeFile(join(bank, 'approve-me.json'), JSON.stringify({ ...base, id: 'approve-me', status: 'pending_review' }));
  await writeFile(join(bank, 'reject-me.json'), JSON.stringify({ ...base, id: 'reject-me', status: 'pending_review' }));
  const env = { CREDDY_DATA_ROOT: parent };

  await approveCreddyContentFromSlack({ id: 'approve-me', approvedBy: 'Slack: reviewer', env });
  const approved = JSON.parse(await readFile(join(parent, 'creddy', '10-approved', 'approve-me.json'), 'utf8')) as {
    status: string;
    approvedBy: string;
  };
  assert.equal(approved.status, 'approved');
  assert.equal(approved.approvedBy, 'Slack: reviewer');

  await undoCreddyContentDecisionFromSlack({ id: 'approve-me', undoneBy: 'Slack: reviewer', env });
  await undoCreddyContentDecisionFromSlack({ id: 'approve-me', undoneBy: 'Slack: reviewer', env });
  const undone = JSON.parse(await readFile(join(parent, 'creddy', '09-pending-approval', 'approve-me.json'), 'utf8')) as {
    status: string;
    reviewHistory: Array<{ action: string; actor: string }>;
  };
  assert.equal(undone.status, 'pending_review');
  assert.deepEqual(undone.reviewHistory.map((entry) => entry.action), ['approved', 'undone']);
  assert.equal(undone.reviewHistory.at(-1)?.actor, 'Slack: reviewer');

  await approveCreddyContentFromSlack({ id: 'approve-me', approvedBy: 'Slack: reviewer', env });
  await approveCreddyContentFromSlack({ id: 'approve-me', approvedBy: 'Slack: reviewer', env });
  const approvedAgain = JSON.parse(await readFile(join(parent, 'creddy', '10-approved', 'approve-me.json'), 'utf8')) as {
    reviewHistory: Array<{ action: string }>;
  };
  assert.deepEqual(approvedAgain.reviewHistory.map((entry) => entry.action), ['approved', 'undone', 'approved']);

  await rejectCreddyContentFromSlack({
    id: 'reject-me',
    rejectedBy: 'Slack: reviewer',
    reason: 'Rejected from Slack review',
    env,
  });
  await rejectCreddyContentFromSlack({
    id: 'reject-me',
    rejectedBy: 'Slack: reviewer',
    reason: 'Rejected from Slack review',
    env,
  });
  const rejected = JSON.parse(await readFile(join(parent, 'creddy', '13-rejected-content', 'reject-me.json'), 'utf8')) as {
    status: string;
    rejectedBy: string;
  };
  assert.equal(rejected.status, 'rejected');
  assert.equal(rejected.rejectedBy, 'Slack: reviewer');
});

test('full review loads local copy, sources, CTA, status, and audit log', async (t) => {
  const parent = await mkdtemp(join(tmpdir(), 'creddy-slack-review-'));
  t.after(async () => rm(parent, { recursive: true, force: true }));
  const root = join(parent, 'creddy');
  await mkdir(join(root, '09-pending-approval'), { recursive: true });
  await mkdir(join(root, '06-content-drafts'), { recursive: true });
  await writeFile(join(root, '09-pending-approval', 'review-me.json'), JSON.stringify({
    id: 'review-me', contentDraftId: 'draft-1', createdAt: '2026-08-22T00:00:00.000Z', status: 'approved', revision: 2,
    reviewHistory: [{ action: 'approved', actor: 'Slack: reviewer', changedAt: '2026-08-22T01:00:00.000Z', fromStatus: 'pending_review', toStatus: 'approved' }],
  }));
  await writeFile(join(root, '06-content-drafts', 'draft-1.json'), JSON.stringify({
    id: 'draft-1', hook: 'Full hook', textScenes: ['First line', 'Second line'], instagramCaption: 'IG', tiktokCaption: 'TT',
    hashtags: ['Creddy'], cta: { label: 'Open Creddy', deepLink: 'creddy://home' }, brief: 'Brief', sourceUrls: ['https://example.com/source'],
    factualClaims: [{ field: 'value', value: 20, confidence: 90 }],
  }));
  const details = await loadCreddySlackFullReview('review-me', { CREDDY_DATA_ROOT: parent });
  details.verificationGate = {
    portfolioRank: 1, selectedAt: '2026-08-31T10:00:00.000Z', socialStatus: 'manual_confirmation_required',
    official: {
      version: 1, id: 'official-review', decisionId: 'decision-review', canonicalId: 'canonical-review',
      checkedAt: '2026-08-31T10:05:00.000Z', status: 'unavailable', attemptedUrls: ['https://delta.com/terms'],
      evidence: [], claimOutcomes: [], remainingRequirements: ['Manual confirmation.'], failureReasons: ['Official page timed out.'],
    },
  };
  const modal = fullReviewModal({}, details);
  const encoded = JSON.stringify(modal);
  assert.match(encoded, /Full hook|First line|Open Creddy|Source 1|Decision log|Slack: reviewer|approved/);
  assert.match(encoded, /Official URLs attempted|delta.com|Verification failures|timed out/);
  assert.match(encoded, /review-me/);
});
