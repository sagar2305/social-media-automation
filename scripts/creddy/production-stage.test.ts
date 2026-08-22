import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { initializeCreddyDataRoot, listJsonFiles, readJson, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import { buildProductionPackage, listPendingProductionTasks, prepareProductionPackages } from './production-stage.js';
import { CREDDY_PIPELINE_VERSION, type ContentDraftRecord, type ContentPackageRecord, type VisualPlanRecord } from './pipeline-types.js';
import { buildCreddyVideoScript } from './video-stage.js';

function draft(): ContentDraftRecord {
  return {
    version: CREDDY_PIPELINE_VERSION, id: 'copy-analysis-1', analysisId: 'analysis-1', canonicalId: 'canonical-1',
    createdAt: '2026-08-19T12:30:00.000Z', audience: 'US rewards users', slot: 'understand',
    hook: 'Transfer bonus?', textScenes: ['A 20% bonus is reported.', 'Check the award first.', 'Verify current terms.'],
    narrationScript: 'A twenty percent transfer bonus is reported for eligible users. Check the exact award before moving points because availability can change. Review the current terms and remember that point transfers may be irreversible once submitted.',
    instagramCaption: 'Check the award first.', tiktokCaption: 'Seat first. Transfer second.',
    hashtags: ['#points', '#awardtravel', '#rewards'], cta: { label: 'Open Creddy', deepLink: 'creddy://rewards' },
    brief: 'Caution-first explainer.', sourceUrls: ['https://example.com/bonus'],
    factualClaims: [{ field: 'bonus', value: 20, sourceRecordIds: ['raw-1'], confidence: 90 }],
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
  };
}

test('Agent 6 assembles one immutable package and exactly two render jobs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-production-'));
  await initializeCreddyDataRoot(root);
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
