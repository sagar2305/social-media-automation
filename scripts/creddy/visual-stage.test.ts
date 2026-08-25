import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { initializeCreddyDataRoot, listJsonFiles, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import { CREDDY_PIPELINE_VERSION, type ContentDraftRecord, type VisualPlanRecord } from './pipeline-types.js';
import { acceptVisualPlan, listPendingVisualTasks, selectCreddyExpression, validateVisualPlan } from './visual-stage.js';

function draft(): ContentDraftRecord {
  return {
    version: CREDDY_PIPELINE_VERSION, id: 'copy-analysis-1', analysisId: 'analysis-1', canonicalId: 'canonical-1',
    createdAt: '2026-08-19T12:30:00.000Z', audience: 'US rewards users', slot: 'understand',
    hook: 'A transfer bonus can change the math',
    textScenes: ['A 20% transfer bonus is available.', 'Check award space before transferring.', 'Transfers may be irreversible.'],
    narrationScript: 'A transfer bonus can stretch points, but verify the actual award before moving anything. Search for the seat, compare the total price, and read the current terms. Transfers may be irreversible, so confirm availability and move only the amount needed for your planned booking.',
    instagramCaption: 'Check award space before moving points.', tiktokCaption: 'Seat first. Transfer second.',
    hashtags: ['#points', '#awardtravel', '#rewards'], cta: { label: 'Open Creddy', deepLink: 'creddy://rewards' },
    brief: 'Educational transfer warning.', sourceUrls: ['https://awardwallet.com/blog/bonus'],
    factualClaims: [{ field: 'bonus', value: 20, sourceRecordIds: ['raw-1'], confidence: 90 }],
  };
}

function plan(): VisualPlanRecord {
  const copy = draft();
  return {
    version: CREDDY_PIPELINE_VERSION, id: 'visual-copy-analysis-1', contentDraftId: copy.id,
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
  };
}

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'creddy-visual-'));
  await initializeCreddyDataRoot(root);
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
  invalid.scenes[0]!.expression = 'excited';
  assert.throws(() => validateVisualPlan(invalid), /not present in the Creddy manifest/);
});

test('Agent 5 requires expression variety and maps scene meaning to approved poses', () => {
  const repetitive = plan();
  repetitive.scenes.forEach((scene) => { scene.expression = 'neutral'; });
  assert.throws(
    () => validateVisualPlan(repetitive),
    /at least two script-appropriate expressions|Adjacent Creddy slideshow scenes cannot repeat/,
  );
  assert.equal(selectCreddyExpression({ role: 'context', text: 'Which card should you use?' }), 'thinking');
  assert.equal(selectCreddyExpression({ role: 'caution', text: 'This benefit is ending soon.' }), 'worried');
  assert.equal(selectCreddyExpression({ role: 'fact', text: 'Earn more rewards and points.' }), 'rewards');
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
