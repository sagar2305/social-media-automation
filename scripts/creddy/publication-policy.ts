import type {
  AnalysisDecisionRecord,
  CanonicalNewsRecord,
  ContentBankRecord,
  ContentPackageRecord,
  CreddyDistributionMode,
  CreddyVerificationGate,
} from './pipeline-types.js';
import { listJsonFiles, readJson, safeDataPath } from './pipeline-store.js';

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
  const source = await readJson<Pick<ContentPackageRecord, 'analysisBatchId' | 'verificationGate'>>(sourcePath);
  assertVerificationGateIntegrity(bank, source);
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
): CreddyDistributionMode | undefined {
  if (decision.analysisBatchId) {
    const gate = decision.verificationGate;
    // A completed check unlocks private production even when it finds a
    // conflict. Release boundaries below still block blog and social output,
    // so the item reaches Agent 07 for correction instead of disappearing.
    if (!gate) return undefined;
    if (decision.editorialDisposition === 'produce' || decision.editorialDisposition === 'evergreen') {
      return 'article_and_social';
    }
    return undefined;
  }
  if (isVerifiedSocialDecision(decision)) return 'article_and_social';
  if (isEvergreenArticleDecision(decision, article)) return 'article_only';
  return undefined;
}

/** Current ranking-v3 decisions live in the completed analysis queue. The
 * opportunity directory is also read for backward-compatible fixtures and
 * already-routed records, with the completed decision taking precedence. */
export async function listPublicationDecisions(root: string): Promise<AnalysisDecisionRecord[]> {
  const paths = [
    ...await listJsonFiles(safeDataPath(root, '05-content-opportunities')),
    ...await listJsonFiles(safeDataPath(root, '04-analysis-queue', 'completed')),
  ];
  const decisions = await Promise.all(paths.map((path) => readJson<AnalysisDecisionRecord>(path)));
  return [...new Map(decisions.map((decision) => [decision.id, decision])).values()];
}
