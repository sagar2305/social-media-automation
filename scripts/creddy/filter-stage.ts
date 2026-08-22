import { CREDDY_CAMPAIGN_SLUG } from './config.js';
import {
  createRunId,
  listJsonFiles,
  pathExists,
  readJson,
  runDate,
  safeDataPath,
  withStageLock,
  writeJsonAtomic,
  writeRunManifest,
} from './pipeline-store.js';
import {
  CREDDY_PIPELINE_VERSION,
  type FilteredArticleRecord,
  type PipelineRunManifest,
  type RawArticleRecord,
  type RejectedArticleRecord,
} from './pipeline-types.js';
import { qualifyCreddyText } from './qualification.js';

const ARTICLE_END_MARKERS = [
  /^#{1,6}\s+(?:you may also like|related articles?|comments?|subscribe)\b/i,
  /^notify of$/i,
  /^comment author info\b/i,
  /^- \[home\]\(/i,
];

/** Keep navigation, related-post cards, and long comment/footer text from
 * satisfying the OR keyword gate for an otherwise unrelated article. */
export function articleTextForQualification(raw: RawArticleRecord): string {
  const body: string[] = [];
  for (const line of raw.markdown.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (ARTICLE_END_MARKERS.some((pattern) => pattern.test(trimmed))) break;
    body.push(line);
  }
  return `${raw.title}\n${body.join('\n').slice(0, 20_000)}`;
}

export function dataQualityRejection(raw: RawArticleRecord): Pick<RejectedArticleRecord, 'reason' | 'details'> | undefined {
  const title = raw.title.trim();
  const meaningfulBody = articleTextForQualification(raw)
    .replace(/[#>*_`\[\]()!-]/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const statusCode = Number(raw.providerMetadata.statusCode ?? 200);
  if (Number.isFinite(statusCode) && statusCode >= 400) {
    return { reason: 'invalid_source_response', details: `Provider returned HTTP ${statusCode}.` };
  }
  if (!title || /^(home|news|blog|forum|search|subscribe|contact|privacy|advertising policy)$/i.test(title)) {
    return { reason: 'non_article', details: 'The fetched page has a navigation or non-article title.' };
  }
  if (meaningfulBody.length < 80) {
    return { reason: 'insufficient_content', details: 'Too little article text was available for safe processing.' };
  }
  return undefined;
}

export interface FilteringProgressEvent {
  phase: 'run_started' | 'record_started' | 'record_qualified' | 'record_rejected' | 'record_skipped' | 'record_failed' | 'run_completed';
  message: string;
  completed?: number;
  total?: number;
}

export async function runFilterStage(
  root: string,
  now = new Date(),
  onProgress?: (event: FilteringProgressEvent) => void,
): Promise<PipelineRunManifest> {
  const progress = (event: FilteringProgressEvent): void => {
    try {
      onProgress?.(event);
    } catch {
      // Reporting must never interrupt durable pipeline work.
    }
  };
  return withStageLock(root, 'filtering', async () => {
    const runId = createRunId(now);
    const manifest: PipelineRunManifest = {
      version: CREDDY_PIPELINE_VERSION,
      runId,
      campaignSlug: CREDDY_CAMPAIGN_SLUG,
      stage: 'filtering',
      status: 'running',
      startedAt: now.toISOString(),
      inputCount: 0,
      outputCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errors: [],
    };
    await writeRunManifest(root, manifest);

    const rawPaths = await listJsonFiles(safeDataPath(root, '01-raw'));
    progress({ phase: 'run_started', message: `Filtering ${rawPaths.length} retained raw records.`, completed: 0, total: rawPaths.length });
    for (const path of rawPaths) {
      manifest.inputCount += 1;
      try {
        const raw = await readJson<RawArticleRecord>(path);
        progress({ phase: 'record_started', message: `Checking: ${raw.title || raw.canonicalUrl}`, completed: manifest.inputCount - 1, total: rawPaths.length });
        const filteredPath = safeDataPath(root, '02-filtered', runDate(raw.runId), raw.runId, `${raw.id}.json`);
        const rejectedPath = safeDataPath(root, '03-canonical-news', 'rejected', `${raw.id}.json`);
        if ((await pathExists(filteredPath)) || (await pathExists(rejectedPath))) {
          manifest.skippedCount += 1;
          progress({ phase: 'record_skipped', message: `Already classified: ${raw.title || raw.canonicalUrl}`, completed: manifest.inputCount, total: rawPaths.length });
          continue;
        }

        const qualityRejection = dataQualityRejection(raw);
        if (qualityRejection) {
          const rejection: RejectedArticleRecord = {
            version: CREDDY_PIPELINE_VERSION,
            id: raw.id,
            sourceRecordId: raw.id,
            canonicalUrl: raw.canonicalUrl,
            rejectedAt: now.toISOString(),
            ...qualityRejection,
          };
          await writeJsonAtomic(rejectedPath, rejection);
          manifest.skippedCount += 1;
          progress({ phase: 'record_rejected', message: `Rejected (${qualityRejection.reason}): ${raw.title || raw.canonicalUrl}`, completed: manifest.inputCount, total: rawPaths.length });
          continue;
        }

        const qualification = qualifyCreddyText(articleTextForQualification(raw));
        if (!qualification.qualifies) {
          const rejection: RejectedArticleRecord = {
            version: CREDDY_PIPELINE_VERSION,
            id: raw.id,
            sourceRecordId: raw.id,
            canonicalUrl: raw.canonicalUrl,
            rejectedAt: now.toISOString(),
            reason: 'keyword_gate',
            details: 'No configured OR keyword matched in travel-rewards context.',
          };
          await writeJsonAtomic(rejectedPath, rejection);
          manifest.skippedCount += 1;
          progress({ phase: 'record_rejected', message: `Rejected (keyword_gate): ${raw.title || raw.canonicalUrl}`, completed: manifest.inputCount, total: rawPaths.length });
          continue;
        }

        const filtered: FilteredArticleRecord = {
          ...raw,
          qualification: {
            qualifies: true,
            matchedKeywords: qualification.matchedKeywords,
          },
        };
        await writeJsonAtomic(filteredPath, filtered);
        manifest.outputCount += 1;
        progress({ phase: 'record_qualified', message: `Qualified [${qualification.matchedKeywords.join(', ')}]: ${raw.title || raw.canonicalUrl}`, completed: manifest.inputCount, total: rawPaths.length });
      } catch (error) {
        manifest.failedCount += 1;
        manifest.errors.push(`${path}: ${(error as Error).message}`);
        progress({ phase: 'record_failed', message: `Failed: ${path} — ${(error as Error).message}`, completed: manifest.inputCount, total: rawPaths.length });
      }
    }
    manifest.completedAt = new Date().toISOString();
    manifest.status = manifest.failedCount === 0 ? 'completed' : 'partially_completed';
    await writeRunManifest(root, manifest);
    progress({ phase: 'run_completed', message: `Filtering complete: ${manifest.outputCount} qualified, ${manifest.skippedCount} rejected/already classified, ${manifest.failedCount} failed.`, completed: rawPaths.length, total: rawPaths.length });
    return manifest;
  });
}
