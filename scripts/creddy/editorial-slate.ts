import { selectEditorialPortfolio } from './analysis-stage.js';
import { pathExists, readJson, safeDataPath } from './pipeline-store.js';
import type { AnalysisDecisionRecord } from './pipeline-types.js';

type EditorialSlateRecord = {
  version: 1;
  analysisBatchId: string;
  canonicalIds: string[];
};

/** Uses a human-recorded slate for one analysis batch and otherwise retains
 * the automatic diversified selection. The override is local, batch-scoped,
 * ordered, and must name exactly the requested number of current decisions. */
export async function selectPersistedEditorialPortfolio(
  root: string,
  decisions: AnalysisDecisionRecord[],
  limit = 5,
): Promise<AnalysisDecisionRecord[]> {
  const batchIds = [...new Set(decisions.flatMap((item) => item.analysisBatchId ? [item.analysisBatchId] : []))];
  if (batchIds.length !== 1) return selectEditorialPortfolio(decisions, limit);
  const batchId = batchIds[0]!;
  const path = safeDataPath(root, 'feedback', `editorial-slate-${batchId}.json`);
  if (!(await pathExists(path))) return selectEditorialPortfolio(decisions, limit);
  const record = await readJson<EditorialSlateRecord>(path);
  if (record.version !== 1 || record.analysisBatchId !== batchId ||
      record.canonicalIds.length !== limit || new Set(record.canonicalIds).size !== limit) {
    throw new Error('Persisted editorial slate is invalid');
  }
  const byId = new Map(decisions.map((item) => [item.canonicalId, item]));
  const selected = record.canonicalIds.map((id) => byId.get(id));
  if (selected.some((item) => !item)) throw new Error('Persisted editorial slate references a decision outside its analysis batch');
  return selected as AnalysisDecisionRecord[];
}
