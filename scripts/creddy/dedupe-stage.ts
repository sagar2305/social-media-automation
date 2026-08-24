import { createHash } from 'node:crypto';
import { mkdir, rename } from 'node:fs/promises';

import { CREDDY_CAMPAIGN_SLUG } from './config.js';
import { articleTextForQualification, dataQualityRejection } from './filter-stage.js';
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
  type CanonicalNewsRecord,
  type FilteredArticleRecord,
  type PipelineRunManifest,
  type RejectedArticleRecord,
} from './pipeline-types.js';
import { qualifyCreddyText } from './qualification.js';

function cleanMarkdown(markdown: string): string {
  const seen = new Set<string>();
  return markdown
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (!line) return false;
      if (/^(cookie|advertisement|subscribe|sign up|privacy policy)\b/i.test(line)) return false;
      const key = line.toLocaleLowerCase('en-US');
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n');
}

function canonicalId(article: FilteredArticleRecord): string {
  return createHash('sha256')
    .update(article.titleFingerprint || article.canonicalUrl)
    .digest('hex')
    .slice(0, 24);
}

interface VerificationEvidence {
  sourceId: string;
  factualUse: CanonicalNewsRecord['factualUse'];
}

export function verificationForEvidence(
  evidence: readonly VerificationEvidence[],
): NonNullable<CanonicalNewsRecord['verification']> {
  const sources = [...new Set(evidence.map((item) => item.sourceId))].sort();
  const confirmationSources = [...new Set(
    evidence
      .filter((item) => item.factualUse === 'discovery_and_confirmation')
      .map((item) => item.sourceId),
  )].sort();
  if (confirmationSources.length >= 2) {
    return {
      status: 'corroborated',
      evidenceSourceIds: sources,
      requiresFactCheck: false,
      reasons: ['Matching evidence was retained from at least two distinct confirmation-eligible sources.'],
    };
  }
  if (evidence.length > 0 && evidence.every((item) => item.factualUse === 'signal_only')) {
    return {
      status: 'community_signal_only',
      evidenceSourceIds: sources,
      requiresFactCheck: true,
      reasons: ['Community content is a discovery signal and cannot be sole factual confirmation.'],
    };
  }
  return {
    status: 'single_source_unverified',
    evidenceSourceIds: sources,
    requiresFactCheck: true,
    reasons: confirmationSources.length === 1
      ? ['Only one confirmation-eligible source currently supports this story.']
      : ['Discovery-only sources support this story; official or confirmation-eligible verification is still required.'],
  };
}

const TITLE_STOP_WORDS = new Set([
  'a', 'an', 'and', 'announced', 'announces', 'are', 'at', 'for', 'from', 'get', 'gets', 'in', 'is',
  'launch', 'launched', 'launches', 'new', 'of', 'on', 'the', 'to', 'with',
]);

const TITLE_TOKEN_ALIASES: Record<string, string> = {
  bonuses: 'bonus',
  cards: 'card',
  offers: 'offer',
};

function titleTokens(title: string): Set<string> {
  return new Set(
    title.toLocaleLowerCase('en-US')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .filter((token) => token.length > 1 && !TITLE_STOP_WORDS.has(token))
      .map((token) => TITLE_TOKEN_ALIASES[token] ?? token),
  );
}

function meaningfulNumbers(tokens: Set<string>): string[] {
  return [...tokens].filter((token) => /\d/.test(token)).sort();
}

/** Conservative cross-publisher near-title match for the same reported event. */
export function titlesDescribeSameStory(left: string, right: string): boolean {
  const a = titleTokens(left);
  const b = titleTokens(right);
  if (a.size < 5 || b.size < 5) return false;
  if (meaningfulNumbers(a).join('|') !== meaningfulNumbers(b).join('|')) return false;
  const intersection = [...a].filter((token) => b.has(token)).length;
  const union = new Set([...a, ...b]).size;
  return intersection / union >= 0.72;
}

export interface DeduplicationProgressEvent {
  phase: 'run_started' | 'record_started' | 'record_canonicalized' | 'record_archived' | 'record_skipped' | 'record_failed' | 'run_completed';
  message: string;
  completed?: number;
  total?: number;
}

export async function runDedupeStage(
  root: string,
  now = new Date(),
  onProgress?: (event: DeduplicationProgressEvent) => void,
): Promise<PipelineRunManifest> {
  const progress = (event: DeduplicationProgressEvent): void => {
    try {
      onProgress?.(event);
    } catch {
      // Reporting must never interrupt durable pipeline work.
    }
  };
  return withStageLock(root, 'deduplication', async () => {
    const runId = createRunId(now);
    const manifest: PipelineRunManifest = {
      version: CREDDY_PIPELINE_VERSION,
      runId,
      campaignSlug: CREDDY_CAMPAIGN_SLUG,
      stage: 'deduplication',
      status: 'running',
      startedAt: now.toISOString(),
      inputCount: 0,
      outputCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errors: [],
    };
    await writeRunManifest(root, manifest);

    const canonicalDir = safeDataPath(root, '03-canonical-news', 'approved');
    const canonicalPaths = await listJsonFiles(canonicalDir);
    const existing: CanonicalNewsRecord[] = [];
    const quarantineDir = safeDataPath(root, '03-canonical-news', 'quarantined');
    await mkdir(quarantineDir, { recursive: true });
    for (const path of canonicalPaths) {
      const record = await readJson<CanonicalNewsRecord>(path);
      const qualityRejection = dataQualityRejection(record);
      const qualification = qualifyCreddyText(articleTextForQualification(record));
      if (qualityRejection || !qualification.qualifies) {
        const rejection: RejectedArticleRecord = {
          version: CREDDY_PIPELINE_VERSION,
          id: record.canonicalId,
          sourceRecordId: record.id,
          canonicalUrl: record.canonicalUrl,
          rejectedAt: now.toISOString(),
          dedupeRunId: runId,
          reason: qualityRejection?.reason ?? 'irrelevant',
          details: qualityRejection?.details ??
            'Legacy canonical record failed the strengthened travel/loyalty relevance gate.',
        };
        await writeJsonAtomic(
          safeDataPath(root, '03-canonical-news', 'rejected', `${record.canonicalId}.json`),
          rejection,
        );
        await rename(path, safeDataPath(quarantineDir, `${record.canonicalId}.json`));
        continue;
      }
      existing.push(record);
    }
    const rawRecords = await Promise.all(
      (await listJsonFiles(safeDataPath(root, '01-raw')))
        .map((path) => readJson<Pick<FilteredArticleRecord, 'id' | 'sourceId' | 'factualUse'>>(path)),
    );
    const evidenceByRawId = new Map(rawRecords.map((record) => [record.id, {
      sourceId: record.sourceId,
      factualUse: record.factualUse,
    }]));
    for (const record of existing) {
      const evidence = record.evidenceRecordIds
        .map((id) => evidenceByRawId.get(id))
        .filter((item): item is VerificationEvidence => Boolean(item));
      if (evidence.length === 0) evidence.push({ sourceId: record.sourceId, factualUse: record.factualUse });
      record.verification = verificationForEvidence(evidence);
      await writeJsonAtomic(safeDataPath(canonicalDir, `${record.canonicalId}.json`), record);
    }
    const byUrl = new Map(existing.map((record) => [record.canonicalUrl, record]));
    const byContent = new Map(existing.map((record) => [record.contentHash, record]));
    const byTitle = new Map(
      existing.filter((record) => record.titleFingerprint).map((record) => [record.titleFingerprint, record]),
    );

    const filteredPaths = await listJsonFiles(safeDataPath(root, '02-filtered'));
    progress({ phase: 'run_started', message: `Deduplicating ${filteredPaths.length} qualified records against ${existing.length} existing canonical records.`, completed: 0, total: filteredPaths.length });
    for (const path of filteredPaths) {
      manifest.inputCount += 1;
      try {
        const article = await readJson<FilteredArticleRecord>(path);
        progress({ phase: 'record_started', message: `Comparing: ${article.title || article.canonicalUrl}`, completed: manifest.inputCount - 1, total: filteredPaths.length });
        const processedMarker = safeDataPath(root, 'indexes', 'deduplicated', `${article.id}.json`);
        if (await pathExists(processedMarker)) {
          manifest.skippedCount += 1;
          progress({ phase: 'record_skipped', message: `Already deduplicated: ${article.title || article.canonicalUrl}`, completed: manifest.inputCount, total: filteredPaths.length });
          continue;
        }

        const exactTitleMatch = article.titleFingerprint ? byTitle.get(article.titleFingerprint) : undefined;
        const nearTitleMatch = exactTitleMatch ? undefined : existing.find((record) =>
          record.sourceId !== article.sourceId && titlesDescribeSameStory(record.title, article.title));
        const match =
          byUrl.get(article.canonicalUrl) ??
          byContent.get(article.contentHash) ??
          exactTitleMatch ??
          nearTitleMatch;
        if (match) {
          if (!match.evidenceRecordIds.includes(article.id)) {
            match.evidenceRecordIds.push(article.id);
            const evidence = match.evidenceRecordIds
              .map((id) => evidenceByRawId.get(id))
              .filter((item): item is VerificationEvidence => Boolean(item));
            if (!evidence.some((item) => item.sourceId === article.sourceId)) {
              evidence.push({ sourceId: article.sourceId, factualUse: article.factualUse });
            }
            match.verification = verificationForEvidence(evidence);
            await writeJsonAtomic(safeDataPath(canonicalDir, `${match.canonicalId}.json`), match);
          }
          const reason: RejectedArticleRecord['reason'] = byUrl.has(article.canonicalUrl)
            ? 'duplicate_url'
            : byContent.has(article.contentHash)
              ? 'duplicate_content'
              : 'duplicate_title';
          const duplicate: RejectedArticleRecord = {
            version: CREDDY_PIPELINE_VERSION,
            id: article.id,
            sourceRecordId: article.id,
            canonicalUrl: article.canonicalUrl,
            rejectedAt: now.toISOString(),
            dedupeRunId: runId,
            reason,
            details: `Attached as evidence to canonical record ${match.canonicalId}.`,
          };
          await writeJsonAtomic(
            safeDataPath(root, '03-canonical-news', 'archived', `${article.id}.json`),
            duplicate,
          );
          await writeJsonAtomic(processedMarker, { canonicalId: match.canonicalId, reason });
          manifest.skippedCount += 1;
          progress({ phase: 'record_archived', message: `Archived ${reason}; attached to ${match.canonicalId}: ${article.title || article.canonicalUrl}`, completed: manifest.inputCount, total: filteredPaths.length });
          continue;
        }

        const id = canonicalId(article);
        const canonical: CanonicalNewsRecord = {
          ...article,
          canonicalId: id,
          evidenceRecordIds: [article.id],
          cleanedMarkdown: cleanMarkdown(article.markdown),
          deduplicatedAt: now.toISOString(),
          verification: verificationForEvidence([{ sourceId: article.sourceId, factualUse: article.factualUse }]),
        };
        await writeJsonAtomic(safeDataPath(canonicalDir, `${id}.json`), canonical);
        await writeJsonAtomic(processedMarker, { canonicalId: id, reason: 'new_canonical' });
        byUrl.set(canonical.canonicalUrl, canonical);
        byContent.set(canonical.contentHash, canonical);
        if (canonical.titleFingerprint) byTitle.set(canonical.titleFingerprint, canonical);
        existing.push(canonical);
        manifest.outputCount += 1;
        progress({ phase: 'record_canonicalized', message: `New canonical (${canonical.verification?.status}): ${canonical.title || canonical.canonicalUrl}`, completed: manifest.inputCount, total: filteredPaths.length });
      } catch (error) {
        manifest.failedCount += 1;
        manifest.errors.push(`${path}: ${(error as Error).message}`);
        progress({ phase: 'record_failed', message: `Failed: ${path} — ${(error as Error).message}`, completed: manifest.inputCount, total: filteredPaths.length });
      }
    }
    manifest.completedAt = new Date().toISOString();
    manifest.status = manifest.failedCount === 0 ? 'completed' : 'partially_completed';
    await writeRunManifest(root, manifest);
    progress({ phase: 'run_completed', message: `Deduplication complete: ${manifest.outputCount} new canonical, ${manifest.skippedCount} duplicate/already processed, ${manifest.failedCount} failed.`, completed: filteredPaths.length, total: filteredPaths.length });
    return manifest;
  });
}
