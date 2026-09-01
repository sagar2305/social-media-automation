import type {
  AnalysisDecisionRecord,
  CanonicalNewsRecord,
  ContentBankRecord,
  ContentPackageRecord,
  CreddyDistributionMode,
  CreddyVerificationGate,
  RawArticleRecord,
} from './pipeline-types.js';
import { listJsonFiles, readJson, safeDataPath } from './pipeline-store.js';
import { decisionFingerprint, officialVerificationFingerprint } from './rolling-editorial.js';
import { trustedEditorialEvidence } from './news-policy.js';

const VOLATILE_ARTICLE_LANGUAGE = /\b(?:adds?|added|bonus|offer|highest[- ]ever|limited[- ]time|ends?|expires?|through\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|launch(?:es|ed)?|new\s+(?:card|benefit|route)|devaluation|promo|status match|buy\s+\w+\s+(?:points|miles))\b/i;

export function isVerifiedSocialDecision(decision: AnalysisDecisionRecord): boolean {
  const ready = decision.rubricVersion === 'creddy-ranking-v3' &&
    decision.verificationState === 'ready' &&
    ['auto_process', 'evergreen_queue'].includes(decision.route);
  if (!ready) return false;
  // Legacy ranking-v3 records predate bounded official verification and retain
  // their established behavior. Every newly batched decision must first be in
  // the persisted top-five slate and complete the official-source attempt.
  return !decision.analysisBatchId || decision.verificationGate?.official.status === 'verified';
}

export function isSocialVerificationSatisfied(gate?: CreddyVerificationGate, revision?: number): boolean {
  if (!gate) return true;
  if (gate.official.status === 'conflicting' || gate.socialStatus !== 'verified') return false;
  if (gate.official.status === 'verified') return true;
  return Boolean(
    gate.factsVerifiedBy?.trim() &&
    gate.factsVerifiedAt && Number.isFinite(Date.parse(gate.factsVerifiedAt)) &&
    Number.isInteger(revision) && gate.factsVerificationRevision === revision,
  );
}

export function requiresManualSocialVerification(gate?: CreddyVerificationGate): boolean {
  return gate?.socialStatus === 'manual_confirmation_required';
}

export function assertSocialVerificationSatisfied(gate?: CreddyVerificationGate, revision?: number): void {
  if (gate?.official.status === 'conflicting' || gate?.socialStatus === 'conflicting') {
    throw new Error('Official evidence conflicts with a material claim; correct and re-review the content before social delivery');
  }
  if (gate?.socialStatus === 'manual_confirmation_required') {
    throw new Error('Social delivery requires the audited “Facts verified and approve” action');
  }
  if (!isSocialVerificationSatisfied(gate, revision)) {
    throw new Error('Social delivery factual approval is missing a valid actor, timestamp, or current revision');
  }
}

export function assertArticleVerificationPublishable(gate?: CreddyVerificationGate): void {
  if (gate?.official.status === 'conflicting') {
    throw new Error('Official evidence conflicts with a material claim; correct the article before blog publication');
  }
}

export function assertVerificationGateIntegrity(
  bank: Pick<ContentBankRecord, 'analysisBatchId' | 'verificationGate'>,
  content: Pick<ContentPackageRecord, 'analysisBatchId' | 'verificationGate'>,
): void {
  if (!bank.analysisBatchId && !content.analysisBatchId) return;
  if (!bank.analysisBatchId || bank.analysisBatchId !== content.analysisBatchId) {
    throw new Error('Current-workflow content has a missing or mismatched Agent 03 batch identity');
  }
  if (!bank.verificationGate && !content.verificationGate) return;
  if (!bank.verificationGate || !content.verificationGate) {
    throw new Error('Current-workflow content is missing its official-verification gate');
  }
  const immutable = (gate: CreddyVerificationGate) => ({
    portfolioRank: gate.portfolioRank,
    selectedAt: gate.selectedAt,
    official: gate.official,
  });
  if (JSON.stringify(immutable(bank.verificationGate)) !== JSON.stringify(immutable(content.verificationGate))) {
    throw new Error('Content Bank and production package verification gates do not match');
  }
}

export async function assertBankVerificationIntegrity(root: string, bank: ContentBankRecord): Promise<void> {
  const sourcePath = bank.contentDraftId
    ? safeDataPath(root, '06-content-drafts', `${bank.contentDraftId}.json`)
    : safeDataPath(root, '06-content-packages', `${bank.contentPackageId}.json`);
  const source = await readJson<Pick<ContentPackageRecord, 'analysisBatchId' | 'verificationGate' | 'productionAuthorization'>>(sourcePath);
  assertVerificationGateIntegrity(bank, source);
  if (bank.analysisBatchId && JSON.stringify(bank.productionAuthorization) !== JSON.stringify(source.productionAuthorization)) {
    throw new Error('Current-workflow bank and production package authorizations do not match');
  }
}

export async function assertProductionAuthorizationCurrent(
  root: string,
  bank: ContentBankRecord,
  now = new Date(),
): Promise<void> {
  if (!bank.analysisBatchId) return;
  const authorization = bank.productionAuthorization;
  if (!authorization) throw new Error('Current-workflow delivery is missing its production authorization');
  const decision = await readJson<AnalysisDecisionRecord>(
    safeDataPath(root, '04-analysis-queue', 'completed', `${authorization.canonicalId}.json`),
  );
  if (decision.productionAuthorization?.id !== authorization.id ||
      JSON.stringify(decision.productionAuthorization) !== JSON.stringify(authorization) ||
      publicationModeForOpportunity(decision, { canonicalId: decision.canonicalId } as CanonicalNewsRecord, now) === undefined) {
    throw new Error('Production authorization is stale or no longer matches the current Agent 03 decision');
  }
  await assertBankVerificationIntegrity(root, bank);
}

/** Revalidates the complete unattended breaking-news authorization immediately
 * before an external mutation. This must be called by every delivery path, not
 * only by the worker that initially moved the item into the schedule. */
export async function assertAutoUrgentAuthorizationCurrent(
  root: string,
  bank: ContentBankRecord,
  now = new Date(),
): Promise<void> {
  const authorization = bank.productionAuthorization;
  if (authorization?.approvalMode !== 'auto_urgent' || authorization.lane !== 'urgent') {
    throw new Error('Content is not authorized for unattended urgent delivery');
  }
  const expiresAt = Date.parse(authorization.expiresAt ?? '');
  if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) {
    throw new Error('Urgent delivery authorization expired before external mutation');
  }
  await assertProductionAuthorizationCurrent(root, bank, now);
  const decision = await readJson<AnalysisDecisionRecord>(
    safeDataPath(root, '04-analysis-queue', 'completed', `${authorization.canonicalId}.json`),
  );
  if (decision.id !== authorization.decisionId || decision.analysisInputHash !== authorization.analysisInputHash ||
      decisionFingerprint(decision) !== authorization.decisionHash ||
      officialVerificationFingerprint(decision) !== authorization.officialVerificationHash) {
    throw new Error('Urgent content or evidence changed after authorization');
  }
  const checkedAt = Date.parse(decision.verificationGate?.official.checkedAt ?? '');
  const officialSatisfied = decision.verificationGate?.official.status === 'verified' && Number.isFinite(checkedAt) &&
    now.getTime() - checkedAt <= 30 * 60 * 1000 &&
    decision.verificationGate.official.claimOutcomes.every((claim) => claim.status === 'verified');
  if (!officialSatisfied) {
    const article = await readJson<CanonicalNewsRecord>(
      safeDataPath(root, '03-canonical-news', 'approved', `${decision.canonicalId}.json`),
    );
    const raw = new Map<string, RawArticleRecord>();
    for (const path of await listJsonFiles(safeDataPath(root, '01-raw'))) {
      const record = await readJson<RawArticleRecord>(path);
      raw.set(record.id, record);
    }
    const corroboration = trustedEditorialEvidence(
      decision,
      article,
      decision.evidenceRecordIds.flatMap((id) => raw.has(id) ? [raw.get(id)!] : []),
    );
    if (!corroboration.satisfied || !corroboration.independentlyCorroborated) {
      throw new Error('Urgent delivery requires current official evidence or two independent trusted specialist publications');
    }
  }
  assertSocialVerificationSatisfied(bank.verificationGate, bank.revision);
}

export function markSocialFactsVerified(
  gate: CreddyVerificationGate | undefined,
  actor: string,
  revision: number,
  now = new Date(),
): CreddyVerificationGate | undefined {
  if (!gate) return undefined;
  if (gate.official.status === 'conflicting' || gate.socialStatus === 'conflicting') {
    throw new Error('Official evidence conflicts with a material claim; factual confirmation cannot override it');
  }
  if (gate.socialStatus === 'verified' && gate.official.status === 'verified') return gate;
  if (gate.socialStatus === 'verified' && isSocialVerificationSatisfied(gate, revision)) return gate;
  if (!actor.trim()) throw new Error('Facts verifier identity is required');
  return {
    ...gate,
    socialStatus: 'verified',
    factsVerifiedBy: actor,
    factsVerifiedAt: now.toISOString(),
    factsVerificationRevision: revision,
  };
}

/**
 * Article-only work is intentionally narrower than general discovery. It is a
 * stable education lane, not a bypass for unverified offers or breaking news.
 */
export function isEvergreenArticleDecision(
  decision: AnalysisDecisionRecord,
  article: CanonicalNewsRecord,
): boolean {
  if (decision.rubricVersion !== 'creddy-ranking-v3') return false;
  if (decision.editorialDisposition !== 'evergreen') return false;
  if (decision.verificationState === 'community_signal_only') return false;
  if ((decision.productFitScore ?? 0) < 78 || decision.confidenceScore < 70) return false;
  if (decision.materialConflict || decision.conflictChangesMessage || decision.expiry) return false;
  if (!['A', 'B'].includes(article.sourceTier)) return false;
  if ((decision.channelScores?.blogSeo ?? 0) < 72 && (decision.channelScores?.evergreen ?? 0) < 72) return false;
  const volatileText = `${decision.headline} ${decision.summary} ${decision.hookType ?? ''}`;
  return !VOLATILE_ARTICLE_LANGUAGE.test(volatileText);
}

export function publicationModeForOpportunity(
  decision: AnalysisDecisionRecord,
  article: CanonicalNewsRecord,
  now = new Date(),
): CreddyDistributionMode | undefined {
  if (decision.productionAuthorization) {
    const authorization = decision.productionAuthorization;
    if (authorization.canonicalId !== decision.canonicalId || authorization.decisionId !== decision.id ||
        authorization.analysisInputHash !== decision.analysisInputHash) return undefined;
    if (authorization.expiresAt) {
      const expiresAt = Date.parse(authorization.expiresAt);
      if (!Number.isFinite(expiresAt) || expiresAt <= now.getTime()) return undefined;
    }
    if (decisionFingerprint(decision) !== authorization.decisionHash ||
        officialVerificationFingerprint(decision) !== authorization.officialVerificationHash) return undefined;
    if (decision.verificationGate?.official.status === 'conflicting') return undefined;
    if (!decision.verificationGate && authorization.approvalMode !== 'human_review' &&
        authorization.officialVerificationHash !== 'none') return undefined;
    return authorization.distributionMode;
  }
  if (decision.analysisBatchId) {
    // Current decisions are inert until the rolling queue writes an explicit
    // production authorization. This is the expensive-asset boundary.
    return undefined;
  }
  if (isVerifiedSocialDecision(decision)) return 'article_and_social';
  if (isEvergreenArticleDecision(decision, article)) return 'article_only';
  return undefined;
}

/** Only explicit opportunity records may reach Agent 04. Completed rankings
 * remain editorial candidates until the rolling selector authorizes them. */
export async function listPublicationDecisions(root: string): Promise<AnalysisDecisionRecord[]> {
  const paths = await listJsonFiles(safeDataPath(root, '05-content-opportunities'));
  const decisions = await Promise.all(paths.map((path) => readJson<AnalysisDecisionRecord>(path)));
  const eligible: AnalysisDecisionRecord[] = [];
  for (const decision of decisions) {
    if (!decision.analysisBatchId) {
      eligible.push(decision);
      continue;
    }
    const authorization = decision.productionAuthorization;
    if (!authorization) continue;
    try {
      const current = await readJson<AnalysisDecisionRecord>(
        safeDataPath(root, '04-analysis-queue', 'completed', `${decision.canonicalId}.json`),
      );
      if (current.productionAuthorization?.id !== authorization.id ||
          publicationModeForOpportunity(current, { canonicalId: current.canonicalId } as CanonicalNewsRecord) === undefined) continue;
      eligible.push(current);
    } catch {
      // Missing or malformed current state fails closed; the opportunity remains
      // on disk for audit but cannot reach Agent 04.
    }
  }
  return [...new Map(eligible.map((decision) => [decision.id, decision])).values()];
}
