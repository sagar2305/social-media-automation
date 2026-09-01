import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

import { beginHourlyRun, finishHourlyRun, recordWithheldNewsItems, selectNewWithheldNewsItems } from './hourly-orchestrator.js';
import { initializeCreddyDataRoot, listJsonFiles, readJson, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import type { AnalysisDecisionRecord, CanonicalNewsRecord } from './pipeline-types.js';
import { listPublicationDecisions, publicationModeForOpportunity } from './publication-policy.js';
import { runPublishStage } from './publish-stage.js';
import { autoPublishWebsiteArticle } from './article-approval-service.js';
import type { BlotatoApi } from './blotato-client.js';
import {
  authorizeRollingProduction,
  passesUrgentPreGate,
  reconcileRollingEditorialLedger,
  newsProjectionCandidateIds,
  selectDailyEditorialSlate,
  verificationCandidateIds,
  type RollingEditorialRecord,
} from './rolling-editorial.js';

const NOW = new Date('2026-09-01T12:00:00.000Z'); // 08:00 America/New_York

function article(index: number): CanonicalNewsRecord {
  return {
    version: 1, id: `raw-${index}`, runId: 'run', sourceId: 'the-points-guy', sourceName: 'The Points Guy',
    sourceTier: 'B', factualUse: 'discovery_and_confirmation', originalUrl: `https://thepointsguy.com/news/story-${index}`,
    canonicalUrl: `https://thepointsguy.com/news/story-${index}`, title: `Story ${index}`, markdown: `Material story ${index}`,
    contentHash: `content-${index}`, titleFingerprint: `story-${index}`,
    publishedAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    fetchedAt: new Date(NOW.getTime() - 30 * 60 * 1000).toISOString(), providerMetadata: {},
    qualification: { qualifies: true, matchedKeywords: ['points'] }, canonicalId: `canonical-${index}`,
    evidenceRecordIds: [`raw-${index}`], cleanedMarkdown: `Material story ${index}`,
    deduplicatedAt: new Date(NOW.getTime() - 20 * 60 * 1000).toISOString(),
  };
}

function decision(index: number, urgent = false): AnalysisDecisionRecord {
  const categories: NonNullable<AnalysisDecisionRecord['portfolioCategory']>[] = [
    'card_offer', 'loyalty_news', 'redemption', 'travel_development', 'evergreen_education',
  ];
  const score = urgent ? 95 : 90 - index;
  const checkedAt = new Date(NOW.getTime() - 10 * 60 * 1000).toISOString();
  return {
    version: 1, id: `ranking-canonical-${index}`, canonicalId: `canonical-${index}`, analyzedAt: checkedAt,
    market: 'US', headline: `Material points story ${index}`, summary: 'Actionable points news.',
    eventType: 'program_change', topic: 'points', affectedPrograms: [`Program ${index % 3}`], requiredAction: null,
    expiry: null, claims: [
      { field: 'change', value: `Change ${index}`, sourceRecordIds: [`raw-${index}`], confidence: 95 },
      ...(urgent ? [{ field: 'event_occurred_at', value: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(), sourceRecordIds: [`raw-${index}`], confidence: 95 }] : []),
    ],
    productFitScore: score, popularityScore: score, rubricVersion: 'creddy-ranking-v3',
    viralPotential: {
      score, hookStrength: score, audienceBreadth: score, financialMagnitude: score, novelty: score,
      urgency: score, practicalUtility: score, visualPotential: score, discussionPotential: score,
      emotionalAspiration: score, shareSavePotential: score, reasons: ['Material and actionable'],
    },
    channelScores: { instagramTikTok: score, blogSeo: score, newsletter: score, evergreen: 75 },
    freshnessScore: score, editorialPriorityScore: score, editorialDisposition: 'produce', verificationState: 'ready',
    verificationRequirements: [], hookType: 'program_change', hookRationale: 'Broad member impact.',
    portfolioCategory: categories[index % categories.length], importanceScore: score, confidenceScore: score,
    importanceReasons: ['Material impact'], confidenceReasons: ['Official evidence'], materialConflict: false,
    conflictChangesMessage: false, verificationExhausted: true, route: 'auto_process', rejectionReasons: [],
    evidenceRecordIds: [`raw-${index}`], analysisBatchId: 'batch-current', analysisInputHash: `hash-${index}`,
    freshnessClass: urgent ? 'breaking' : 'timely', eventOccurredAt: new Date(NOW.getTime() - 60 * 60 * 1000).toISOString(),
    materialEventType: urgent ? 'issuer_or_program_change' : undefined,
    verificationGate: {
      portfolioRank: index + 1, selectedAt: checkedAt, socialStatus: 'verified',
      official: {
        version: 1, id: `official-${index}`, decisionId: `ranking-canonical-${index}`, canonicalId: `canonical-${index}`,
        checkedAt, status: 'verified', attemptedUrls: [`https://official.example/${index}`],
        evidence: [{ url: `https://official.example/${index}`, owner: 'Official program', sourceType: 'loyalty_program' }],
        claimOutcomes: [
          { field: 'change', status: 'verified', officialUrls: [`https://official.example/${index}`], notes: 'Confirmed.' },
          ...(urgent ? [{ field: 'event_occurred_at', status: 'verified' as const, officialUrls: [`https://official.example/${index}`], notes: 'Confirmed.' }] : []),
        ],
        remainingRequirements: [], failureReasons: [],
      },
    },
  };
}

async function rootWith(count: number, urgent = false): Promise<string> {
  const root = join(await mkdtemp(join(tmpdir(), 'creddy-rolling-')), 'data');
  await initializeCreddyDataRoot(root);
  for (let index = 0; index < count; index += 1) {
    await writeJsonAtomic(safeDataPath(root, '03-canonical-news', 'approved', `canonical-${index}.json`), article(index));
    await writeJsonAtomic(safeDataPath(root, '01-raw', `raw-${index}.json`), article(index));
    await writeJsonAtomic(safeDataPath(root, '04-analysis-queue', 'completed', `canonical-${index}.json`), decision(index, urgent));
  }
  return root;
}

async function writeScheduledBank(root: string, selected: AnalysisDecisionRecord, id: string, scheduledFor: Date): Promise<void> {
  const video = join(root, `${id}.mp4`);
  await writeFile(video, 'video');
  const content = {
    version: 1 as const, analysisBatchId: selected.analysisBatchId, productionAuthorization: selected.productionAuthorization,
    verificationGate: selected.verificationGate, distributionMode: selected.productionAuthorization!.distributionMode,
    id, analysisId: selected.id, canonicalId: selected.canonicalId, createdAt: NOW.toISOString(), audience: 'US users',
    slot: 'act_now' as const, hook: 'Current authorized story', scriptLines: ['Current authorized story.', 'Check the terms.'],
    caption: 'Current authorized story.', hashtags: [], cta: { label: 'Open Creddy', deepLink: 'creddy://home' },
    imagePrompts: [], brief: 'Brief', sourceUrls: ['https://example.com'], factualClaims: selected.claims,
  };
  const bank = {
    version: 1 as const, analysisBatchId: selected.analysisBatchId, productionAuthorization: selected.productionAuthorization,
    verificationGate: selected.verificationGate, id, contentPackageId: id, createdAt: NOW.toISOString(), status: 'scheduled' as const,
    revision: 1, narratedVideoPath: video, approvedBy: selected.productionAuthorization!.approvalMode === 'auto_urgent' ? 'policy:auto_urgent' : 'editor',
    approvedAt: NOW.toISOString(), approvalMode: selected.productionAuthorization!.approvalMode,
    destinations: [{ format: 'narrated' as const, platform: 'instagram' as const, account: 'creddy', scheduledFor: scheduledFor.toISOString(), status: 'pending' as const }],
  };
  await writeJsonAtomic(safeDataPath(root, '06-content-packages', `${id}.json`), content);
  await writeJsonAtomic(safeDataPath(root, '11-scheduled', `${id}.json`), bank);
}

function countingPublisher(): { client: BlotatoApi; calls: { count: number } } {
  const calls = { count: 0 };
  return {
    calls,
    client: {
      scheduleVideo: async () => { calls.count += 1; return { submissionId: `submission-${calls.count}`, mediaUrl: 'https://media.example/video' }; },
      getPostStatus: async () => ({ status: 'scheduled' as const }),
    },
  };
}

test('completed rankings cannot reach Agent 04 without explicit rolling authorization', async () => {
  const root = await rootWith(1);
  const ranked = await readJson<AnalysisDecisionRecord>(safeDataPath(root, '04-analysis-queue', 'completed', 'canonical-0.json'));
  assert.equal(publicationModeForOpportunity(ranked, article(0), NOW), undefined);
  assert.deepEqual(await listPublicationDecisions(root), []);
});

test('daily rolling selection is durable, diversified, and capped at five', async () => {
  const root = await rootWith(7);
  const first = await selectDailyEditorialSlate(root, NOW);
  const second = await selectDailyEditorialSlate(root, new Date(NOW.getTime() + 60 * 60 * 1000));
  assert.equal(first?.canonicalIds.length, 5);
  assert.deepEqual(second, first);
  assert.equal((await listJsonFiles(safeDataPath(root, '05-editorial-ledger', 'daily-selections'))).length, 1);
  const authorized = await authorizeRollingProduction(root, NOW);
  assert.equal(authorized.daily.length, 5);
  assert.equal((await listPublicationDecisions(root)).length, 5);
});

test('a changed decision hash invalidates an existing production opportunity', async () => {
  const root = await rootWith(1);
  await authorizeRollingProduction(root, NOW);
  assert.equal((await listPublicationDecisions(root)).length, 1);
  const path = safeDataPath(root, '04-analysis-queue', 'completed', 'canonical-0.json');
  const changed = await readJson<AnalysisDecisionRecord>(path);
  changed.summary = 'The accepted factual message changed after selection.';
  await writeJsonAtomic(path, changed);
  assert.equal((await listPublicationDecisions(root)).length, 0);
});

test('a new analysis-input revision resets nonterminal channel state but preserves published state', async () => {
  const root = await rootWith(1);
  await authorizeRollingProduction(root, NOW);
  await reconcileRollingEditorialLedger(root, NOW);
  const ledgerPath = safeDataPath(root, '05-editorial-ledger', 'items', 'canonical-0.json');
  const authorized = await readJson<RollingEditorialRecord>(ledgerPath);
  authorized.channels.news = 'published';
  await writeJsonAtomic(ledgerPath, authorized);
  const decisionPath = safeDataPath(root, '04-analysis-queue', 'completed', 'canonical-0.json');
  const next = await readJson<AnalysisDecisionRecord>(decisionPath);
  next.analysisInputHash = 'hash-revision-b';
  delete next.productionAuthorization;
  await writeJsonAtomic(decisionPath, next);
  const [reconciled] = await reconcileRollingEditorialLedger(root, new Date(NOW.getTime() + 60 * 60 * 1000));
  assert.equal(reconciled.channels.news, 'published');
  assert.equal(reconciled.channels.blog, 'active');
  assert.equal(reconciled.channels.social, 'active');
});

test('News first-seen freshness persists for unchanged input and resets only for newly fetched revision evidence', async () => {
  const root = await rootWith(1);
  await reconcileRollingEditorialLedger(root, NOW);
  const ledgerPath = safeDataPath(root, '05-editorial-ledger', 'items', 'canonical-0.json');
  const old = await readJson<RollingEditorialRecord>(ledgerPath);
  old.firstSeenAt = new Date(NOW.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();
  await writeJsonAtomic(ledgerPath, old);

  await reconcileRollingEditorialLedger(root, NOW);
  assert.deepEqual(await newsProjectionCandidateIds(root, NOW), []);
  assert.equal((await readJson<RollingEditorialRecord>(ledgerPath)).firstSeenAt, old.firstSeenAt);

  const revisionFetchedAt = new Date(NOW.getTime() - 5 * 60 * 1000).toISOString();
  const revisionEvidence = { ...article(0), id: 'raw-revision', fetchedAt: revisionFetchedAt };
  await writeJsonAtomic(safeDataPath(root, '01-raw', 'raw-revision.json'), revisionEvidence);
  const articlePath = safeDataPath(root, '03-canonical-news', 'approved', 'canonical-0.json');
  const revisedArticle = await readJson<CanonicalNewsRecord>(articlePath);
  revisedArticle.fetchedAt = revisionFetchedAt;
  revisedArticle.evidenceRecordIds = ['raw-0', 'raw-revision'];
  await writeJsonAtomic(articlePath, revisedArticle);
  const decisionPath = safeDataPath(root, '04-analysis-queue', 'completed', 'canonical-0.json');
  const revisedDecision = await readJson<AnalysisDecisionRecord>(decisionPath);
  revisedDecision.analysisInputHash = 'hash-revision-with-new-evidence';
  revisedDecision.evidenceRecordIds = ['raw-0', 'raw-revision'];
  revisedDecision.claims = revisedDecision.claims.map((claim) => ({ ...claim, sourceRecordIds: ['raw-0', 'raw-revision'] }));
  await writeJsonAtomic(decisionPath, revisedDecision);

  assert.deepEqual(await newsProjectionCandidateIds(root, NOW), ['canonical-0']);
  assert.equal((await readJson<RollingEditorialRecord>(ledgerPath)).firstSeenAt, revisionFetchedAt);
});

test('human approval cannot deliver after the current evidence-bound authorization changes', async () => {
  const root = await rootWith(1);
  await authorizeRollingProduction(root, NOW);
  const path = safeDataPath(root, '04-analysis-queue', 'completed', 'canonical-0.json');
  const selected = await readJson<AnalysisDecisionRecord>(path);
  await writeScheduledBank(root, selected, 'stale-human', new Date(NOW.getTime() + 60 * 1000));
  selected.summary = 'Evidence changed after the human approval.';
  await writeJsonAtomic(path, selected);
  const publisher = countingPublisher();
  const result = await runPublishStage(root, publisher.client, NOW, 15);
  assert.equal(publisher.calls.count, 0);
  assert.equal(result.failedCount, 1);
  assert.match(result.errors[0]!, /authorization is stale/);
});

test('urgent policy allows at most two blogs per New York day and one social package per six hours', async () => {
  const root = await rootWith(3, true);
  const result = await authorizeRollingProduction(root, NOW);
  assert.equal(result.urgent.length, 2);
  assert.equal(result.urgent.filter((item) => item.distributionMode === 'article_and_social').length, 1);
  assert.equal(result.urgent.filter((item) => item.distributionMode === 'article_only').length, 1);
  assert.equal(result.daily.some((item) => result.urgent.some((urgent) => urgent.canonicalId === item.canonicalId)), false);
  const repeated = await authorizeRollingProduction(root, new Date(NOW.getTime() + 5 * 60 * 1000));
  assert.equal(repeated.urgent.length, 0);
});

test('expired urgent approval cannot submit on a later Agent 8 retry', async () => {
  const root = await rootWith(1, true);
  await authorizeRollingProduction(root, NOW);
  const selected = await readJson<AnalysisDecisionRecord>(safeDataPath(root, '04-analysis-queue', 'completed', 'canonical-0.json'));
  const retryAt = new Date(NOW.getTime() + 13 * 60 * 60 * 1000);
  await writeScheduledBank(root, selected, 'expired-urgent', new Date(retryAt.getTime() + 60 * 1000));
  const publisher = countingPublisher();
  const result = await runPublishStage(root, publisher.client, retryAt, 15);
  assert.equal(publisher.calls.count, 0);
  assert.equal(result.failedCount, 1);
  assert.match(result.errors[0]!, /authorization is stale|expired/);
});

test('expired urgent article cannot reach the CMS publish callback', async () => {
  const root = await rootWith(1, true);
  await authorizeRollingProduction(root, NOW);
  const selected = await readJson<AnalysisDecisionRecord>(safeDataPath(root, '04-analysis-queue', 'completed', 'canonical-0.json'));
  const id = 'expired-urgent-article';
  const preview = safeDataPath(root, '06-content-packages', 'articles', id, 'index.html');
  await mkdir(dirname(preview), { recursive: true });
  await writeFile(preview, '<!doctype html><title>Urgent article</title>');
  await writeJsonAtomic(safeDataPath(root, '06-content-packages', `${id}.json`), {
    id, analysisBatchId: selected.analysisBatchId, productionAuthorization: selected.productionAuthorization,
    verificationGate: selected.verificationGate, article: { slug: 'expired-urgent-article' },
  });
  await writeJsonAtomic(safeDataPath(root, '09-pending-approval', `${id}.json`), {
    version: 1, analysisBatchId: selected.analysisBatchId, productionAuthorization: selected.productionAuthorization,
    verificationGate: selected.verificationGate, id, contentPackageId: id, createdAt: NOW.toISOString(), status: 'pending_review',
    revision: 1, articlePreviewPath: preview, articleReview: { status: 'pending_review', blockers: [] },
  });
  let mutations = 0;
  const retryAt = new Date(NOW.getTime() + 13 * 60 * 60 * 1000);
  await assert.rejects(autoPublishWebsiteArticle({
    root, id, now: () => retryAt,
    publish: async () => { mutations += 1; return { published: 1, skipped: 0, failures: [] }; },
  }), /could not publish/);
  assert.equal(mutations, 0);
});

test('urgent pre-gate rejects editorial rejects and unbound event times but admits corroboration candidates', () => {
  const base = decision(0, true);
  const record = {
    version: 1 as const, canonicalId: base.canonicalId, decisionId: base.id, analysisInputHash: base.analysisInputHash!,
    decisionHash: 'x', officialVerificationHash: 'x', firstSeenAt: article(0).fetchedAt, lastSeenAt: article(0).fetchedAt,
    sourcePublishedAt: article(0).publishedAt, eventOccurredAt: base.eventOccurredAt!, freshnessClass: 'breaking' as const,
    hardExpiresAt: new Date(NOW.getTime() + 24 * 60 * 60 * 1000).toISOString(), basePriority: 95,
    effectivePriority: 95, effectiveFreshness: 95, lastCalculatedAt: NOW.toISOString(),
    channels: { news: 'active' as const, blog: 'active' as const, social: 'active' as const },
  };
  const rejected = { ...base, route: 'rejected' as const, editorialDisposition: 'reject' as const, rejectionReasons: ['Not suitable.'] };
  assert.equal(passesUrgentPreGate(record, rejected, article(0), NOW), false);
  const reverify = { ...base, route: 'reverify' as const, verificationState: 'official_source_needed' as const, verificationRequirements: ['Verify.'] };
  assert.equal(passesUrgentPreGate(record, reverify, article(0), NOW), true);
  assert.equal(passesUrgentPreGate(record, { ...reverify, conflictChangesMessage: true }, article(0), NOW), false);
  const unbound = { ...base, claims: base.claims.filter((claim) => claim.field !== 'event_occurred_at') };
  assert.equal(passesUrgentPreGate(record, unbound, article(0), NOW), false);
});

test('trusted missing-date News is eligible before 06:00 without routine official verification', async () => {
  const root = await rootWith(1);
  const early = new Date('2026-09-01T09:00:00.000Z'); // 05:00 America/New_York
  const articlePath = safeDataPath(root, '03-canonical-news', 'approved', 'canonical-0.json');
  const rawPath = safeDataPath(root, '01-raw', 'raw-0.json');
  const currentArticle = await readJson<CanonicalNewsRecord>(articlePath);
  delete currentArticle.publishedAt;
  currentArticle.fetchedAt = new Date(early.getTime() - 30 * 60 * 1000).toISOString();
  await writeJsonAtomic(articlePath, currentArticle);
  await writeJsonAtomic(rawPath, currentArticle);
  const decisionPath = safeDataPath(root, '04-analysis-queue', 'completed', 'canonical-0.json');
  const currentDecision = await readJson<AnalysisDecisionRecord>(decisionPath);
  currentDecision.route = 'reverify';
  currentDecision.verificationState = 'official_source_needed';
  currentDecision.verificationRequirements = ['Routine issuer confirmation'];
  delete currentDecision.verificationGate;
  await writeJsonAtomic(decisionPath, currentDecision);
  await reconcileRollingEditorialLedger(root, early);
  assert.deepEqual(await verificationCandidateIds(root, early), []);
  assert.deepEqual(await newsProjectionCandidateIds(root, early), ['canonical-0']);
  assert.equal(await selectDailyEditorialSlate(root, early), undefined);
});

test('unknown search publishers and known conflicts cannot enter the hourly News projection', async () => {
  const root = await rootWith(1);
  const currentArticle = article(0);
  currentArticle.sourceId = 'topic-search:card-offer';
  currentArticle.sourceName = 'Unknown Publisher';
  currentArticle.originalUrl = 'https://unknown.example/story';
  currentArticle.canonicalUrl = currentArticle.originalUrl;
  await writeJsonAtomic(safeDataPath(root, '03-canonical-news', 'approved', 'canonical-0.json'), currentArticle);
  await writeJsonAtomic(safeDataPath(root, '01-raw', 'raw-0.json'), currentArticle);
  await reconcileRollingEditorialLedger(root, NOW);
  assert.deepEqual(await newsProjectionCandidateIds(root, NOW), []);
  const decisionPath = safeDataPath(root, '04-analysis-queue', 'completed', 'canonical-0.json');
  const conflicted = await readJson<AnalysisDecisionRecord>(decisionPath);
  conflicted.materialConflict = true;
  conflicted.conflictChangesMessage = true;
  await writeJsonAtomic(decisionPath, conflicted);
  assert.deepEqual(await newsProjectionCandidateIds(root, NOW), []);
});

test('two independent trusted publications can authorize and revalidate unattended urgent delivery', async () => {
  const root = await rootWith(1, true);
  const second = { ...article(0), id: 'raw-second', sourceId: 'doctor-of-credit', sourceName: 'Doctor of Credit',
    originalUrl: 'https://www.doctorofcredit.com/material-change', canonicalUrl: 'https://www.doctorofcredit.com/material-change' };
  await writeJsonAtomic(safeDataPath(root, '01-raw', 'raw-second.json'), second);
  const decisionPath = safeDataPath(root, '04-analysis-queue', 'completed', 'canonical-0.json');
  const corroborated = await readJson<AnalysisDecisionRecord>(decisionPath);
  corroborated.route = 'reverify';
  corroborated.verificationState = 'independent_confirmation_needed';
  corroborated.verificationRequirements = ['Two trusted publications must agree.'];
  corroborated.evidenceRecordIds = ['raw-0', 'raw-second'];
  corroborated.claims = corroborated.claims.map((claim) => ({ ...claim, sourceRecordIds: ['raw-0', 'raw-second'] }));
  delete corroborated.verificationGate;
  await writeJsonAtomic(decisionPath, corroborated);
  const authorized = await authorizeRollingProduction(root, NOW, null);
  assert.equal(authorized.urgent.length, 1);
  const selected = await readJson<AnalysisDecisionRecord>(decisionPath);
  await writeScheduledBank(root, selected, 'corroborated-urgent', new Date(NOW.getTime() + 60 * 1000));
  const publisher = countingPublisher();
  const result = await runPublishStage(root, publisher.client, NOW, 15);
  assert.equal(result.failedCount, 0);
  assert.equal(publisher.calls.count, 1);
});

test('cross-publisher copies of one material event share one urgent claim', async () => {
  const root = await rootWith(2, true);
  const path = safeDataPath(root, '04-analysis-queue', 'completed', 'canonical-1.json');
  const duplicate = await readJson<AnalysisDecisionRecord>(path);
  const original = decision(0, true);
  duplicate.affectedPrograms = original.affectedPrograms;
  duplicate.eventOccurredAt = new Date(Date.parse(original.eventOccurredAt!) + 15 * 60 * 1000).toISOString();
  duplicate.claims = duplicate.claims.map((claim) => claim.field === 'event_occurred_at' ? { ...claim, value: duplicate.eventOccurredAt! } : claim);
  duplicate.claims.push({ field: 'publisher_specific_detail', value: 'Extra qualifier from the second publisher', sourceRecordIds: ['raw-1'], confidence: 95 });
  duplicate.verificationGate!.official.claimOutcomes = duplicate.claims.map((claim) => ({
    field: claim.field, status: 'verified', officialUrls: ['https://official.example/1'], notes: 'Confirmed.',
  }));
  await writeJsonAtomic(path, duplicate);
  const result = await authorizeRollingProduction(root, NOW);
  assert.equal(result.urgent.length, 1);
});

test('daily selection waits for current rankings until the 09:00 ET fallback', async () => {
  const root = await rootWith(1);
  await writeJsonAtomic(safeDataPath(root, '04-analysis-queue', 'pending', 'pending.json'), { id: 'pending' });
  assert.equal(await selectDailyEditorialSlate(root, NOW), undefined);
  assert.equal((await listJsonFiles(safeDataPath(root, '05-editorial-ledger', 'daily-selections'))).length, 0);
  const fallback = await selectDailyEditorialSlate(root, new Date('2026-09-01T13:00:00.000Z'));
  assert.equal(fallback?.analysisPendingAtSelection, 1);
});

test('unavailable official checks use bounded backoff instead of consuming every hourly slate', async () => {
  const root = await rootWith(1);
  const path = safeDataPath(root, '04-analysis-queue', 'completed', 'canonical-0.json');
  const unavailable = await readJson<AnalysisDecisionRecord>(path);
  unavailable.verificationGate!.official.status = 'unavailable';
  unavailable.verificationGate!.official.checkedAt = NOW.toISOString();
  unavailable.verificationGate!.official.claimOutcomes = unavailable.claims.map((claim) => ({
    field: claim.field, status: 'not_found' as const, officialUrls: [], notes: 'Official page unavailable.',
  }));
  unavailable.verificationGate!.official.evidence = [];
  unavailable.verificationGate!.official.remainingRequirements = ['Retry the official source.'];
  unavailable.verificationGate!.official.failureReasons = ['Official page unavailable.'];
  await writeJsonAtomic(path, unavailable);
  await writeJsonAtomic(
    safeDataPath(root, '04-official-verification', 'completed', 'unavailable-0.json'),
    unavailable.verificationGate!.official,
  );
  assert.deepEqual(await verificationCandidateIds(root, new Date(NOW.getTime() + 60 * 60 * 1000)), []);
});

test('unchanged withheld News is not repeated in the next hourly Slack digest', async () => {
  const root = await rootWith(1);
  const candidates = [{ id: 'canonical-0', headline: 'Withheld candidate', reason: 'Official verification is incomplete.' }];
  const first = await selectNewWithheldNewsItems(root, candidates);
  assert.equal(first.length, 1);
  await recordWithheldNewsItems(root, first, { sentAt: NOW.toISOString(), digestKey: '2026-09-01T12', ts: '1.2' });
  assert.deepEqual(await selectNewWithheldNewsItems(root, candidates), []);
});

test('hourly lease skips overlap and permits the next run after a durable finish', async () => {
  const root = await rootWith(0);
  const first = await beginHourlyRun(root, NOW);
  assert.ok(first);
  assert.equal(await beginHourlyRun(root, new Date(NOW.getTime() + 30 * 60 * 1000)), undefined);
  await finishHourlyRun(root, first.runId, undefined, new Date(NOW.getTime() + 31 * 60 * 1000));
  assert.ok(await beginHourlyRun(root, new Date(NOW.getTime() + 60 * 60 * 1000)));
});

test('freshness is recomputed without changing the immutable ranking record', async () => {
  const root = await rootWith(1);
  const before = await readJson<AnalysisDecisionRecord>(safeDataPath(root, '04-analysis-queue', 'completed', 'canonical-0.json'));
  const first = await reconcileRollingEditorialLedger(root, NOW);
  const later = await reconcileRollingEditorialLedger(root, new Date(NOW.getTime() + 13 * 24 * 60 * 60 * 1000));
  const after = await readJson<AnalysisDecisionRecord>(safeDataPath(root, '04-analysis-queue', 'completed', 'canonical-0.json'));
  assert.ok(first[0]!.effectiveFreshness > later[0]!.effectiveFreshness);
  assert.deepEqual(after, before);
});
