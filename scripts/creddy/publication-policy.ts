import type { AnalysisDecisionRecord, CanonicalNewsRecord, CreddyDistributionMode } from './pipeline-types.js';
import { listJsonFiles, readJson, safeDataPath } from './pipeline-store.js';

const VOLATILE_ARTICLE_LANGUAGE = /\b(?:adds?|added|bonus|offer|highest[- ]ever|limited[- ]time|ends?|expires?|through\s+(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)|launch(?:es|ed)?|new\s+(?:card|benefit|route)|devaluation|promo|status match|buy\s+\w+\s+(?:points|miles))\b/i;

export function isVerifiedSocialDecision(decision: AnalysisDecisionRecord): boolean {
  return decision.rubricVersion === 'creddy-ranking-v3' &&
    decision.verificationState === 'ready' &&
    ['auto_process', 'evergreen_queue'].includes(decision.route);
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
