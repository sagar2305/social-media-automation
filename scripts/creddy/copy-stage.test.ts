import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { acceptContentDraft, listPendingCopyTasks, validateContentDraft } from './copy-stage.js';
import { initializeCreddyDataRoot, listJsonFiles, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import {
  CREDDY_PIPELINE_VERSION,
  type AnalysisDecisionRecord,
  type CanonicalNewsRecord,
  type ContentDraftRecord,
} from './pipeline-types.js';

function article(): CanonicalNewsRecord {
  return {
    version: CREDDY_PIPELINE_VERSION,
    id: 'raw-1', runId: 'run-1', sourceId: 'awardwallet', sourceName: 'AwardWallet',
    sourceTier: 'B', factualUse: 'discovery_and_confirmation',
    originalUrl: 'https://awardwallet.com/blog/bonus', canonicalUrl: 'https://awardwallet.com/blog/bonus',
    title: 'New Transfer Bonus', markdown: 'A 20% transfer bonus ends August 30.',
    contentHash: 'a'.repeat(64), titleFingerprint: 'new transfer bonus',
    fetchedAt: '2026-08-19T12:00:00.000Z', providerMetadata: {},
    qualification: { qualifies: true, matchedKeywords: ['transfer bonus'] },
    canonicalId: 'canonical-1', evidenceRecordIds: ['raw-1'],
    cleanedMarkdown: 'A 20% transfer bonus ends August 30.', deduplicatedAt: '2026-08-19T12:10:00.000Z',
  };
}

function decision(): AnalysisDecisionRecord {
  return {
    version: CREDDY_PIPELINE_VERSION, id: 'analysis-1', canonicalId: 'canonical-1',
    analyzedAt: '2026-08-19T12:20:00.000Z', market: 'US', headline: '20% transfer bonus',
    summary: 'Eligible members can receive a transfer bonus.', eventType: 'transfer_bonus', topic: 'points',
    affectedPrograms: ['Example Airline'], requiredAction: 'Check award space first.', expiry: '2026-08-30',
    claims: [{ field: 'bonus_amount', value: 20, sourceRecordIds: ['raw-1'], confidence: 90 }],
    productFitScore: 90, popularityScore: 78, importanceScore: 82, confidenceScore: 90,
    importanceReasons: ['Actionable'], confidenceReasons: ['Terms explicit'], materialConflict: false,
    conflictChangesMessage: false, verificationExhausted: true, route: 'evergreen_queue',
    rejectionReasons: [], evidenceRecordIds: ['raw-1'],
  };
}

function draft(): ContentDraftRecord {
  return {
    version: CREDDY_PIPELINE_VERSION, id: 'copy-analysis-1', analysisId: 'analysis-1',
    canonicalId: 'canonical-1', createdAt: '2026-08-19T12:30:00.000Z',
    audience: 'US rewards optimizers', slot: 'understand', hook: 'A transfer bonus can change the math',
    textScenes: [
      'A 20% transfer bonus can stretch the same points balance.',
      'Eligible transfers receive 20% more program miles through August 30.',
      'That can lower the number of card points needed for the same award.',
      'Compare the award price and cash fare before moving any points.',
      'Confirm eligibility and award space first because transfers may be irreversible.',
      'Check the live terms and compare the redemption in Creddy.',
    ],
    narrationScript: 'A 20 percent transfer bonus can stretch your points, but the bonus alone does not make a redemption valuable. Check real award availability, compare the cash price, and confirm the program terms before moving points. Transfers may be irreversible, so verify the booking you want first.',
    instagramCaption: 'A transfer bonus can help, but verify award space before moving points.',
    tiktokCaption: 'Bonus first? No—award space first. Check before you transfer.',
    hashtags: ['#creditcardpoints', '#awardtravel', '#travelrewards'],
    cta: { label: 'Open Creddy', deepLink: 'creddy://benefits' },
    brief: 'Educational US rewards post with a clear transfer caution.',
    sourceUrls: ['https://awardwallet.com/blog/bonus'], factualClaims: decision().claims,
  };
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'creddy-copy-'));
  await initializeCreddyDataRoot(root);
  await writeJsonAtomic(safeDataPath(root, '03-canonical-news', 'approved', 'canonical-1.json'), article());
  await writeJsonAtomic(safeDataPath(root, '05-content-opportunities', 'evergreen', 'analysis-1.json'), decision());
  return root;
}

test('Agent 4 accepts copy-only output without creating video jobs', async () => {
  const root = await fixture();
  assert.equal((await listPendingCopyTasks(root)).length, 1);
  await acceptContentDraft(root, draft());
  assert.equal((await listPendingCopyTasks(root)).length, 0);
  assert.equal((await listJsonFiles(safeDataPath(root, '06-content-drafts'))).length, 4);
  assert.equal((await listJsonFiles(safeDataPath(root, '07-video-jobs'))).length, 0);
});

test('Agent 4 rejects changed accepted claims', async () => {
  const root = await fixture();
  const changed = draft();
  changed.factualClaims[0]!.value = 30;
  await assert.rejects(() => acceptContentDraft(root, changed), /preserve the accepted factual claims exactly/);
});

test('Agent 4 requires an app deep link', () => {
  const invalid = draft();
  invalid.cta.deepLink = 'https://creddy.example';
  assert.throws(() => validateContentDraft(invalid), /creddy:\/\//);
});

test('Agent 4 rejects article-summary language in slideshow copy', () => {
  const invalid = draft();
  invalid.textScenes[1] = 'This article covers the transfer bonus and its terms.';
  assert.throws(
    () => validateContentDraft(invalid),
    /must teach the audience directly/,
  );
});

test('Agent 4 rejects publisher names in on-slide copy but permits caption attribution', async () => {
  const root = await fixture();
  const invalid = draft();
  invalid.textScenes[0] = 'AwardWallet explains how a 20% transfer bonus works.';
  invalid.instagramCaption += ' Source: AwardWallet.';
  await assert.rejects(
    () => acceptContentDraft(root, invalid),
    /independent of the publisher/,
  );
});
