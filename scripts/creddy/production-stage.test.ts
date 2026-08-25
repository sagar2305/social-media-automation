import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { CREDDY_ARTICLE_DISCLOSURE } from './article-content.js';
import { initializeCreddyDataRoot, listJsonFiles, readJson, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import { buildProductionPackage, listPendingProductionTasks, prepareProductionPackages } from './production-stage.js';
import {
  CREDDY_PIPELINE_VERSION,
  type AnalysisDecisionRecord,
  type ContentDraftRecord,
  type ContentPackageRecord,
  type VisualPlanRecord,
} from './pipeline-types.js';
import { buildCreddyVideoScript } from './video-stage.js';

function draft(): ContentDraftRecord {
  const articleBody = Array.from({ length: 55 }, () =>
    'Check current award availability before transferring points because prices, space, eligibility, and program terms can change without notice.').join(' ');
  return {
    version: CREDDY_PIPELINE_VERSION, copyVersion: 'creddy-copy-v3', id: 'copy-analysis-1', analysisId: 'analysis-1', canonicalId: 'canonical-1',
    createdAt: '2026-08-19T12:30:00.000Z', audience: 'US rewards users', slot: 'understand',
    hook: 'Transfer bonus?', textScenes: ['A 20% bonus is reported.', 'Check the award first.', 'Verify current terms.'],
    narrationScript: 'A twenty percent transfer bonus is reported for eligible users. Check the exact award before moving points because availability can change. Review the current terms and remember that point transfers may be irreversible once submitted.',
    instagramCaption: 'Check the award first.', tiktokCaption: 'Seat first. Transfer second.',
    hashtags: ['#points', '#awardtravel', '#rewards'], cta: { label: 'Open Creddy', deepLink: 'creddy://rewards' },
    brief: 'Caution-first explainer.', sourceUrls: ['https://example.com/bonus'],
    factualClaims: [{ field: 'bonus', value: 20, sourceRecordIds: ['raw-1'], confidence: 90 }],
    article: {
      version: 'creddy-article-v1', designVersion: 'creddy-guides-v1', id: 'article-analysis-1',
      slug: 'transfer-bonus-guide', category: 'points_and_miles',
      title: 'How to Evaluate a Transfer Bonus Before Moving Points',
      dek: 'A practical guide to checking award space, current terms, and the real booking value before transferring points.',
      excerpt: 'Use a verification-first checklist before committing flexible rewards to an airline or hotel loyalty program.',
      seoTitle: 'How to Evaluate a Transfer Bonus — Creddy',
      seoDescription: 'Learn how to evaluate a transfer bonus, confirm award availability, compare booking costs, and review current program terms before moving points.',
      authorName: 'Creddy Editorial', createdAt: '2026-08-19T12:30:00.000Z', updatedAt: '2026-08-19T12:30:00.000Z',
      readingMinutes: 6, heroVisualId: 'hero-transfer', sourceUrls: ['https://example.com/bonus'],
      referralDisclosure: CREDDY_ARTICLE_DISCLOSURE,
      blocks: [
        { id: 'hero-block', type: 'visual', visualId: 'hero-transfer', caption: 'A transfer-planning overview.' },
        { id: 'takeaways', type: 'key_takeaways', title: 'What to know', items: ['A 20% bonus is reported.', 'Verify the award before transferring.'], claimFields: ['bonus'] },
        { id: 'availability-heading', type: 'heading', level: 2, text: 'Check the award first' },
        { id: 'availability-body', type: 'paragraph', text: articleBody, claimFields: ['bonus'] },
        { id: 'award-block', type: 'visual', visualId: 'award-space', caption: 'Award-space verification.' },
        { id: 'terms-heading', type: 'heading', level: 2, text: 'Review the current terms' },
        { id: 'terms-block', type: 'visual', visualId: 'terms-check', caption: 'A current-terms checklist.' },
        { id: 'subscribe', type: 'subscribe', title: 'Get practical Creddy guides', body: 'Receive plain-English rewards guidance.', consentLabel: 'I agree to receive Creddy editorial emails.' },
        { id: 'download', type: 'download', title: 'Track rewards with Creddy', body: 'Keep balances and decisions visible.', iosUrl: 'https://apps.apple.com/app/id6768603911', androidUrl: 'https://play.google.com/store/apps/details?id=com.thebrewapps.creddy' },
      ],
    },
  };
}

function decision(): AnalysisDecisionRecord {
  return {
    version: CREDDY_PIPELINE_VERSION, id: 'analysis-1', canonicalId: 'canonical-1', analyzedAt: '2026-08-19T12:20:00.000Z',
    market: 'US', headline: '20% transfer bonus', summary: 'Eligible members can receive a transfer bonus.',
    eventType: 'transfer_bonus', topic: 'points', affectedPrograms: ['Example Airline'], requiredAction: 'Check award space first.', expiry: '2026-08-30',
    claims: [{ field: 'bonus', value: 20, sourceRecordIds: ['raw-1'], confidence: 90 }],
    productFitScore: 90, popularityScore: 78, importanceScore: 82, confidenceScore: 90,
    rubricVersion: 'creddy-ranking-v3', viralPotential: {
      score: 70, hookStrength: 70, audienceBreadth: 70, financialMagnitude: 70, novelty: 70,
      urgency: 70, practicalUtility: 70, visualPotential: 70, discussionPotential: 70,
      emotionalAspiration: 70, shareSavePotential: 70, reasons: ['Useful transfer decision'],
    },
    channelScores: { instagramTikTok: 72, blogSeo: 80, newsletter: 76, evergreen: 85 },
    freshnessScore: 60, editorialPriorityScore: 78, editorialDisposition: 'evergreen', verificationState: 'ready',
    verificationRequirements: [], hookType: 'decision_rule', hookRationale: 'Readers can apply a concrete checklist.',
    portfolioCategory: 'evergreen_education', importanceReasons: ['Actionable'], confidenceReasons: ['Terms explicit'],
    materialConflict: false, conflictChangesMessage: false, verificationExhausted: true, route: 'evergreen_queue',
    rejectionReasons: [], evidenceRecordIds: ['raw-1'],
  };
}

function visualPlan(): VisualPlanRecord {
  const copy = draft();
  return {
    version: CREDDY_PIPELINE_VERSION, id: 'visual-copy-analysis-1', contentDraftId: copy.id,
    analysisId: copy.analysisId, canonicalId: copy.canonicalId, createdAt: '2026-08-19T12:40:00.000Z',
    format: '9:16', theme: 'ledger', characterPack: 'credit-card-rewards/creddy',
    cover: { headline: 'Transfer bonus?', subheadline: 'Check the award first' },
    scenes: [
      { sceneIndex: 0, text: copy.textScenes[0]!, role: 'hook', expression: 'rewards', emphasis: ['20%'], background: { mode: 'template' } },
      { sceneIndex: 1, text: copy.textScenes[1]!, role: 'context', expression: 'thinking', emphasis: ['award'], background: { mode: 'template' } },
      { sceneIndex: 2, text: copy.textScenes[2]!, role: 'caution', expression: 'worried', emphasis: ['terms'], background: { mode: 'template' } },
    ],
    visualBrief: 'Use a clear comparison layout.', safetyOverlays: ['Verify current terms'],
    sourceUrls: copy.sourceUrls, factualClaims: copy.factualClaims,
    articleVisuals: {
      version: 'creddy-article-visuals-v1', designVersion: 'creddy-guides-v1',
      assets: [
        ['hero-transfer', 'hero', 'hero-block', '16:9'],
        ['award-space', 'inline', 'award-block', '4:3'],
        ['terms-check', 'inline', 'terms-block', '4:3'],
      ].map(([id, usage, articleBlockId, aspectRatio]) => ({
        id: id!, usage: usage as 'hero' | 'inline', articleBlockId: articleBlockId!,
        assetType: 'licensed_photo' as const, aspectRatio: aspectRatio as '16:9' | '4:3',
        generationMode: 'supply' as const, altText: `Editorial visual for ${id}`,
        caption: `Approved ${id} visual.`, claimFields: [], provenance: 'Test fixture asset',
      })),
    },
  };
}

test('Agent 6 assembles one immutable package and exactly two render jobs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-production-'));
  await initializeCreddyDataRoot(root);
  await writeJsonAtomic(safeDataPath(root, '05-content-opportunities', 'evergreen', 'analysis-1.json'), decision());
  await writeJsonAtomic(safeDataPath(root, '06-content-drafts', `${draft().id}.json`), draft());
  await writeJsonAtomic(safeDataPath(root, '06-visual-plans', `${visualPlan().id}.json`), visualPlan());
  assert.equal((await listPendingProductionTasks(root)).length, 1);
  const result = await prepareProductionPackages(root, new Date('2026-08-19T13:00:00Z'));
  assert.equal(result.createdPackages, 1);
  assert.equal(result.createdVideoJobs, 2);
  assert.equal((await listPendingProductionTasks(root)).length, 0);
  assert.equal((await listJsonFiles(safeDataPath(root, '07-video-jobs'))).length, 2);
  const second = await prepareProductionPackages(root);
  assert.equal(second.createdVideoJobs, 0);
  assert.equal(second.skippedCount, 1);
});

test('Agent 6 ignores legacy and no-longer-verified visual plans', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-production-gate-'));
  await initializeCreddyDataRoot(root);
  const legacy = draft();
  delete legacy.copyVersion;
  await writeJsonAtomic(safeDataPath(root, '06-content-drafts', `${legacy.id}.json`), legacy);
  await writeJsonAtomic(safeDataPath(root, '06-visual-plans', `${visualPlan().id}.json`), visualPlan());
  await writeJsonAtomic(safeDataPath(root, '05-content-opportunities', 'evergreen', 'analysis-1.json'), decision());
  assert.equal((await listPendingProductionTasks(root)).length, 0);

  await writeJsonAtomic(safeDataPath(root, '06-content-drafts', `${draft().id}.json`), draft());
  const blocked = decision();
  blocked.verificationState = 'official_source_needed';
  blocked.route = 'reverify';
  await writeJsonAtomic(safeDataPath(root, '05-content-opportunities', 'evergreen', 'analysis-1.json'), blocked);
  assert.equal((await listPendingProductionTasks(root)).length, 0);
});

test('Agent 6 preserves narration, platform captions, theme, and evidence', () => {
  const content = buildProductionPackage({ draft: draft(), visualPlan: visualPlan() });
  assert.equal(content.narrationLines?.join(' '), draft().narrationScript);
  assert.equal(content.platformCaptions?.instagram, draft().instagramCaption);
  assert.equal(content.platformCaptions?.tiktok, draft().tiktokCaption);
  assert.equal(content.visualTheme, 'ledger');
  assert.deepEqual(content.factualClaims, draft().factualClaims);
  const script = buildCreddyVideoScript(content);
  assert.equal(script.filter((line) => line.startsWith('> ')).length, 3);
});

test('Agent 6 refuses visual plans that changed accepted evidence', () => {
  const visual = visualPlan();
  visual.factualClaims[0]!.value = 50;
  assert.throws(() => buildProductionPackage({ draft: draft(), visualPlan: visual }), /changed accepted evidence/);
});
