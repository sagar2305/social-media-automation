import { CREDDY_CAMPAIGN_SLUG } from './config.js';
import { mkdir, rename, unlink } from 'node:fs/promises';
import {
  createRunId,
  listJsonFiles,
  pathExists,
  readJson,
  safeDataPath,
  withStageLock,
  writeJsonAtomic,
  writeRunManifest,
} from './pipeline-store.js';
import {
  CREDDY_PIPELINE_VERSION,
  type AnalysisDecisionRecord,
  type AnalysisTaskRecord,
  type CanonicalNewsRecord,
  type CreddyAnalysisRoute,
  type PipelineRunManifest,
} from './pipeline-types.js';

const ROUTES = new Set<CreddyAnalysisRoute>([
  'auto_process',
  'reverify',
  'slack_review',
  'evergreen_queue',
  'defer',
  'rejected',
  'archived',
]);

const CONTENT_ROUTES = new Set<CreddyAnalysisRoute>([
  'auto_process',
  'evergreen_queue',
]);

export interface AnalysisBatchAudit {
  decisionCount: number;
  routableCount: number;
  minimumRoutable: number;
  meetsMinimum: boolean;
  routeCounts: Record<string, number>;
}

function score(value: unknown, name: string): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${name} must be a number from 0 to 100`);
  }
}

function strings(value: unknown, name: string): asserts value is string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`${name} must be a string array`);
  }
}

export function validateAnalysisDecision(
  decision: AnalysisDecisionRecord,
): AnalysisDecisionRecord {
  if (decision.version !== CREDDY_PIPELINE_VERSION) throw new Error('Invalid analysis version');
  if (!decision.id || !decision.canonicalId) throw new Error('Analysis IDs are required');
  if (decision.market !== 'US') throw new Error('Creddy analysis must target the US market');
  if (!ROUTES.has(decision.route)) throw new Error(`Unsupported analysis route: ${decision.route}`);
  score(decision.importanceScore, 'importanceScore');
  score(decision.confidenceScore, 'confidenceScore');
  score(decision.productFitScore, 'productFitScore');
  score(decision.popularityScore, 'popularityScore');
  strings(decision.importanceReasons, 'importanceReasons');
  strings(decision.confidenceReasons, 'confidenceReasons');
  strings(decision.rejectionReasons, 'rejectionReasons');
  strings(decision.evidenceRecordIds, 'evidenceRecordIds');
  if (decision.evidenceRecordIds.length === 0) throw new Error('Analysis requires source evidence');
  if (!Array.isArray(decision.claims)) throw new Error('claims must be an array');
  for (const claim of decision.claims) {
    if (!claim.field) throw new Error('Every claim requires a field');
    score(claim.confidence, `claim:${claim.field}:confidence`);
    strings(claim.sourceRecordIds, `claim:${claim.field}:sourceRecordIds`);
    if (claim.sourceRecordIds.length === 0) throw new Error(`Claim ${claim.field} has no evidence`);
  }

  const qualifiesForSlack =
    decision.importanceScore >= 70 &&
    decision.materialConflict &&
    decision.conflictChangesMessage &&
    decision.verificationExhausted;
  if ((decision.route === 'slack_review') !== qualifiesForSlack) {
    throw new Error(
      'slack_review is allowed only for a high-importance material conflict that changes the message after verification is exhausted',
    );
  }
  if (
    decision.route === 'auto_process' &&
    ((decision.productFitScore ?? 0) < 70 || decision.importanceScore < 70 ||
      decision.confidenceScore < 80 || decision.materialConflict)
  ) {
    throw new Error('auto_process requires product fit >= 70, importance >= 70, confidence >= 80, and no material conflict');
  }
  if (
    decision.route === 'evergreen_queue' &&
    ((decision.productFitScore ?? 0) < 70 || decision.confidenceScore < 70 || decision.materialConflict)
  ) {
    throw new Error('evergreen_queue requires product fit >= 70, confidence >= 70, and no material conflict');
  }
  if (decision.route === 'rejected' && decision.rejectionReasons.length === 0) {
    throw new Error('Rejected analysis requires at least one reason');
  }
  return decision;
}

function normalizedReasons(values: string[]): string[] {
  return values.map((value) => value.trim().toLocaleLowerCase('en-US')).sort();
}

function analysisReasoningFingerprint(decision: AnalysisDecisionRecord): string {
  return JSON.stringify({
    route: decision.route,
    productFitScore: decision.productFitScore,
    popularityScore: decision.popularityScore,
    importanceScore: decision.importanceScore,
    confidenceScore: decision.confidenceScore,
    importanceReasons: normalizedReasons(decision.importanceReasons),
    confidenceReasons: normalizedReasons(decision.confidenceReasons),
    rejectionReasons: normalizedReasons(decision.rejectionReasons),
  });
}

export function auditAnalysisDecisionBatch(
  unvalidated: AnalysisDecisionRecord[],
  minimumRoutable = 5,
): AnalysisBatchAudit {
  if (!Number.isInteger(minimumRoutable) || minimumRoutable < 1) {
    throw new Error('minimumRoutable must be a positive integer');
  }
  if (unvalidated.length === 0) throw new Error('Analysis batch is empty');

  const decisions = unvalidated.map((decision) => validateAnalysisDecision(decision));
  const canonicalIds = new Set<string>();
  const fingerprintGroups = new Map<string, AnalysisDecisionRecord[]>();
  const routeCounts: Record<string, number> = {};

  for (const decision of decisions) {
    if (canonicalIds.has(decision.canonicalId)) {
      throw new Error(`Analysis batch repeats canonicalId: ${decision.canonicalId}`);
    }
    canonicalIds.add(decision.canonicalId);
    routeCounts[decision.route] = (routeCounts[decision.route] ?? 0) + 1;
    const fingerprint = analysisReasoningFingerprint(decision);
    const group = fingerprintGroups.get(fingerprint) ?? [];
    group.push(decision);
    fingerprintGroups.set(fingerprint, group);
  }

  if (decisions.length >= 3) {
    const templatedGroup = [...fingerprintGroups.values()]
      .filter((group) => group.length >= 3)
      .sort((a, b) => b.length - a.length)[0];
    if (templatedGroup) {
      throw new Error(
        `Analysis batch contains ${templatedGroup.length} decisions with identical routes, scores, and reasoning. ` +
        `Evaluate every article independently; affected canonical IDs: ${templatedGroup.map((item) => item.canonicalId).join(', ')}`,
      );
    }
  }

  const routableCount = decisions.filter((decision) => CONTENT_ROUTES.has(decision.route)).length;
  return {
    decisionCount: decisions.length,
    routableCount,
    minimumRoutable,
    meetsMinimum: routableCount >= minimumRoutable,
    routeCounts,
  };
}

export async function runAnalysisQueueStage(
  root: string,
  now = new Date(),
): Promise<PipelineRunManifest> {
  return withStageLock(root, 'analysis_queue', async () => {
    const runId = createRunId(now);
    const manifest: PipelineRunManifest = {
      version: CREDDY_PIPELINE_VERSION,
      runId,
      campaignSlug: CREDDY_CAMPAIGN_SLUG,
      stage: 'analysis',
      status: 'running',
      startedAt: now.toISOString(),
      inputCount: 0,
      outputCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errors: [],
    };
    await writeRunManifest(root, manifest);
    const canonicalRecords = await Promise.all(
      (await listJsonFiles(safeDataPath(root, '03-canonical-news', 'approved')))
        .map((path) => readJson<CanonicalNewsRecord>(path)),
    );
    const activeCanonicalIds = new Set(canonicalRecords.map((article) => article.canonicalId));
    const legacyDir = safeDataPath(root, '04-analysis-queue', 'legacy');
    await mkdir(legacyDir, { recursive: true });
    for (const path of await listJsonFiles(safeDataPath(root, '04-analysis-queue', 'completed'))) {
      const completed = await readJson<AnalysisDecisionRecord>(path);
      let passesCurrentPolicy = true;
      try {
        validateAnalysisDecision(completed);
      } catch {
        passesCurrentPolicy = false;
      }
      if (
        activeCanonicalIds.has(completed.canonicalId) &&
        (!Number.isFinite(completed.productFitScore) ||
          !Number.isFinite(completed.popularityScore) ||
          !passesCurrentPolicy)
      ) {
        await rename(path, safeDataPath(legacyDir, `${completed.canonicalId}.json`));
      } else if (activeCanonicalIds.has(completed.canonicalId) && passesCurrentPolicy) {
        await persistAnalysisRoute(root, completed);
      }
    }

    for (const article of canonicalRecords) {
      manifest.inputCount += 1;
      try {
        const pendingPath = safeDataPath(root, '04-analysis-queue', 'pending', `${article.canonicalId}.json`);
        const completedPath = safeDataPath(root, '04-analysis-queue', 'completed', `${article.canonicalId}.json`);
        if ((await pathExists(pendingPath)) || (await pathExists(completedPath))) {
          manifest.skippedCount += 1;
          continue;
        }
        const task: AnalysisTaskRecord = {
          version: CREDDY_PIPELINE_VERSION,
          id: article.canonicalId,
          canonicalId: article.canonicalId,
          queuedAt: now.toISOString(),
          instructionsVersion: 'creddy-ranking-v2',
          article,
        };
        await writeJsonAtomic(pendingPath, task);
        manifest.outputCount += 1;
      } catch (error) {
        manifest.failedCount += 1;
        manifest.errors.push(`${article.canonicalId}: ${(error as Error).message}`);
      }
    }
    manifest.completedAt = new Date().toISOString();
    manifest.status = manifest.failedCount === 0 ? 'completed' : 'partially_completed';
    await writeRunManifest(root, manifest);
    return manifest;
  });
}

async function persistAnalysisRoute(root: string, decision: AnalysisDecisionRecord): Promise<void> {
  if (decision.route === 'auto_process') {
    await writeJsonAtomic(safeDataPath(root, '05-content-opportunities', `${decision.id}.json`), decision);
  } else if (decision.route === 'evergreen_queue') {
    await writeJsonAtomic(safeDataPath(root, '05-content-opportunities', 'evergreen', `${decision.id}.json`), decision);
  } else if (decision.route === 'reverify') {
    await writeJsonAtomic(safeDataPath(root, '03-canonical-news', 'reverify', `${decision.id}.json`), decision);
  } else if (decision.route === 'defer') {
    await writeJsonAtomic(safeDataPath(root, '03-canonical-news', 'deferred', `${decision.id}.json`), decision);
  } else if (decision.route === 'slack_review') {
    await writeJsonAtomic(safeDataPath(root, '03-canonical-news', 'slack-review', `${decision.id}.json`), decision);
  } else if (decision.route === 'rejected' || decision.route === 'archived') {
    await writeJsonAtomic(safeDataPath(root, '03-canonical-news', decision.route, `analysis-${decision.id}.json`), decision);
  }
}

export async function acceptAnalysisDecision(
  root: string,
  unvalidated: AnalysisDecisionRecord,
): Promise<void> {
  const decision = validateAnalysisDecision(unvalidated);
  const taskPath = safeDataPath(root, '04-analysis-queue', 'pending', `${decision.canonicalId}.json`);
  if (!(await pathExists(taskPath))) throw new Error(`Analysis task not found: ${decision.canonicalId}`);
  const task = await readJson<AnalysisTaskRecord>(taskPath);
  if (task.canonicalId !== decision.canonicalId) throw new Error('Analysis task identity mismatch');
  if (decision.evidenceRecordIds.some((id) => !task.article.evidenceRecordIds.includes(id))) {
    throw new Error('Analysis references evidence outside the canonical article');
  }

  await writeJsonAtomic(
    safeDataPath(root, '04-analysis-queue', 'completed', `${decision.canonicalId}.json`),
    decision,
  );
  await persistAnalysisRoute(root, decision);
  // A decision is durable in completed (and in its routed destination) before
  // the pending task is consumed, so scheduled analysis cannot repeat it.
  await unlink(taskPath);
}
