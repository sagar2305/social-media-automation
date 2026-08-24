import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { recordAnalysisPerformanceFeedback } from './analysis-feedback.js';
import { initializeCreddyDataRoot, listJsonFiles, safeDataPath } from './pipeline-store.js';

test('Agent 03 feedback is append-only and idempotent for an identical observation', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-agent03-feedback-'));
  await initializeCreddyDataRoot(root);
  const input = {
    canonicalId: 'canonical-1',
    channel: 'instagram_tiktok' as const,
    editorialVerdict: 'promote' as const,
    views: 12000,
    shares: 420,
    saves: 310,
    conversions: 18,
    note: 'Strong save and share behavior.',
  };
  const first = await recordAnalysisPerformanceFeedback(root, input);
  const repeated = await recordAnalysisPerformanceFeedback(root, input);
  assert.equal(first.created, true);
  assert.equal(repeated.created, false);
  assert.equal(first.record.id, repeated.record.id);
  assert.equal((await listJsonFiles(safeDataPath(root, 'feedback', 'agent-03'))).length, 1);
});

test('Agent 03 feedback rejects negative performance metrics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-agent03-feedback-'));
  await initializeCreddyDataRoot(root);
  await assert.rejects(
    recordAnalysisPerformanceFeedback(root, {
      canonicalId: 'canonical-1',
      channel: 'blog_seo',
      views: -1,
    }),
    /views must be a non-negative number/,
  );
});
