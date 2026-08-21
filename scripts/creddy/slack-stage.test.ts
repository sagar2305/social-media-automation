import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { initializeCreddyDataRoot, pathExists, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import { CREDDY_PIPELINE_VERSION, type AnalysisDecisionRecord } from './pipeline-types.js';
import { runSlackReviewStage, type SlackApi } from './slack-stage.js';

test('rare Slack reviews are sent once and receive an idempotency receipt', async () => {
  const root = join(await mkdtemp(join(tmpdir(), 'creddy-slack-')), 'creddy');
  await initializeCreddyDataRoot(root);
  const decision: AnalysisDecisionRecord = {
    version: CREDDY_PIPELINE_VERSION,
    id: 'review-1',
    canonicalId: 'canonical-1',
    analyzedAt: '2026-08-19T12:00:00.000Z',
    market: 'US',
    headline: 'Conflicting transfer-bonus terms',
    summary: 'Two approved sources disagree on the deadline.',
    eventType: 'transfer_bonus',
    topic: 'points',
    affectedPrograms: ['Example Rewards'],
    requiredAction: null,
    expiry: null,
    claims: [{ field: 'deadline', value: null, sourceRecordIds: ['evidence-1'], confidence: 40, conflict: 'Sources show different dates.' }],
    productFitScore: 90,
    popularityScore: 75,
    importanceScore: 85,
    confidenceScore: 55,
    importanceReasons: ['Time-sensitive value'],
    confidenceReasons: ['Material source conflict'],
    materialConflict: true,
    conflictChangesMessage: true,
    verificationExhausted: true,
    route: 'slack_review',
    rejectionReasons: [],
    evidenceRecordIds: ['evidence-1'],
  };
  await writeJsonAtomic(safeDataPath(root, '03-canonical-news', 'slack-review', `${decision.id}.json`), decision);
  let calls = 0;
  const client: SlackApi = {
    async postReview() {
      calls += 1;
      return { ts: '123.456', channel: 'C123' };
    },
  };
  const first = await runSlackReviewStage(root, client, 'https://dashboard.example');
  const second = await runSlackReviewStage(root, client, 'https://dashboard.example');
  assert.equal(first.outputCount, 1);
  assert.equal(second.skippedCount, 1);
  assert.equal(calls, 1);
  assert.equal(await pathExists(safeDataPath(root, '03-canonical-news', 'slack-review', 'sent', 'review-1.json')), true);
});
