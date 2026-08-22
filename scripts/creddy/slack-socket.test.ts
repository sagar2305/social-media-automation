import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { contentReadyReviewBlocks } from './slack-notifications.js';
import {
  approveCreddyContentFromSlack,
  loadCreddySlackFullReview,
  rejectCreddyContentFromSlack,
  undoCreddyContentDecisionFromSlack,
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
  const modal = fullReviewModal({}, details);
  const encoded = JSON.stringify(modal);
  assert.match(encoded, /Full hook|First line|Open Creddy|Source 1|Decision log|Slack: reviewer|approved/);
  assert.match(encoded, /review-me/);
});
