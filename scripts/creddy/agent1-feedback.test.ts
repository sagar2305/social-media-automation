import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { recordAgent1Feedback } from './agent1-feedback.js';
import { initializeCreddyDataRoot } from './pipeline-store.js';

test('editorial feedback is append-only, idempotent, and produces bounded source proposals', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-feedback-'));
  await initializeCreddyDataRoot(root);
  const base = {
    decision: 'retain' as const,
    sourceId: 'topic-search:test',
    sourceName: 'Search result',
    reason: 'strong audience utility',
    createdAt: '2026-08-24T10:00:00.000Z',
  };
  const first = await recordAgent1Feedback(root, {
    ...base,
    canonicalUrl: 'https://promising.example/story-1',
    runId: 'run-1',
  });
  const duplicate = await recordAgent1Feedback(root, {
    ...base,
    canonicalUrl: 'http://www.promising.example/story-1/?utm_source=test#section',
    runId: 'run-1',
  });
  assert.equal(first.created, true);
  assert.equal(duplicate.created, false);
  assert.equal(duplicate.record.sequence, first.record.sequence);
  assert.equal(duplicate.snapshot.feedbackRecordCount, 1);

  await recordAgent1Feedback(root, {
    ...base,
    canonicalUrl: 'https://promising.example/story-2',
    runId: 'run-1',
  });
  const third = await recordAgent1Feedback(root, {
    ...base,
    canonicalUrl: 'https://promising.example/story-3',
    runId: 'run-2',
  });
  assert.equal(third.snapshot.domains[0].promisingSourceCandidate, true);
  assert.equal(third.snapshot.domains[0].retainedRunCount, 2);
  assert.equal(third.snapshot.domains[0].sampleUrls.length, 3);
  assert.deepEqual(third.snapshot.domains[0].retainedRunIds, ['run-1', 'run-2']);

  const correction = await recordAgent1Feedback(root, {
    ...base,
    decision: 'reject',
    canonicalUrl: 'https://promising.example/story-1',
    runId: 'run-1',
    reason: 'editor correction',
  });
  assert.equal(correction.snapshot.totals.retain, 2);
  assert.equal(correction.snapshot.totals.reject, 1);
});

test('configured sources are never proposed as newly discovered sources', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-feedback-configured-'));
  await initializeCreddyDataRoot(root);
  let result;
  for (const [index, runId] of ['run-1', 'run-1', 'run-2'].entries()) {
    result = await recordAgent1Feedback(root, {
      decision: 'retain',
      canonicalUrl: `https://www.doctorofcredit.com/example-${index}`,
      sourceId: 'doctor-of-credit',
      sourceName: 'Doctor of Credit',
      runId,
      reason: 'strong audience utility',
      createdAt: '2026-08-24T10:00:00.000Z',
    });
  }
  assert.equal(result!.snapshot.domains[0].alreadyConfigured, true);
  assert.equal(result!.snapshot.domains[0].promisingSourceCandidate, false);
});

test('multi-tenant creator proposals use source identity instead of collapsing into Geobreeze', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-feedback-creator-'));
  await initializeCreddyDataRoot(root);
  let result;
  for (const [index, runId] of ['run-1', 'run-1', 'run-2'].entries()) {
    result = await recordAgent1Feedback(root, {
      decision: 'retain',
      canonicalUrl: `https://www.youtube.com/watch?v=new-creator-${index}`,
      sourceId: 'creator:new-points-channel',
      sourceName: 'New points channel',
      runId,
      reason: 'fills creator coverage gap',
    });
  }
  const proposal = result!.snapshot.domains[0];
  assert.deepEqual(proposal.sourceIds, ['creator:new-points-channel']);
  assert.equal(proposal.alreadyConfigured, false);
  assert.equal(proposal.promisingSourceCandidate, true);
});
