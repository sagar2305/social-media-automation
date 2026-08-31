import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { selectPersistedEditorialPortfolio } from './editorial-slate.js';
import { writeJsonAtomic } from './pipeline-store.js';
import type { AnalysisDecisionRecord } from './pipeline-types.js';

function decision(index: number): AnalysisDecisionRecord {
  const categories = ['card_offer', 'loyalty_news', 'redemption', 'travel_development', 'evergreen_education'] as const;
  return {
    version: 1, id: `ranking-${index}`, canonicalId: `canonical-${index}`,
    analyzedAt: `2026-08-31T12:00:0${index}.000Z`, analysisBatchId: 'batch-1',
    market: 'US', rubricVersion: 'creddy-ranking-v3', headline: `Story ${index}`, summary: `Summary ${index}`,
    eventType: 'program_update', topic: 'points and miles', requiredAction: null, expiry: null,
    route: 'auto_process', editorialDisposition: 'produce', portfolioCategory: categories[index % categories.length],
    importanceScore: 80, popularityScore: 80, confidenceScore: 80, productFitScore: 80, freshnessScore: 80,
    editorialPriorityScore: 90 - index, verificationState: 'ready', evidenceRecordIds: [], claims: [], affectedPrograms: [],
    importanceReasons: [], confidenceReasons: [], materialConflict: false, conflictChangesMessage: false,
    verificationExhausted: true, rejectionReasons: [],
    viralPotential: { score: 80, hookStrength: 80, audienceBreadth: 80, financialMagnitude: 80, novelty: 80, urgency: 80, practicalUtility: 80, visualPotential: 80, discussionPotential: 80, emotionalAspiration: 80, shareSavePotential: 80, reasons: [] },
    channelScores: { instagramTikTok: 80, blogSeo: 80, newsletter: 80, evergreen: 80 },
    hookType: 'program_change', hookRationale: 'Useful change.',
  };
}

test('batch-scoped editorial slate preserves explicit human ordering', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-slate-'));
  const decisions = Array.from({ length: 6 }, (_, index) => decision(index));
  await writeJsonAtomic(join(root, 'feedback', 'editorial-slate-batch-1.json'), {
    version: 1, analysisBatchId: 'batch-1', canonicalIds: ['canonical-4', 'canonical-2', 'canonical-5', 'canonical-0', 'canonical-3'],
  });
  const selected = await selectPersistedEditorialPortfolio(root, decisions, 5);
  assert.deepEqual(selected.map((item) => item.canonicalId), ['canonical-4', 'canonical-2', 'canonical-5', 'canonical-0', 'canonical-3']);
});

test('invalid persisted slate fails closed', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-slate-'));
  const decisions = Array.from({ length: 6 }, (_, index) => decision(index));
  await writeJsonAtomic(join(root, 'feedback', 'editorial-slate-batch-1.json'), {
    version: 1, analysisBatchId: 'batch-1', canonicalIds: ['canonical-0', 'canonical-0'],
  });
  await assert.rejects(() => selectPersistedEditorialPortfolio(root, decisions, 5), /invalid/);
});
