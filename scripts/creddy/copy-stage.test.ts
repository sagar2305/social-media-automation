import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  acceptContentDraft,
  listPendingCopyTasks,
  validateContentConceptPack,
  validateContentDraft,
} from './copy-stage.js';
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
    version: CREDDY_PIPELINE_VERSION, copyVersion: 'creddy-copy-v2',
    id: 'copy-analysis-1', analysisId: 'analysis-1',
    canonicalId: 'canonical-1', createdAt: '2026-08-19T12:30:00.000Z',
    audience: 'US rewards optimizers', slot: 'understand', hook: 'A transfer bonus can change the math',
    textScenes: [
      'A 20% transfer bonus can stretch the same points balance.',
      'Eligible transfers receive 20% more program miles through August 30.',
      'That can lower the number of card points needed for the same award.',
      'Compare the award price and cash fare before moving any points.',
      'Confirm eligibility and award space first because transfers may be irreversible.',
      'Save this checklist, then verify every award with the airline.',
    ],
    narrationScript: 'A 20 percent transfer bonus can stretch your points, but the bonus alone does not make a redemption valuable. Check real award availability, compare the cash price, and confirm the program terms before moving points. Transfers may be irreversible, so verify the booking you want first.',
    instagramCaption: 'A transfer bonus can help, but verify award space before moving points.',
    tiktokCaption: 'Bonus first? No—award space first. Check before you transfer.',
    hashtags: ['#creditcardpoints', '#awardtravel', '#travelrewards'],
    cta: {
      kind: 'engagement',
      messageId: 'engagement-save-award-checklist',
      label: 'Save this checklist, then verify every award with the airline.',
      deepLink: 'creddy://home',
    },
    brief: 'Educational US rewards post with a clear transfer caution.',
    sourceUrls: ['https://awardwallet.com/blog/bonus'], factualClaims: decision().claims,
    conceptPack: {
      subjectLabel: 'Transfer bonus',
      candidates: [
        { id: 'payoff', style: 'specific_payoff', concept: 'A transfer bonus can stretch your points', promise: 'Show when a transfer bonus improves the redemption math.', supportingClaimFields: ['bonus_amount'] },
        { id: 'loss', style: 'loss_avoidance', concept: 'Moving points too early can backfire', promise: 'Show why checking award space before a transfer matters.', supportingClaimFields: ['bonus_amount'] },
        { id: 'contrast', style: 'contrast', concept: 'More miles does not always mean more value', promise: 'Contrast a larger balance with the award someone can actually book.', supportingClaimFields: ['bonus_amount'] },
        { id: 'decision', style: 'decision_question', concept: 'Should you use a transfer bonus?', promise: 'Give the audience a practical decision rule before transferring.', supportingClaimFields: ['bonus_amount'] },
      ],
      selectedCandidateId: 'payoff',
      selectionRationale: 'The payoff is immediately clear and supports a useful caution.',
      rejectionReasons: [
        { candidateId: 'loss', reason: 'More negative than this educational item needs.' },
        { candidateId: 'contrast', reason: 'Less direct for a short social cover.' },
        { candidateId: 'decision', reason: 'The question is less specific than the payoff.' },
      ],
      resolution: {
        slideNumber: 2,
        slideExcerpt: 'Eligible transfers receive 20% more program miles',
        explanation: 'Slide 2 states the accepted bonus and deadline.',
      },
      fulfillment: {
        slideNumbers: [1, 2, 3],
        narrationExcerpt: 'A 20 percent transfer bonus can stretch your points',
        instagramCaptionExcerpt: 'A transfer bonus can help',
        tiktokCaptionExcerpt: 'award space first',
      },
      platforms: {
        blog: { headline: 'When a Transfer Bonus Actually Helps', lede: 'A larger mileage balance matters when the award you want is available.', claimFields: ['bonus_amount'] },
        newsletter: { subject: 'Transfer bonus: check the award first', preheader: 'A transfer bonus can improve the math, but availability comes first.', claimFields: ['bonus_amount'] },
        youtubeLong: { title: 'When a Transfer Bonus Is Actually Worth It', thumbnailPhrase: 'Check Award Space', openingLine: 'A transfer bonus helps when the award you want is bookable.', claimFields: ['bonus_amount'] },
        youtubeShort: { title: 'Transfer Bonus: Check Before Moving Points', openingLine: 'A transfer bonus can help—but check the seat before moving points.', claimFields: ['bonus_amount'] },
        instagram: { coverHook: 'A transfer bonus can change the math', captionOpener: 'A transfer bonus can help, but availability comes first.', claimFields: ['bonus_amount'] },
        tiktok: { coverHook: 'Transfer Bonus: Check the Seat', captionOpener: 'A bigger bonus is useless when the award is gone.', claimFields: ['bonus_amount'] },
      },
    },
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
  await acceptContentDraft(root, draft(), new Date('2026-08-25T00:00:00Z'));
  assert.equal((await listPendingCopyTasks(root)).length, 0);
  assert.equal((await listJsonFiles(safeDataPath(root, '06-content-drafts'))).length, 4);
  assert.equal((await listJsonFiles(safeDataPath(root, '07-video-jobs'))).length, 0);
});

test('Agent 4 requeues legacy drafts for a claim-traceable concept pack', async () => {
  const root = await fixture();
  const legacy = draft();
  delete legacy.copyVersion;
  delete legacy.conceptPack;
  await writeJsonAtomic(safeDataPath(root, '06-content-drafts', `${legacy.id}.json`), legacy);
  assert.equal((await listPendingCopyTasks(root)).length, 1);
  await acceptContentDraft(root, draft(), new Date('2026-08-25T00:00:00Z'));
  assert.equal((await listJsonFiles(safeDataPath(root, '06-content-drafts', 'legacy'))).length, 1);
  assert.equal((await listPendingCopyTasks(root)).length, 0);
});

test('Agent 4 rejects changed accepted claims', async () => {
  const root = await fixture();
  const changed = draft();
  changed.factualClaims[0]!.value = 30;
  await assert.rejects(
    () => acceptContentDraft(root, changed, new Date('2026-08-25T00:00:00Z')),
    /preserve the accepted factual claims exactly/,
  );
});

test('Agent 4 requires an app deep link', () => {
  const invalid = draft();
  invalid.cta.deepLink = 'https://creddy.example';
  assert.throws(() => validateContentDraft(invalid), /creddy:\/\//);
});

test('Agent 4 rejects invented product routes and unsupported product promises', () => {
  const inventedRoute = draft();
  inventedRoute.cta.deepLink = 'creddy://redemptions';
  assert.throws(() => validateContentDraft(inventedRoute), /approved current Creddy message/);

  const inventedPromise = draft();
  inventedPromise.textScenes[5] = 'Save the verified award option in Creddy.';
  inventedPromise.cta.label = inventedPromise.textScenes[5];
  assert.throws(() => validateContentDraft(inventedPromise), /approved current Creddy message|Slide 6/);
});

test('Agent 4 rejects article-summary language in slideshow copy', () => {
  const invalid = draft();
  invalid.textScenes[1] = 'This article covers the transfer bonus and its terms.';
  assert.throws(
    () => validateContentDraft(invalid),
    /must teach the audience directly/,
  );
});

test('Agent 4 rejects publisher names in slides and public captions', async () => {
  const root = await fixture();
  const invalid = draft();
  invalid.textScenes[0] = 'AwardWallet explains how a 20% transfer bonus works.';
  invalid.instagramCaption += ' Source: AwardWallet.';
  await assert.rejects(
    () => acceptContentDraft(root, invalid, new Date('2026-08-25T00:00:00Z')),
    /cannot name publishers|independent of the publisher/,
  );
});

test('Agent 4 keeps publishers and third-party tool names out of every public field', () => {
  const slide = draft();
  slide.textScenes[2] = 'Frequent Miler says this transfer is worth making.';
  assert.throws(() => validateContentDraft(slide), /cannot name publishers/);

  const caption = draft();
  caption.tiktokCaption = 'PointsYeah found the seat first.';
  assert.throws(() => validateContentDraft(caption), /cannot name publishers/);

  const platformTitle = draft();
  platformTitle.conceptPack!.platforms.youtubeLong.title = 'AwardWallet Transfer Bonus Test';
  assert.throws(() => validateContentDraft(platformTitle), /cannot name publishers/);
});

test('Agent 4 rejects unsupported numbers in concept copy', () => {
  const invalid = draft();
  invalid.conceptPack!.platforms.blog.headline = 'The 30% Transfer Bonus Decision';
  assert.throws(() => validateContentConceptPack(invalid), /unsupported number/);
});

test('Agent 4 requires exactly four distinct concept styles and accepted claim references', () => {
  const duplicate = draft();
  duplicate.conceptPack!.candidates[1]!.style = 'specific_payoff';
  assert.throws(() => validateContentConceptPack(duplicate), /unique IDs, styles/);
  const untraced = draft();
  untraced.conceptPack!.platforms.youtubeLong.claimFields = ['invented'];
  assert.throws(() => validateContentConceptPack(untraced), /accepted factual claim fields/);
});

test('Agent 4 rejects clickbait and requires exact fulfillment excerpts', () => {
  const bait = draft();
  bait.conceptPack!.platforms.tiktok.coverHook = 'A SECRET transfer hack';
  assert.throws(() => validateContentConceptPack(bait), /prohibited clickbait/);
  const missing = draft();
  missing.conceptPack!.fulfillment.narrationExcerpt = 'This does not appear';
  assert.throws(() => validateContentConceptPack(missing), /must appear exactly/);
  const personal = draft();
  personal.conceptPack!.platforms.blog.headline = 'What I Wish I Knew About Transfers';
  assert.throws(() => validateContentConceptPack(personal), /prohibited clickbait/);
  const urgency = draft();
  urgency.conceptPack!.platforms.newsletter.subject = 'Last chance: transfer your points';
  assert.throws(() => validateContentConceptPack(urgency), /prohibited clickbait/);
});

test('Agent 4 requires the declared resolution excerpt and selected claim fields', () => {
  const missingPayoff = draft();
  missingPayoff.conceptPack!.resolution.slideExcerpt = 'Not on the selected slide';
  assert.throws(() => validateContentConceptPack(missingPayoff), /resolution excerpt/);
  const changedAngle = draft();
  changedAngle.factualClaims.push({ field: 'other', value: 'Other fact', sourceRecordIds: ['raw-1'], confidence: 90 });
  changedAngle.conceptPack!.candidates[0]!.supportingClaimFields.push('other');
  assert.throws(() => validateContentConceptPack(changedAngle), /preserve every selected-concept claim field/);
});

test('Agent 4 requires standalone titles and hooks to name their subject', () => {
  const vague = draft();
  vague.conceptPack!.platforms.instagram.coverHook = 'Is this still worth it?';
  vague.hook = vague.conceptPack!.platforms.instagram.coverHook;
  assert.throws(() => validateContentConceptPack(vague), /must name the standalone subject/);
});
