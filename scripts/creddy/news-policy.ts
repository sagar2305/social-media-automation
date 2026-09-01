import { CREDDY_SOURCES, type CreddySourceConfig } from './config.js';
import type { AnalysisDecisionRecord, CanonicalNewsRecord, RawArticleRecord } from './pipeline-types.js';

export type NewsDateBasis = 'source_published' | 'provider_published' | 'first_seen';

export interface EffectiveNewsTimestamp {
  timestamp: number;
  iso: string;
  basis: NewsDateBasis;
  sourcePublishedAt?: string;
  firstSeenAt: string;
}

export interface TrustedNewsPolicyResult {
  eligible: boolean;
  requiresVerification: boolean;
  reason?: string;
  date: EffectiveNewsTimestamp;
  trustedSourceIds: string[];
  independentlyCorroborated: boolean;
}

function parsed(value: unknown): number | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : undefined;
}

function normalizedHost(value: string): string | undefined {
  try {
    return new URL(value).hostname.toLocaleLowerCase('en-US').replace(/^www\./, '');
  } catch {
    return undefined;
  }
}

function sourceForEvidence(evidence: RawArticleRecord): CreddySourceConfig | undefined {
  const byId = CREDDY_SOURCES.find((source) => source.id === evidence.sourceId);
  const evidenceHost = normalizedHost(evidence.canonicalUrl);
  if (byId) {
    const configuredHost = normalizedHost(byId.url);
    return evidenceHost && configuredHost &&
      (evidenceHost === configuredHost || evidenceHost.endsWith(`.${configuredHost}`))
      ? byId
      : undefined;
  }
  if (!evidenceHost) return undefined;
  return CREDDY_SOURCES.find((source) => {
    const sourceHost = normalizedHost(source.url);
    return Boolean(sourceHost && (evidenceHost === sourceHost || evidenceHost.endsWith(`.${sourceHost}`)));
  });
}

export function trustedSpecialistSourceId(evidence: RawArticleRecord): string | undefined {
  const source = sourceForEvidence(evidence);
  return source?.sourceClass === 'specialist_publication' && ['B', 'C'].includes(source.tier)
    ? source.id
    : undefined;
}

export function effectiveNewsTimestamp(
  article: CanonicalNewsRecord,
  firstSeenAt = article.fetchedAt,
): EffectiveNewsTimestamp {
  const sourcePublishedAt = parsed(article.publishedAt);
  const providerDate = parsed(article.providerMetadata?.['article:published_time']) ??
    parsed(article.providerMetadata?.datePublished);
  const firstSeen = parsed(firstSeenAt) ?? parsed(article.fetchedAt);
  // App News is timestamped by when Creddy first saw the item. An upstream
  // publication date is useful provenance, but an old/missing publisher field
  // must not make a newly discovered, currently actionable story disappear.
  const timestamp = firstSeen ?? sourcePublishedAt ?? providerDate ?? Number.NaN;
  const basis: NewsDateBasis = firstSeen !== undefined
    ? 'first_seen'
    : sourcePublishedAt !== undefined
      ? 'source_published'
      : 'provider_published';
  return {
    timestamp,
    iso: Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : '',
    basis,
    sourcePublishedAt: sourcePublishedAt !== undefined
      ? new Date(sourcePublishedAt).toISOString()
      : providerDate !== undefined
        ? new Date(providerDate).toISOString()
        : undefined,
    firstSeenAt: firstSeen === undefined ? firstSeenAt : new Date(firstSeen).toISOString(),
  };
}

function trustedEvidenceById(evidence: RawArticleRecord[]): Map<string, string> {
  return new Map(evidence.flatMap((record) => {
    const sourceId = trustedSpecialistSourceId(record);
    return sourceId ? [[record.id, sourceId] as const] : [];
  }));
}

export function trustedEditorialEvidence(
  decision: AnalysisDecisionRecord,
  article: CanonicalNewsRecord,
  evidence: RawArticleRecord[],
): { satisfied: boolean; trustedSourceIds: string[]; independentlyCorroborated: boolean } {
  const trusted = trustedEvidenceById(evidence);
  const articleSource = trustedSpecialistSourceId(article);
  const trustedSourceIds = [...new Set([...trusted.values(), ...(articleSource ? [articleSource] : [])])].sort();
  const everyClaimTrusted = decision.claims.length > 0 && decision.claims.every((claim) =>
    claim.confidence >= 60 && !claim.conflict && claim.sourceRecordIds.some((id) => trusted.has(id)));
  const independentlyCorroborated = decision.claims.length > 0 && decision.claims.every((claim) =>
    new Set(claim.sourceRecordIds.flatMap((id) => trusted.has(id) ? [trusted.get(id)!] : [])).size >= 2);
  return {
    satisfied: Boolean(articleSource) && everyClaimTrusted && !decision.materialConflict && !decision.conflictChangesMessage,
    trustedSourceIds,
    independentlyCorroborated,
  };
}

export function evaluateTrustedNewsPolicy(input: {
  decision: AnalysisDecisionRecord;
  article: CanonicalNewsRecord;
  evidence: RawArticleRecord[];
  firstSeenAt?: string;
  now?: number;
}): TrustedNewsPolicyResult {
  const now = input.now ?? Date.now();
  const date = effectiveNewsTimestamp(input.article, input.firstSeenAt);
  const evidence = trustedEditorialEvidence(input.decision, input.article, input.evidence);
  const base = { date, trustedSourceIds: evidence.trustedSourceIds, independentlyCorroborated: evidence.independentlyCorroborated };
  const official = input.decision.verificationGate?.official;
  const officialVerified = official?.status === 'verified' && official.claimOutcomes.every((claim) => claim.status === 'verified');
  if (official?.status === 'conflicting' || input.decision.materialConflict || input.decision.conflictChangesMessage) {
    return { ...base, eligible: false, requiresVerification: false, reason: 'A known material conflict blocks News publication.' };
  }
  if (!Number.isFinite(date.timestamp) || date.timestamp > now + 300_000 || now - date.timestamp > 72 * 60 * 60 * 1000) {
    return { ...base, eligible: false, requiresVerification: false, reason: 'The effective News timestamp is future-dated or outside the 72-hour window.' };
  }
  if (input.decision.expiry && (!Number.isFinite(Date.parse(input.decision.expiry)) || Date.parse(input.decision.expiry) <= now)) {
    return { ...base, eligible: false, requiresVerification: false, reason: 'The story is expired.' };
  }
  if (input.decision.rubricVersion !== 'creddy-ranking-v3' || input.decision.editorialDisposition !== 'produce' ||
      ['rejected', 'defer', 'archived', 'slack_review'].includes(input.decision.route) || input.decision.confidenceScore < 60) {
    return { ...base, eligible: false, requiresVerification: false, reason: 'The ranking does not qualify for hourly News.' };
  }
  if (!evidence.satisfied) {
    return { ...base, eligible: false, requiresVerification: false, reason: 'Every material claim requires attributed evidence from a configured specialist publication.' };
  }
  const exceptional = input.decision.verificationState === 'community_signal_only' ||
    input.decision.verificationState === 'independent_confirmation_needed';
  if (exceptional && !officialVerified && !evidence.independentlyCorroborated) {
    return { ...base, eligible: false, requiresVerification: true, reason: 'This exceptional claim still requires official evidence or two trusted specialist publications.' };
  }
  return { ...base, eligible: true, requiresVerification: false };
}
