import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  acceptAnalysisDecision,
  auditAnalysisDecisionBatch,
  calculateEditorialPriorityScore,
  calculateViralPotentialScore,
  runAnalysisQueueStage,
  selectEditorialPortfolio,
  validateAnalysisDecision,
} from './analysis-stage.js';
import { acceptContentPackage, validateContentPackage } from './content-stage.js';
import {
  initializeCreddyDataRoot,
  listJsonFiles,
  safeDataPath,
  writeJsonAtomic,
} from './pipeline-store.js';
import {
  CREDDY_PIPELINE_VERSION,
  type AnalysisDecisionRecord,
  type CanonicalNewsRecord,
  type ContentPackageRecord,
} from './pipeline-types.js';

function canonical(): CanonicalNewsRecord {
  return {
    version: CREDDY_PIPELINE_VERSION,
    id: 'raw-1',
    runId: '20260819T120000Z-aaaaaaaa',
    sourceId: 'awardwallet',
    sourceName: 'AwardWallet',
    sourceTier: 'B',
    factualUse: 'discovery_and_confirmation',
    originalUrl: 'https://awardwallet.com/blog/bonus',
    canonicalUrl: 'https://awardwallet.com/blog/bonus',
    title: 'New Transfer Bonus',
    markdown: 'A 20% airline transfer bonus ends August 30.',
    contentHash: 'a'.repeat(64),
    titleFingerprint: 'new transfer bonus',
    fetchedAt: '2026-08-19T12:00:00.000Z',
    providerMetadata: {},
    qualification: { qualifies: true, matchedKeywords: ['transfer bonus'] },
    canonicalId: 'canonical-1',
    evidenceRecordIds: ['raw-1'],
    cleanedMarkdown: 'A 20% airline transfer bonus ends August 30.',
    deduplicatedAt: '2026-08-19T12:10:00.000Z',
  };
}

function decision(route: AnalysisDecisionRecord['route'] = 'auto_process'): AnalysisDecisionRecord {
  return {
    version: CREDDY_PIPELINE_VERSION,
    id: 'analysis-1',
    canonicalId: 'canonical-1',
    analyzedAt: '2026-08-19T12:20:00.000Z',
    market: 'US',
    headline: '20% airline transfer bonus',
    summary: 'Eligible US members can receive a 20% transfer bonus.',
    eventType: 'transfer_bonus',
    topic: 'points',
    affectedPrograms: ['Example Airline'],
    requiredAction: 'Transfer before the deadline after confirming award availability.',
    expiry: '2026-08-30T23:59:59-04:00',
    claims: [
      {
        field: 'bonus_amount',
        value: 20,
        sourceRecordIds: ['raw-1'],
        confidence: 90,
      },
    ],
    productFitScore: 90,
    popularityScore: 78,
    importanceScore: 82,
    confidenceScore: 90,
    importanceReasons: ['Actionable and time-limited'],
    confidenceReasons: ['Terms are explicit'],
    materialConflict: false,
    conflictChangesMessage: false,
    verificationExhausted: true,
    route,
    rejectionReasons: [],
    evidenceRecordIds: ['raw-1'],
  };
}

function rankingV3(overrides: Partial<AnalysisDecisionRecord> = {}): AnalysisDecisionRecord {
  const item = decision();
  item.rubricVersion = 'creddy-ranking-v3';
  item.viralPotential = {
    score: 0,
    hookStrength: 85,
    audienceBreadth: 80,
    financialMagnitude: 90,
    novelty: 75,
    urgency: 85,
    practicalUtility: 90,
    visualPotential: 70,
    discussionPotential: 75,
    emotionalAspiration: 70,
    shareSavePotential: 85,
    reasons: ['Large, timely, useful offer with a concrete hook'],
  };
  item.viralPotential.score = calculateViralPotentialScore(item.viralPotential);
  item.channelScores = { instagramTikTok: 85, blogSeo: 78, newsletter: 88, evergreen: 55 };
  item.freshnessScore = 90;
  item.editorialDisposition = 'produce';
  item.verificationState = 'ready';
  item.verificationRequirements = [];
  item.hookType = 'highest_ever_offer';
  item.hookRationale = 'A record bonus gives the audience a clear reason to stop and act.';
  item.portfolioCategory = 'card_offer';
  Object.assign(item, overrides);
  item.editorialPriorityScore = calculateEditorialPriorityScore(item);
  return item;
}

test('ranking v3 validates deterministic viral and priority scores', () => {
  const valid = rankingV3();
  assert.equal(validateAnalysisDecision(valid).rubricVersion, 'creddy-ranking-v3');
  valid.editorialPriorityScore! -= 1;
  assert.throws(() => validateAnalysisDecision(valid), /editorialPriorityScore/);
});

test('ranking v3 keeps editorial upside separate from verification route', () => {
  const blocked = rankingV3({
    verificationState: 'official_source_needed',
    verificationRequirements: ['Verify offer terms with the issuer.'],
    route: 'reverify',
    confidenceScore: 72,
  });
  blocked.editorialPriorityScore = calculateEditorialPriorityScore(blocked);
  assert.equal(validateAnalysisDecision(blocked).route, 'reverify');
  assert.deepEqual(selectEditorialPortfolio([blocked], 5), [blocked]);
});

test('portfolio selection favors category diversity before a second card offer', () => {
  const cardA = rankingV3({ id: 'card-a', canonicalId: 'card-a', affectedPrograms: ['Amex'], editorialPriorityScore: undefined });
  const cardB = rankingV3({ id: 'card-b', canonicalId: 'card-b', affectedPrograms: ['Chase'], productFitScore: 88, portfolioCategory: 'card_offer' });
  const redemption = rankingV3({ id: 'redemption', canonicalId: 'redemption', affectedPrograms: ['Qatar'], productFitScore: 82, portfolioCategory: 'redemption' });
  const travel = rankingV3({ id: 'travel', canonicalId: 'travel', affectedPrograms: ['American'], productFitScore: 75, portfolioCategory: 'travel_development' });
  const selected = selectEditorialPortfolio([cardA, cardB, redemption, travel], 3);
  assert.deepEqual(new Set(selected.map((item) => item.portfolioCategory)), new Set(['card_offer', 'redemption', 'travel_development']));
});

test('portfolio selection limits one primary program to two stories', () => {
  const candidates = ['card_offer', 'redemption', 'travel_development'].map((portfolioCategory, index) =>
    rankingV3({
      id: `amex-${index}`,
      canonicalId: `amex-${index}`,
      affectedPrograms: ['Amex Membership Rewards'],
      portfolioCategory: portfolioCategory as NonNullable<AnalysisDecisionRecord['portfolioCategory']>,
      editorialPriorityScore: undefined,
    }));
  assert.equal(selectEditorialPortfolio(candidates, 5).length, 2);
});

test('Slack routing is rejected unless every rare-review condition is true', () => {
  const invalid = decision('slack_review');
  assert.throws(() => validateAnalysisDecision(invalid), /slack_review is allowed only/);

  const valid = decision('slack_review');
  valid.confidenceScore = 45;
  valid.materialConflict = true;
  valid.conflictChangesMessage = true;
  valid.verificationExhausted = true;
  assert.equal(validateAnalysisDecision(valid).route, 'slack_review');
});

test('auto-process requires product fit, high importance, high confidence, and no conflict', () => {
  const invalid = decision();
  invalid.confidenceScore = 79;
  assert.throws(() => validateAnalysisDecision(invalid), /auto_process requires/);

  const genericDeal = decision();
  genericDeal.productFitScore = 35;
  assert.throws(() => validateAnalysisDecision(genericDeal), /auto_process requires/);
});

test('evergreen queue requires strong product fit and confidence', () => {
  const valid = decision('evergreen_queue');
  valid.importanceScore = 60;
  assert.equal(validateAnalysisDecision(valid).route, 'evergreen_queue');
  valid.confidenceScore = 69;
  assert.throws(() => validateAnalysisDecision(valid), /evergreen_queue requires/);
});

test('analysis batch audit rejects templated bucket scoring across unrelated articles', () => {
  const decisions = Array.from({ length: 3 }, (_, index) => {
    const item = decision('rejected');
    item.id = `analysis-${index}`;
    item.canonicalId = `canonical-${index}`;
    item.headline = `Unrelated article ${index}`;
    item.rejectionReasons = ['Generic rejection'];
    return item;
  });
  assert.throws(
    () => auditAnalysisDecisionBatch(decisions, 1),
    /identical routes, scores, and reasoning/,
  );
});

test('analysis batch audit enforces the five-post production target', () => {
  const decisions = Array.from({ length: 5 }, (_, index) => {
    const item = decision(index < 4 ? 'evergreen_queue' : 'reverify');
    item.id = `analysis-${index}`;
    item.canonicalId = `canonical-${index}`;
    item.headline = `Article ${index}`;
    item.importanceReasons = [`Article ${index} has a distinct practical use case`];
    item.confidenceReasons = [`Article ${index} has distinct attached evidence`];
    if (item.route === 'evergreen_queue') item.importanceScore = 60;
    if (item.route === 'reverify') item.confidenceScore = 68;
    return item;
  });
  const audit = auditAnalysisDecisionBatch(decisions, 5);
  assert.equal(audit.routableCount, 4);
  assert.equal(audit.meetsMinimum, false);
});

test('analysis queue and accepted decision remain inert until rolling authorization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-analysis-'));
  await initializeCreddyDataRoot(root);
  await writeJsonAtomic(
    safeDataPath(root, '03-canonical-news', 'approved', 'canonical-1.json'),
    canonical(),
  );
  const queued = await runAnalysisQueueStage(root);
  assert.equal(queued.outputCount, 1);
  await acceptAnalysisDecision(root, decision());
  assert.equal(
    (await listJsonFiles(safeDataPath(root, '04-analysis-queue', 'pending'))).length,
    0,
  );
  assert.equal(
    (await listJsonFiles(safeDataPath(root, '05-content-opportunities'))).length,
    0,
  );
});

test('current evergreen decisions remain in the rolling pool until authorization', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-evergreen-'));
  await initializeCreddyDataRoot(root);
  await writeJsonAtomic(
    safeDataPath(root, '03-canonical-news', 'approved', 'canonical-1.json'),
    canonical(),
  );
  await runAnalysisQueueStage(root);
  const evergreen = decision('evergreen_queue');
  evergreen.importanceScore = 60;
  await acceptAnalysisDecision(root, evergreen);
  assert.equal(
    (await listJsonFiles(safeDataPath(root, '05-content-opportunities', 'evergreen'))).length,
    0,
  );
});

test('legacy rankings without product and popularity scores are recoverably requeued', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-ranking-v2-'));
  await initializeCreddyDataRoot(root);
  await writeJsonAtomic(
    safeDataPath(root, '03-canonical-news', 'approved', 'canonical-1.json'),
    canonical(),
  );
  const legacy = decision('rejected') as AnalysisDecisionRecord;
  legacy.rejectionReasons = ['Legacy test'];
  delete legacy.productFitScore;
  delete legacy.popularityScore;
  await writeJsonAtomic(
    safeDataPath(root, '04-analysis-queue', 'completed', 'canonical-1.json'),
    legacy,
  );
  const result = await runAnalysisQueueStage(root);
  assert.equal(result.outputCount, 1);
  assert.equal(
    (await listJsonFiles(safeDataPath(root, '04-analysis-queue', 'legacy'))).length,
    1,
  );
  assert.equal(
    (await listJsonFiles(safeDataPath(root, '04-analysis-queue', 'pending'))).length,
    1,
  );
});

test('content package validation enforces app CTA and creates both video jobs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-content-'));
  await initializeCreddyDataRoot(root);
  await writeJsonAtomic(
    safeDataPath(root, '05-content-opportunities', 'analysis-1.json'),
    decision(),
  );
  const content: ContentPackageRecord = {
    version: CREDDY_PIPELINE_VERSION,
    id: 'content-1',
    analysisId: 'analysis-1',
    canonicalId: 'canonical-1',
    createdAt: '2026-08-19T12:30:00.000Z',
    audience: 'US rewards optimizers',
    slot: 'act_now',
    hook: 'A 20% transfer bonus just opened',
    scriptLines: ['A 20% transfer bonus just opened.', 'Check award space before transferring.'],
    caption: 'Confirm the terms and award space before moving points.',
    hashtags: ['creditcardpoints', 'awardtravel'],
    cta: { label: 'Open Creddy', deepLink: 'creddy://home' },
    imagePrompts: ['US travel rewards transfer illustration'],
    characterExpressions: ['excited', 'pointing'],
    brief: 'Short actionable US-market update.',
    sourceUrls: ['https://awardwallet.com/blog/bonus'],
    factualClaims: decision().claims,
  };
  assert.equal(validateContentPackage(content).id, 'content-1');
  const jobs = await acceptContentPackage(root, content);
  assert.deepEqual(
    jobs.map((job) => job.format).sort(),
    ['narrated', 'text_music'],
  );

  const invalid = structuredClone(content);
  invalid.cta.deepLink = 'https://creddy.example';
  assert.throws(() => validateContentPackage(invalid), /creddy:\/\//);

  const invalidExpressions = structuredClone(content);
  invalidExpressions.characterExpressions = ['neutral'];
  assert.throws(
    () => validateContentPackage(invalidExpressions),
    /one supported expression per script line/,
  );
});
