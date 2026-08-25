import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { initializeCreddyDataRoot, listJsonFiles, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import {
  CREDDY_PIPELINE_VERSION,
  type AnalysisDecisionRecord,
  type ContentDraftRecord,
  type VisualPlanRecord,
} from './pipeline-types.js';
import { acceptVisualPlan, listPendingVisualTasks, selectCreddyExpression, validateVisualPlan } from './visual-stage.js';

function draft(): ContentDraftRecord {
  return {
    version: CREDDY_PIPELINE_VERSION, distributionMode: 'article_and_social', copyVersion: 'creddy-copy-v3', id: 'copy-analysis-1', analysisId: 'analysis-1', canonicalId: 'canonical-1',
    createdAt: '2026-08-19T12:30:00.000Z', audience: 'US rewards users', slot: 'understand',
    hook: 'A transfer bonus can change the math',
    textScenes: ['A 20% transfer bonus is available.', 'Check award space before transferring.', 'Transfers may be irreversible.'],
    narrationScript: 'A transfer bonus can stretch points, but verify the actual award before moving anything. Search for the seat, compare the total price, and read the current terms. Transfers may be irreversible, so confirm availability and move only the amount needed for your planned booking.',
    instagramCaption: 'Check award space before moving points.', tiktokCaption: 'Seat first. Transfer second.',
    hashtags: ['#points', '#awardtravel', '#rewards'], cta: { label: 'Open Creddy', deepLink: 'creddy://rewards' },
    brief: 'Educational transfer warning.', sourceUrls: ['https://awardwallet.com/blog/bonus'],
    factualClaims: [{ field: 'bonus', value: 20, sourceRecordIds: ['raw-1'], confidence: 90 }],
    article: {
      version: 'creddy-article-v1', designVersion: 'creddy-guides-v1', id: 'article-analysis-1',
      slug: 'transfer-bonus-guide', category: 'points_and_miles', title: 'Transfer Bonus Guide',
      dek: 'A practical guide to checking award space before transferring points.',
      excerpt: 'Check availability and current terms before moving points.',
      seoTitle: 'Transfer Bonus Guide — Creddy', seoDescription: 'Learn how to evaluate a transfer bonus safely.',
      authorName: 'Creddy Editorial', createdAt: '2026-08-19T12:30:00.000Z', updatedAt: '2026-08-19T12:30:00.000Z',
      readingMinutes: 5, heroVisualId: 'hero-transfer', sourceUrls: ['https://awardwallet.com/blog/bonus'],
      referralDisclosure: 'Creddy may earn compensation from referral links. Editorial decisions remain independent.',
      blocks: [
        { id: 'hero-block', type: 'visual', visualId: 'hero-transfer', caption: 'Transfer planning overview.' },
        { id: 'award-block', type: 'visual', visualId: 'award-space', caption: 'Award-space verification.' },
        { id: 'terms-block', type: 'visual', visualId: 'terms-check', caption: 'Current-terms checklist.' },
      ],
    },
  };
}

function decision(): AnalysisDecisionRecord {
  return {
    version: CREDDY_PIPELINE_VERSION, id: 'analysis-1', canonicalId: 'canonical-1',
    analyzedAt: '2026-08-19T12:20:00.000Z', market: 'US', headline: '20% transfer bonus',
    summary: 'Eligible members can receive a transfer bonus.', eventType: 'transfer_bonus', topic: 'points',
    affectedPrograms: ['Example Airline'], requiredAction: 'Check award space first.', expiry: '2026-08-30',
    claims: [{ field: 'bonus', value: 20, sourceRecordIds: ['raw-1'], confidence: 90 }],
    productFitScore: 90, popularityScore: 78, importanceScore: 82, confidenceScore: 90,
    rubricVersion: 'creddy-ranking-v3',
    viralPotential: {
      score: 70, hookStrength: 70, audienceBreadth: 70, financialMagnitude: 70,
      novelty: 70, urgency: 70, practicalUtility: 70, visualPotential: 70,
      discussionPotential: 70, emotionalAspiration: 70, shareSavePotential: 70,
      reasons: ['Useful transfer decision'],
    },
    channelScores: { instagramTikTok: 72, blogSeo: 80, newsletter: 76, evergreen: 85 },
    freshnessScore: 60, editorialPriorityScore: 78, editorialDisposition: 'evergreen',
    verificationState: 'ready', verificationRequirements: [], hookType: 'decision_rule',
    hookRationale: 'Readers can apply a concrete checklist.', portfolioCategory: 'evergreen_education',
    importanceReasons: ['Actionable'], confidenceReasons: ['Terms explicit'], materialConflict: false,
    conflictChangesMessage: false, verificationExhausted: true, route: 'evergreen_queue',
    rejectionReasons: [], evidenceRecordIds: ['raw-1'],
  };
}

function plan(): VisualPlanRecord {
  const copy = draft();
  return {
    version: CREDDY_PIPELINE_VERSION, distributionMode: 'article_and_social', id: 'visual-copy-analysis-1', contentDraftId: copy.id,
    analysisId: copy.analysisId, canonicalId: copy.canonicalId, createdAt: '2026-08-19T12:40:00.000Z',
    format: '9:16', theme: 'editorial', characterPack: 'credit-card-rewards/creddy',
    cover: { headline: copy.hook, subheadline: 'Check the award first' },
    scenes: [
      { sceneIndex: 0, text: copy.textScenes[0]!, role: 'hook', expression: 'rewards', emphasis: ['20%'], background: { mode: 'template' } },
      { sceneIndex: 1, text: copy.textScenes[1]!, role: 'context', expression: 'thinking', emphasis: ['award space'], background: { mode: 'template' } },
      { sceneIndex: 2, text: copy.textScenes[2]!, role: 'caution', expression: 'worried', emphasis: ['irreversible'], background: { mode: 'template' } },
    ],
    visualBrief: 'Use restrained motion and readable text.', safetyOverlays: ['Verify current terms'],
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

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'creddy-visual-'));
  await initializeCreddyDataRoot(root);
  await writeJsonAtomic(safeDataPath(root, '05-content-opportunities', 'evergreen', 'analysis-1.json'), decision());
  await writeJsonAtomic(safeDataPath(root, '06-content-drafts', `${draft().id}.json`), draft());
  return root;
}

test('Agent 5 accepts a manifest-safe plan without creating video jobs', async () => {
  const root = await fixture();
  assert.equal((await listPendingVisualTasks(root)).length, 1);
  await acceptVisualPlan(root, plan());
  assert.equal((await listPendingVisualTasks(root)).length, 0);
  assert.equal((await listJsonFiles(safeDataPath(root, '06-visual-plans'))).length, 1);
  assert.equal((await listJsonFiles(safeDataPath(root, '07-video-jobs'))).length, 0);
});

test('Agent 5 ignores legacy or no-longer-verified Agent 4 drafts', async () => {
  const root = await fixture();
  const legacy = draft();
  delete legacy.copyVersion;
  await writeJsonAtomic(safeDataPath(root, '06-content-drafts', `${legacy.id}.json`), legacy);
  assert.equal((await listPendingVisualTasks(root)).length, 0);

  await writeJsonAtomic(safeDataPath(root, '06-content-drafts', `${draft().id}.json`), draft());
  const blocked = decision();
  blocked.verificationState = 'independent_confirmation_needed';
  blocked.route = 'reverify';
  await writeJsonAtomic(safeDataPath(root, '05-content-opportunities', 'evergreen', 'analysis-1.json'), blocked);
  assert.equal((await listPendingVisualTasks(root)).length, 0);
});

test('Agent 5 accepts the locked 3:4 Creddy slideshow format', () => {
  const base = plan();
  const slideshow = {
    ...base,
    format: '3:4' as const,
    phoneTemplateId: 'app_store_dark' as const,
    scenes: [
      base.scenes[0]!,
      base.scenes[1]!,
      base.scenes[2]!,
      { ...base.scenes[0]!, sceneIndex: 3, expression: 'curious' as const },
      { ...base.scenes[1]!, sceneIndex: 4, expression: 'pointing' as const },
      { ...base.scenes[2]!, sceneIndex: 5, role: 'cta' as const, expression: 'urgent' as const },
    ],
  };
  assert.equal(validateVisualPlan(slideshow).format, '3:4');
});

test('Agent 5 rejects a 3:4 slideshow that does not contain exactly six scenes', () => {
  assert.throws(
    () => validateVisualPlan({ ...plan(), format: '3:4' as const }),
    /exactly 6 scenes/,
  );
});

test('Agent 5 cannot invent an expression outside the Creddy manifest', () => {
  const invalid = plan();
  invalid.scenes[0]!.expression = '999-invented' as VisualPlanRecord['scenes'][number]['expression'];
  assert.throws(() => validateVisualPlan(invalid), /not present in the Creddy manifest/);
});

test('Agent 5 requires expression variety and maps scene meaning to approved poses', () => {
  const repetitive = plan();
  repetitive.scenes.forEach((scene) => { scene.expression = 'neutral'; });
  assert.throws(
    () => validateVisualPlan(repetitive),
    /at least two script-appropriate expressions|Adjacent Creddy slideshow scenes cannot repeat/,
  );
  assert.match(selectCreddyExpression({ role: 'context', text: 'Which card should you use?' }), /^(011|012|013|014|016|017|073|074|075)-/);
  assert.match(selectCreddyExpression({ role: 'caution', text: 'This benefit is ending soon.' }), /^(018|023|025|026|065|096)-/);
  assert.match(selectCreddyExpression({ role: 'fact', text: 'Earn more rewards and points.' }), /^(003|004|006|007|082|090|091|100)-/);
});

test('Agent 5 rejects repetitive six-slide slideshows permanently', () => {
  const base = plan();
  const repetitive: VisualPlanRecord = {
    ...base,
    format: '3:4',
    phoneTemplateId: 'app_store_dark',
    scenes: [0, 1, 2, 3, 4, 5].map((sceneIndex) => ({
      ...base.scenes[sceneIndex % 3]!, sceneIndex,
      role: sceneIndex === 0 ? 'hook' : sceneIndex === 5 ? 'cta' : 'context',
      expression: sceneIndex % 2 ? 'thinking' : 'neutral',
    })),
  };
  assert.throws(() => validateVisualPlan(repetitive), /at least five script-appropriate expressions/);

  const adjacent: VisualPlanRecord = {
    ...repetitive,
    scenes: ['neutral', 'waving', 'thinking', 'thinking', 'curious', 'urgent'].map((expression, sceneIndex) => ({
      ...base.scenes[sceneIndex % 3]!, sceneIndex,
      role: sceneIndex === 0 ? 'hook' : sceneIndex === 5 ? 'cta' : 'context',
      expression: expression as VisualPlanRecord['scenes'][number]['expression'],
    })),
  };
  assert.throws(() => validateVisualPlan(adjacent), /Adjacent Creddy slideshow scenes cannot repeat/);
});

test('Agent 5 cannot change Agent 4 scene copy or factual claims', async () => {
  const root = await fixture();
  const changedCopy = plan();
  changedCopy.scenes[0]!.text = 'A 50% bonus is available.';
  changedCopy.scenes[0]!.emphasis = ['50%'];
  await assert.rejects(() => acceptVisualPlan(root, changedCopy), /cannot change Agent 4 scene copy/);
  const changedClaim = plan();
  changedClaim.factualClaims[0]!.value = 50;
  await assert.rejects(() => acceptVisualPlan(root, changedClaim), /preserve accepted factual claims exactly/);
});

test('Agent 5 cannot replace the selected Agent 4 hook', async () => {
  const root = await fixture();
  const changed = plan();
  changed.cover.headline = 'A different angle';
  await assert.rejects(() => acceptVisualPlan(root, changed), /preserve the selected Agent 4 hook/);
});

test('Agent 5 requires explicit CTA-matched phone proof and real emphasis text', () => {
  const base = plan();
  const slideshow: VisualPlanRecord = {
    ...base,
    format: '3:4',
    phoneTemplateId: 'app_store_dark',
    scenes: [0, 1, 2, 3, 4, 5].map((sceneIndex) => ({
      ...base.scenes[sceneIndex % 3]!,
      sceneIndex,
      role: sceneIndex === 0 ? 'hook' : sceneIndex === 5 ? 'cta' : 'context',
      expression: ['rewards', 'thinking', 'worried', 'curious', 'pointing', 'urgent'][sceneIndex] as VisualPlanRecord['scenes'][number]['expression'],
    })),
  };
  const missingPhone = { ...slideshow, phoneTemplateId: undefined };
  assert.throws(() => validateVisualPlan(missingPhone), /phoneTemplateId/);
  slideshow.scenes[1]!.emphasis = ['not in the slide'];
  assert.throws(() => validateVisualPlan(slideshow), /emphasis phrase/);
});

test('Agent 5 enforces premium-editorial role, color, and copy discipline', () => {
  const base = plan();
  const slideshow: VisualPlanRecord = {
    ...base,
    format: '3:4',
    phoneTemplateId: 'app_store_dark',
    scenes: [0, 1, 2, 3, 4, 5].map((sceneIndex) => ({
      ...base.scenes[sceneIndex % 3]!,
      sceneIndex,
      role: sceneIndex === 0 ? 'hook' : sceneIndex === 4 ? 'caution' : sceneIndex === 5 ? 'cta' : 'context',
      expression: ['rewards', 'thinking', 'worried', 'curious', 'pointing', 'urgent'][sceneIndex] as VisualPlanRecord['scenes'][number]['expression'],
      background: {
        mode: 'template',
        style: sceneIndex === 4 ? 'burgundy' : sceneIndex > 0 && sceneIndex < 4 ? 'deep_navy' : 'spotlight',
      },
    })),
  };
  assert.doesNotThrow(() => validateVisualPlan(slideshow));

  slideshow.scenes[2]!.background.style = 'forest';
  assert.throws(() => validateVisualPlan(slideshow), /one deck accent family/);
  slideshow.scenes[2]!.background.style = 'deep_navy';
  slideshow.scenes[1]!.background.mode = 'generated_illustration';
  slideshow.scenes[1]!.background.prompt = 'A branded illustration';
  assert.throws(() => validateVisualPlan(slideshow), /mascot\/app-led/);
});

test('Agent 5 rejects visual overflow and arbitrary multi-phrase emphasis', () => {
  const base = plan();
  const slideshow: VisualPlanRecord = {
    ...base,
    format: '3:4',
    phoneTemplateId: 'app_store_dark',
    scenes: [0, 1, 2, 3, 4, 5].map((sceneIndex) => ({
      ...base.scenes[sceneIndex % 3]!,
      sceneIndex,
      role: sceneIndex === 0 ? 'hook' : sceneIndex === 5 ? 'cta' : 'context',
      expression: ['rewards', 'thinking', 'worried', 'curious', 'pointing', 'urgent'][sceneIndex] as VisualPlanRecord['scenes'][number]['expression'],
    })),
  };
  slideshow.scenes[1]!.emphasis = ['Check', 'award space'];
  assert.throws(() => validateVisualPlan(slideshow), /linked numeric values/);
  slideshow.scenes[1]!.text = 'This deliberately excessive scene contains far too many separate words for one premium editorial slide and must return upstream for a shorter validated revision.';
  slideshow.scenes[1]!.emphasis = ['far too many'];
  assert.throws(() => validateVisualPlan(slideshow), /word budget/);
});
