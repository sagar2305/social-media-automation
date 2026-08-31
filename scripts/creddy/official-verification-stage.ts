import { unlink } from 'node:fs/promises';

import { selectEditorialPortfolio } from './analysis-stage.js';
import { assertRegisteredOfficialEvidence } from './official-source-registry.js';
import {
  listJsonFiles,
  pathExists,
  readJson,
  safeDataPath,
  writeJsonAtomic,
} from './pipeline-store.js';
import type {
  AnalysisDecisionRecord,
  AnalysisTaskRecord,
  CanonicalNewsRecord,
  CreddyOfficialVerificationRecord,
  OfficialVerificationTaskRecord,
} from './pipeline-types.js';

function validWebUrl(value: string): URL {
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('Official verification URLs must use HTTP or HTTPS');
  return url;
}

export function validateOfficialVerification(
  record: CreddyOfficialVerificationRecord,
  task: OfficialVerificationTaskRecord,
): CreddyOfficialVerificationRecord {
  if (record.version !== 1 || record.id !== task.id) throw new Error('Official verification identity is invalid');
  if (record.decisionId !== task.decision.id || record.canonicalId !== task.decision.canonicalId) {
    throw new Error('Official verification does not match its selected decision');
  }
  if (!Number.isFinite(Date.parse(record.checkedAt))) throw new Error('Official verification requires a valid checkedAt');
  if (!['verified', 'inconclusive', 'conflicting', 'unavailable'].includes(record.status)) {
    throw new Error('Unsupported official verification status');
  }
  if (!Array.isArray(record.attemptedUrls) || !Array.isArray(record.evidence) ||
      !Array.isArray(record.claimOutcomes) || !Array.isArray(record.remainingRequirements) ||
      !Array.isArray(record.failureReasons)) {
    throw new Error('Official verification arrays are required');
  }
  const attemptedUrls = new Set(record.attemptedUrls.map((value) => validWebUrl(value).toString()));
  const evidenceUrls = new Set<string>();
  for (const item of record.evidence) {
    const url = validWebUrl(item.url);
    if (!item.owner.trim() || !['issuer', 'airline', 'hotel', 'loyalty_program', 'airport', 'government'].includes(item.sourceType)) {
      throw new Error('Official evidence requires its first-party owner and source type');
    }
    assertRegisteredOfficialEvidence(item);
    if (!attemptedUrls.has(url.toString())) throw new Error('Every official evidence URL must appear in attemptedUrls');
    evidenceUrls.add(url.toString());
  }
  const expectedFields = new Set(task.decision.claims.map((claim) => claim.field));
  const outcomeFields = new Set(record.claimOutcomes.map((outcome) => outcome.field));
  if (outcomeFields.size !== record.claimOutcomes.length || outcomeFields.size !== expectedFields.size ||
      [...expectedFields].some((field) => !outcomeFields.has(field))) {
    throw new Error('Official verification requires exactly one outcome for every selected claim');
  }
  for (const outcome of record.claimOutcomes) {
    if (!['verified', 'unresolved', 'conflicting', 'not_found'].includes(outcome.status) || !outcome.notes.trim()) {
      throw new Error(`Claim ${outcome.field} requires a valid outcome and notes`);
    }
    if (['verified', 'conflicting'].includes(outcome.status) && outcome.officialUrls.length === 0) {
      throw new Error(`Claim ${outcome.field} requires a recorded official evidence URL`);
    }
    outcome.officialUrls.forEach((value) => {
      const url = validWebUrl(value);
      if (!evidenceUrls.has(url.toString())) throw new Error(`Claim ${outcome.field} references official evidence that was not recorded`);
    });
  }
  const statuses = new Set(record.claimOutcomes.map((outcome) => outcome.status));
  if (statuses.has('conflicting') && record.status !== 'conflicting') {
    throw new Error('Any claim-level conflict requires overall conflicting status');
  }
  if (record.status === 'verified' &&
      (record.evidence.length === 0 || statuses.size !== 1 || !statuses.has('verified') ||
       record.remainingRequirements.length > 0 || record.failureReasons.length > 0)) {
    throw new Error('Verified status requires official evidence and every claim verified without remaining blockers');
  }
  if (record.status === 'conflicting' && !statuses.has('conflicting')) {
    throw new Error('Conflicting status requires at least one claim-level conflict');
  }
  if (record.status !== 'verified' && record.remainingRequirements.length === 0) {
    throw new Error('Non-verified official checks require explicit remaining requirements');
  }
  return record;
}

async function completedDecisions(root: string): Promise<AnalysisDecisionRecord[]> {
  return Promise.all(
    (await listJsonFiles(safeDataPath(root, '04-analysis-queue', 'completed')))
      .map((path) => readJson<AnalysisDecisionRecord>(path)),
  );
}

function latestBatch(decisions: AnalysisDecisionRecord[]): AnalysisDecisionRecord[] {
  const groups = new Map<string, AnalysisDecisionRecord[]>();
  for (const decision of decisions) {
    if (decision.rubricVersion !== 'creddy-ranking-v3' || !decision.analysisBatchId) continue;
    const group = groups.get(decision.analysisBatchId) ?? [];
    group.push(decision);
    groups.set(decision.analysisBatchId, group);
  }
  return [...groups.values()].sort((left, right) =>
    Math.max(...right.map((item) => Date.parse(item.analyzedAt))) -
    Math.max(...left.map((item) => Date.parse(item.analyzedAt))))[0] ?? [];
}

export async function prepareOfficialVerificationTasks(
  root: string,
  now = new Date(),
): Promise<OfficialVerificationTaskRecord[]> {
  const decisions = latestBatch(await completedDecisions(root));
  if (decisions.length === 0) return [];
  const batchId = decisions[0]!.analysisBatchId!;
  const unfinished = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '04-analysis-queue', 'pending')))
      .map((path) => readJson<AnalysisTaskRecord>(path)),
  );
  if (unfinished.some((task) => task.correctionContext)) {
    throw new Error('Finish the audited Agent 03 conflict correction before preparing any official-verification slate');
  }
  if (unfinished.some((task) => task.queueRunId === batchId)) {
    throw new Error('Finish every Agent 03 ranking decision in the current batch before selecting its five-story verification slate');
  }
  const canonicals = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '03-canonical-news', 'approved')))
      .map((path) => readJson<CanonicalNewsRecord>(path)),
  );
  const articleById = new Map(canonicals.map((article) => [article.canonicalId, article]));
  const selected = selectEditorialPortfolio(decisions, 5);
  const tasks: OfficialVerificationTaskRecord[] = [];
  for (const [index, decision] of selected.entries()) {
    if (decision.verificationGate) continue;
    const article = articleById.get(decision.canonicalId);
    if (!article) throw new Error(`Selected verification story is missing its canonical record: ${decision.canonicalId}`);
    const task: OfficialVerificationTaskRecord = {
      version: 1,
      id: `official-verification-${decision.id}`,
      portfolioRank: decision.correctionContext?.originalPortfolioRank ?? index + 1,
      selectedAt: now.toISOString(),
      decision,
      article,
    };
    const pendingPath = safeDataPath(root, '04-official-verification', 'pending', `${task.id}.json`);
    const completedPath = safeDataPath(root, '04-official-verification', 'completed', `${task.id}.json`);
    if (!(await pathExists(pendingPath)) && !(await pathExists(completedPath))) {
      await writeJsonAtomic(pendingPath, task);
    }
    tasks.push(task);
  }
  return tasks;
}

export async function listPendingOfficialVerificationTasks(root: string): Promise<OfficialVerificationTaskRecord[]> {
  return Promise.all(
    (await listJsonFiles(safeDataPath(root, '04-official-verification', 'pending')))
      .map((path) => readJson<OfficialVerificationTaskRecord>(path)),
  );
}

export async function acceptOfficialVerification(
  root: string,
  input: CreddyOfficialVerificationRecord,
): Promise<AnalysisDecisionRecord> {
  const pendingPath = safeDataPath(root, '04-official-verification', 'pending', `${input.id}.json`);
  if (!(await pathExists(pendingPath))) throw new Error(`Official verification task not found: ${input.id}`);
  const task = await readJson<OfficialVerificationTaskRecord>(pendingPath);
  const official = validateOfficialVerification(input, task);
  const socialStatus = official.status === 'verified'
    ? 'verified' as const
    : official.status === 'conflicting'
      ? 'conflicting' as const
      : 'manual_confirmation_required' as const;
  const decision: AnalysisDecisionRecord = {
    ...task.decision,
    verificationGate: {
      portfolioRank: task.portfolioRank,
      selectedAt: task.selectedAt,
      official,
      socialStatus,
    },
  };
  await writeJsonAtomic(
    safeDataPath(root, '04-official-verification', 'completed', `${input.id}.json`),
    official,
  );
  await writeJsonAtomic(
    safeDataPath(root, '04-analysis-queue', 'completed', `${decision.canonicalId}.json`),
    decision,
  );
  await unlink(pendingPath);
  return decision;
}

export async function reopenConflictingVerification(
  root: string,
  input: { decisionId: string; reopenedBy: string; reason: string },
  now = new Date(),
): Promise<AnalysisTaskRecord> {
  const reopenedBy = input.reopenedBy.trim();
  const reason = input.reason.trim();
  if (!reopenedBy) throw new Error('Conflict reopener identity is required');
  if (reason.length < 10 || reason.length > 2_000) throw new Error('Conflict correction reason must be 10–2000 characters');
  const decision = (await completedDecisions(root)).find((item) => item.id === input.decisionId);
  if (!decision) throw new Error(`Analysis decision not found: ${input.decisionId}`);
  if (!decision.analysisBatchId || decision.verificationGate?.official.status !== 'conflicting') {
    throw new Error('Only a current-workflow decision with an official conflict can be reopened');
  }
  const article = await readJson<CanonicalNewsRecord>(
    safeDataPath(root, '03-canonical-news', 'approved', `${decision.canonicalId}.json`),
  );
  const reopenedAt = now.toISOString();
  const auditId = `${decision.id}-${reopenedAt.replace(/[^0-9A-Za-z]+/g, '')}`;
  const correctionBatchId = `correction-${decision.canonicalId}-${reopenedAt.replace(/[^0-9A-Za-z]+/g, '')}`;
  const correctionContext: NonNullable<AnalysisTaskRecord['correctionContext']> = {
    historyId: auditId,
    reopenedBy,
    reopenedAt,
    reason,
    originalAnalysisBatchId: decision.analysisBatchId,
    originalPortfolioRank: decision.verificationGate.portfolioRank,
    priorOfficialVerification: decision.verificationGate.official,
  };
  await writeJsonAtomic(safeDataPath(root, '04-official-verification', 'history', `${auditId}.json`), {
    version: 1,
    id: auditId,
    decisionId: decision.id,
    reopenedBy,
    reopenedAt,
    reason,
    priorDecision: decision,
  });
  const task: AnalysisTaskRecord = {
    version: decision.version,
    id: `analysis-${decision.canonicalId}`,
    canonicalId: decision.canonicalId,
    queuedAt: reopenedAt,
    instructionsVersion: 'creddy-ranking-v3',
    queueRunId: correctionBatchId,
    correctionContext,
    article,
  };
  await writeJsonAtomic(safeDataPath(root, '04-analysis-queue', 'pending', `${decision.canonicalId}.json`), task);
  const completedOfficial = safeDataPath(root, '04-official-verification', 'completed', `${decision.verificationGate.official.id}.json`);
  if (await pathExists(completedOfficial)) await unlink(completedOfficial);
  const reopenedDecision = { ...decision };
  delete reopenedDecision.verificationGate;
  await writeJsonAtomic(safeDataPath(root, '04-analysis-queue', 'completed', `${decision.canonicalId}.json`), reopenedDecision);
  return task;
}
