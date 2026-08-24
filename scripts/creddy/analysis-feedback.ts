import { createHash } from 'node:crypto';

import { pathExists, readJson, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import {
  CREDDY_PIPELINE_VERSION,
  type AnalysisPerformanceFeedbackRecord,
} from './pipeline-types.js';

export type AnalysisPerformanceFeedbackInput = Omit<
  AnalysisPerformanceFeedbackRecord,
  'version' | 'id' | 'recordedAt'
> & { recordedAt?: string };

const METRICS = ['views', 'watchTimeSeconds', 'shares', 'saves', 'comments', 'clicks', 'conversions'] as const;

export async function recordAnalysisPerformanceFeedback(
  root: string,
  input: AnalysisPerformanceFeedbackInput,
): Promise<{ created: boolean; record: AnalysisPerformanceFeedbackRecord }> {
  if (!input.canonicalId.trim()) throw new Error('canonicalId is required');
  for (const metric of METRICS) {
    const value = input[metric];
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`${metric} must be a non-negative number`);
    }
  }
  const recordedAt = input.recordedAt ?? new Date().toISOString();
  // Keep retries idempotent even when the caller lets us assign recordedAt.
  // A caller can provide a distinct timestamp when the same metrics are a new observation.
  const id = createHash('sha256').update(JSON.stringify(input)).digest('hex').slice(0, 24);
  const path = safeDataPath(root, 'feedback', 'agent-03', `${id}.json`);
  if (await pathExists(path)) {
    return { created: false, record: await readJson<AnalysisPerformanceFeedbackRecord>(path) };
  }
  const record: AnalysisPerformanceFeedbackRecord = {
    version: CREDDY_PIPELINE_VERSION,
    ...input,
    id,
    recordedAt,
  };
  await writeJsonAtomic(path, record);
  return { created: true, record };
}
