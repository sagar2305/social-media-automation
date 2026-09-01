import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  acceptOfficialVerification,
  listPendingOfficialVerificationTasks,
  prepareOfficialVerificationTasks,
  reopenConflictingVerification,
  validateOfficialVerification,
} from './official-verification-stage.js';
import { acceptAnalysisDecision, analysisInputFingerprint, calculateEditorialPriorityScore } from './analysis-stage.js';
import {
  assertArticleVerificationPublishable,
  assertSocialVerificationSatisfied,
  markSocialFactsVerified,
  publicationModeForOpportunity,
} from './publication-policy.js';
import { initializeCreddyDataRoot, listJsonFiles, pathExists, readJson, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import {
  CREDDY_PIPELINE_VERSION,
  type AnalysisDecisionRecord,
  type CanonicalNewsRecord,
  type CreddyOfficialVerificationRecord,
  type OfficialVerificationTaskRecord,
} from './pipeline-types.js';

const categories: NonNullable<AnalysisDecisionRecord['portfolioCategory']>[] = [
  'card_offer', 'loyalty_news', 'redemption', 'travel_development', 'evergreen_education', 'card_offer',
];

function article(index: number): CanonicalNewsRecord {
  return {
    version: CREDDY_PIPELINE_VERSION,
    id: `raw-${index}`,
    runId: '20260831T120000Z-aaaaaaaa',
    sourceId: 'awardwallet',
    sourceName: 'AwardWallet',
    sourceTier: 'B',
    factualUse: 'discovery_and_confirmation',
    originalUrl: `https://awardwallet.com/blog/story-${index}`,
    canonicalUrl: `https://awardwallet.com/blog/story-${index}`,
    title: `Story ${index}`,
    contentHash: `content-${index}`,
    titleFingerprint: `story-${index}`,
    markdown: `Story ${index} reports a material points change.`,
    publishedAt: '2026-08-31T10:00:00.000Z',
    fetchedAt: '2026-08-31T11:00:00.000Z',
    providerMetadata: {},
    qualification: { qualifies: true, matchedKeywords: ['points'] },
    canonicalId: `canonical-${index}`,
    evidenceRecordIds: [`raw-${index}`],
    cleanedMarkdown: `Story ${index} reports a material points change.`,
    deduplicatedAt: '2026-08-31T11:10:00.000Z',
  };
}

function decision(index: number): AnalysisDecisionRecord {
  return {
    version: CREDDY_PIPELINE_VERSION,
    id: `ranking-canonical-${index}`,
    canonicalId: `canonical-${index}`,
    analysisBatchId: 'batch-current', analysisInputHash: analysisInputFingerprint(article(index)),
    analyzedAt: `2026-08-31T12:0${index}:00.000Z`,
    market: 'US',
    headline: `Material points story ${index}`,
    summary: 'A selected story that needs an official-source check.',
    eventType: 'program_change',
    topic: 'points',
    affectedPrograms: [`Program ${index}`],
    requiredAction: null,
    expiry: null,
    claims: [{ field: 'material_change', value: `Change ${index}`, sourceRecordIds: [`raw-${index}`], confidence: 68 }],
    productFitScore: 85,
    popularityScore: 80,
    rubricVersion: 'creddy-ranking-v3',
    viralPotential: {
      score: 80, hookStrength: 80, audienceBreadth: 80, financialMagnitude: 80, novelty: 80,
      urgency: 80, practicalUtility: 80, visualPotential: 80, discussionPotential: 80,
      emotionalAspiration: 80, shareSavePotential: 80, reasons: ['Useful and timely'],
    },
    channelScores: { instagramTikTok: 80, blogSeo: 80, newsletter: 80, evergreen: 70 },
    freshnessScore: 85,
    editorialPriorityScore: 80 - index,
    editorialDisposition: 'produce',
    verificationState: 'official_source_needed',
    verificationRequirements: ['Confirm the material change on the official program website.'],
    hookType: 'program_change',
    hookRationale: 'The change affects a broad points audience.',
    portfolioCategory: categories[index]!,
    importanceScore: 80,
    confidenceScore: 68,
    importanceReasons: ['Material program impact'],
    confidenceReasons: ['One publisher source'],
    materialConflict: false,
    conflictChangesMessage: false,
    verificationExhausted: false,
    route: 'reverify',
    rejectionReasons: [],
    evidenceRecordIds: [`raw-${index}`],
  };
}

function result(task: OfficialVerificationTaskRecord, status: CreddyOfficialVerificationRecord['status']): CreddyOfficialVerificationRecord {
  const claimStatus = status === 'verified' ? 'verified' : status === 'conflicting' ? 'conflicting' : 'not_found';
  return {
    version: 1,
    id: task.id,
    decisionId: task.decision.id,
    canonicalId: task.decision.canonicalId,
    checkedAt: '2026-08-31T12:30:00.000Z',
    status,
    attemptedUrls: ['https://www.delta.com/program/terms'],
    evidence: status === 'verified' || status === 'conflicting'
      ? [{ url: 'https://www.delta.com/program/terms', owner: 'Delta Air Lines', sourceType: 'airline' }]
      : [],
    claimOutcomes: [{
      field: 'material_change',
      status: claimStatus,
      officialUrls: status === 'verified' || status === 'conflicting' ? ['https://www.delta.com/program/terms'] : [],
      notes: status === 'verified' ? 'Official terms confirm the claim.' : status === 'conflicting' ? 'Official terms state a different value.' : 'No matching official page was available.',
    }],
    remainingRequirements: status === 'verified' ? [] : ['A reviewer must resolve or confirm the material claim.'],
    failureReasons: status === 'unavailable' ? ['Official page returned 404.'] : [],
  };
}

test('Agent 03 persists official-verification tasks only for the diversified top five', async () => {
  const root = join(await mkdtemp(join(tmpdir(), 'creddy-official-')), 'creddy');
  await initializeCreddyDataRoot(root);
  for (let index = 0; index < 6; index += 1) {
    await writeJsonAtomic(safeDataPath(root, '03-canonical-news', 'approved', `canonical-${index}.json`), article(index));
    await writeJsonAtomic(safeDataPath(root, '04-analysis-queue', 'completed', `canonical-${index}.json`), decision(index));
  }
  const selected = await prepareOfficialVerificationTasks(root, new Date('2026-08-31T12:20:00.000Z'));
  assert.equal(selected.length, 5);
  assert.deepEqual(selected.map((task) => task.portfolioRank), [1, 2, 3, 4, 5]);
  assert.equal((await listPendingOfficialVerificationTasks(root)).length, 5);
});

test('unavailable official verification stays inert until rolling selection and gates social delivery', async () => {
  const root = join(await mkdtemp(join(tmpdir(), 'creddy-official-')), 'creddy');
  await initializeCreddyDataRoot(root);
  await writeJsonAtomic(safeDataPath(root, '03-canonical-news', 'approved', 'canonical-0.json'), article(0));
  await writeJsonAtomic(safeDataPath(root, '04-analysis-queue', 'completed', 'canonical-0.json'), decision(0));
  const [task] = await prepareOfficialVerificationTasks(root);
  const accepted = await acceptOfficialVerification(root, result(task!, 'unavailable'));
  assert.equal(accepted.verificationGate?.socialStatus, 'manual_confirmation_required');
  assert.equal(publicationModeForOpportunity(accepted, article(0)), undefined);
  assert.doesNotThrow(() => assertArticleVerificationPublishable(accepted.verificationGate));
  assert.throws(() => assertSocialVerificationSatisfied(accepted.verificationGate), /Facts verified and approve/);
  const confirmed = markSocialFactsVerified(accepted.verificationGate, 'editor@example.com', 1, new Date('2026-08-31T13:00:00.000Z'));
  assert.equal(confirmed?.socialStatus, 'verified');
  assert.equal(confirmed?.factsVerifiedBy, 'editor@example.com');
  assert.doesNotThrow(() => assertSocialVerificationSatisfied(confirmed, 1));
});

test('stale official task cannot overwrite a newer Agent 03 decision', async () => {
  const root = join(await mkdtemp(join(tmpdir(), 'creddy-official-stale-')), 'creddy');
  await initializeCreddyDataRoot(root);
  await writeJsonAtomic(safeDataPath(root, '03-canonical-news', 'approved', 'canonical-0.json'), article(0));
  await writeJsonAtomic(safeDataPath(root, '04-analysis-queue', 'completed', 'canonical-0.json'), decision(0));
  const [task] = await prepareOfficialVerificationTasks(root);
  const current = decision(0);
  current.summary = 'A newer independently ranked interpretation.';
  current.analyzedAt = '2026-08-31T13:00:00.000Z';
  await writeJsonAtomic(safeDataPath(root, '04-analysis-queue', 'completed', 'canonical-0.json'), current);
  await assert.rejects(acceptOfficialVerification(root, result(task!, 'verified')), /task is stale/);
  assert.equal((await readJson<AnalysisDecisionRecord>(safeDataPath(root, '04-analysis-queue', 'completed', 'canonical-0.json'))).summary, current.summary);
  assert.equal(await pathExists(safeDataPath(root, '04-official-verification', 'history', `stale-${task!.id}.json`)), true);
});

test('known official conflict remains unauthorized and blocks both blog and social', () => {
  const task: OfficialVerificationTaskRecord = {
    version: 1, id: 'official-verification-ranking-canonical-0', portfolioRank: 1,
    selectedAt: '2026-08-31T12:20:00.000Z', decision: decision(0), article: article(0),
  };
  const official = validateOfficialVerification(result(task, 'conflicting'), task);
  const gate = { portfolioRank: 1, selectedAt: task.selectedAt, official, socialStatus: 'conflicting' as const };
  assert.equal(publicationModeForOpportunity({ ...task.decision, verificationGate: gate }, task.article), undefined);
  assert.throws(() => assertArticleVerificationPublishable(gate), /conflicts/);
  assert.throws(() => assertSocialVerificationSatisfied(gate), /conflicts/);
  assert.throws(() => markSocialFactsVerified(gate, 'editor@example.com', 1), /cannot override/);
});

test('unknown hosts and configured publishers cannot be misrepresented as official evidence', () => {
  const task: OfficialVerificationTaskRecord = {
    version: 1, id: 'official-verification-ranking-canonical-0', portfolioRank: 1,
    selectedAt: '2026-08-31T12:20:00.000Z', decision: decision(0), article: article(0),
  };
  const invalid = result(task, 'verified');
  invalid.evidence[0]!.url = 'https://awardwallet.com/blog/story';
  invalid.claimOutcomes[0]!.officialUrls = ['https://awardwallet.com/blog/story'];
  assert.throws(() => validateOfficialVerification(invalid, task), /Unknown official evidence host/);

  const spoof = result(task, 'verified');
  spoof.evidence[0] = { url: 'https://unrelated.example/program', owner: 'Delta Air Lines', sourceType: 'airline' };
  spoof.attemptedUrls = ['https://unrelated.example/program'];
  spoof.claimOutcomes[0]!.officialUrls = ['https://unrelated.example/program'];
  assert.throws(() => validateOfficialVerification(spoof, task), /Unknown official evidence host/);
});

test('claim conflicts force overall conflict and evidence URLs are fully traceable', () => {
  const task: OfficialVerificationTaskRecord = {
    version: 1, id: 'official-verification-ranking-canonical-0', portfolioRank: 1,
    selectedAt: '2026-08-31T12:20:00.000Z', decision: decision(0), article: article(0),
  };
  const mislabeled = result(task, 'conflicting');
  mislabeled.status = 'inconclusive';
  assert.throws(() => validateOfficialVerification(mislabeled, task), /requires overall conflicting/);

  const unattempted = result(task, 'verified');
  unattempted.attemptedUrls = [];
  assert.throws(() => validateOfficialVerification(unattempted, task), /must appear in attemptedUrls/);

  const unrecorded = result(task, 'verified');
  unrecorded.claimOutcomes[0]!.officialUrls = ['https://news.delta.com/other'];
  assert.throws(() => validateOfficialVerification(unrecorded, task), /was not recorded/);
});

test('social release rejects forged verification state and stale factual approval', () => {
  const task: OfficialVerificationTaskRecord = {
    version: 1, id: 'official-verification-ranking-canonical-0', portfolioRank: 1,
    selectedAt: '2026-08-31T12:20:00.000Z', decision: decision(0), article: article(0),
  };
  const conflicting = validateOfficialVerification(result(task, 'conflicting'), task);
  assert.throws(() => assertSocialVerificationSatisfied({
    portfolioRank: 1, selectedAt: task.selectedAt, official: conflicting, socialStatus: 'verified',
    factsVerifiedBy: 'editor@example.com', factsVerifiedAt: '2026-08-31T13:00:00.000Z', factsVerificationRevision: 2,
  }, 2), /conflicts/);

  const unavailable = validateOfficialVerification(result(task, 'unavailable'), task);
  assert.throws(() => assertSocialVerificationSatisfied({
    portfolioRank: 1, selectedAt: task.selectedAt, official: unavailable, socialStatus: 'verified',
  }, 2), /actor, timestamp, or current revision/);
  assert.throws(() => assertSocialVerificationSatisfied({
    portfolioRank: 1, selectedAt: task.selectedAt, official: unavailable, socialStatus: 'verified',
    factsVerifiedBy: 'editor@example.com', factsVerifiedAt: '2026-08-31T13:00:00.000Z', factsVerificationRevision: 1,
  }, 2), /actor, timestamp, or current revision/);
});

test('official conflicts have an audited reanalysis and reverification path', async () => {
  const root = join(await mkdtemp(join(tmpdir(), 'creddy-conflict-reopen-')), 'creddy');
  await initializeCreddyDataRoot(root);
  for (let index = 0; index < 6; index += 1) {
    await writeJsonAtomic(safeDataPath(root, '03-canonical-news', 'approved', `canonical-${index}.json`), article(index));
    await writeJsonAtomic(safeDataPath(root, '04-analysis-queue', 'completed', `canonical-${index}.json`), decision(index));
  }
  const initialTasks = await prepareOfficialVerificationTasks(root);
  const task = initialTasks.find((item) => item.decision.canonicalId === 'canonical-4')!;
  const conflicted = await acceptOfficialVerification(root, result(task, 'conflicting'));
  const analysisTask = await reopenConflictingVerification(root, {
    decisionId: conflicted.id,
    reopenedBy: 'editor@example.com',
    reason: 'Correct the contradicted material claim and regenerate every public format.',
  }, new Date('2026-08-31T14:00:00.000Z'));
  assert.match(analysisTask.queueRunId ?? '', /^correction-canonical-4-/);
  assert.equal(analysisTask.correctionContext?.originalPortfolioRank, task.portfolioRank);
  assert.equal(analysisTask.correctionContext?.priorOfficialVerification.claimOutcomes[0]?.status, 'conflicting');
  assert.equal(analysisTask.correctionContext?.reason, 'Correct the contradicted material claim and regenerate every public format.');
  assert.equal(await pathExists(safeDataPath(root, '04-analysis-queue', 'pending', 'canonical-4.json')), true);
  assert.equal((await readJson<AnalysisDecisionRecord>(safeDataPath(root, '04-analysis-queue', 'completed', 'canonical-4.json'))).verificationGate, undefined);
  assert.equal(await pathExists(safeDataPath(root, '04-official-verification', 'completed', `${task.id}.json`)), false);
  assert.equal((await listJsonFiles(safeDataPath(root, '04-official-verification', 'history'))).length, 1);
  await assert.rejects(() => prepareOfficialVerificationTasks(root), /Finish the audited Agent 03 conflict correction/);
  const corrected = {
    ...decision(4),
    analyzedAt: '2026-08-31T14:01:00.000Z',
    claims: [{ field: 'material_change', value: 'Corrected official value', sourceRecordIds: ['raw-4'], confidence: 68 }],
  };
  corrected.editorialPriorityScore = calculateEditorialPriorityScore(corrected);
  await assert.rejects(() => acceptAnalysisDecision(root, { ...corrected, analyzedAt: 'not-a-date' }), /produced after/);
  await assert.rejects(() => acceptAnalysisDecision(root, { ...corrected, analyzedAt: '2026-08-31T14:00:00.000Z' }), /produced after/);
  await acceptAnalysisDecision(root, corrected);
  const [retry] = await prepareOfficialVerificationTasks(root);
  assert.equal((await prepareOfficialVerificationTasks(root)).length, 1);
  assert.equal(retry?.decision.canonicalId, 'canonical-4');
  assert.equal(retry?.decision.claims[0]?.value, 'Corrected official value');
  assert.equal(retry?.decision.verificationGate, undefined);
  assert.equal(retry?.portfolioRank, task.portfolioRank);
});
