import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';

import {
  listJsonFiles,
  pathExists,
  readJson,
  safeDataPath,
  writeJsonAtomic,
} from './pipeline-store.js';
import {
  CREDDY_PIPELINE_VERSION,
  type AnalysisDecisionRecord,
  type ContentBankRecord,
  type ContentPackageRecord,
  type VideoJobRecord,
} from './pipeline-types.js';

export function validateContentPackage(content: ContentPackageRecord): ContentPackageRecord {
  if (content.version !== CREDDY_PIPELINE_VERSION) throw new Error('Invalid content version');
  if (!content.id || !content.analysisId || !content.canonicalId) {
    throw new Error('Content package IDs are required');
  }
  if (!['act_now', 'understand', 'decide_or_discuss'].includes(content.slot)) {
    throw new Error('Invalid content slot');
  }
  if (!content.hook.trim()) throw new Error('Content hook is required');
  if (!Array.isArray(content.scriptLines) || content.scriptLines.length < 2) {
    throw new Error('Content package requires at least two script lines');
  }
  if (!content.caption.trim()) throw new Error('Content caption is required');
  if (!content.cta?.deepLink.startsWith('creddy://')) {
    throw new Error('Creddy CTA must use a creddy:// deep link');
  }
  if (!Array.isArray(content.sourceUrls) || content.sourceUrls.length === 0) {
    throw new Error('Content package requires source URLs');
  }
  for (const url of content.sourceUrls) {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Invalid source URL');
  }
  if (!Array.isArray(content.factualClaims)) throw new Error('factualClaims must be an array');
  if (content.characterExpressions !== undefined) {
    const supported = new Set([
      'neutral', 'waving', 'thinking', 'idea', 'worried', 'surprised',
      'sleepy', 'starstruck', 'sad', 'wink', 'card', 'thumbs-up',
      'guide', 'rewards', 'celebrate',
      'excited', 'concerned', 'celebrating', 'pointing', 'explaining', 'urgent',
    ]);
    if (!Array.isArray(content.characterExpressions)
      || content.characterExpressions.length !== content.scriptLines.length
      || content.characterExpressions.some((expression) => !supported.has(expression))) {
      throw new Error('characterExpressions must contain one supported expression per script line');
    }
  }
  return content;
}

function videoJobId(contentId: string, format: VideoJobRecord['format'], revision: number): string {
  return createHash('sha256').update(`${contentId}:${format}:${revision}`).digest('hex').slice(0, 24);
}

export async function writeContentAndJobs(
  root: string,
  content: ContentPackageRecord,
  revision: number,
): Promise<VideoJobRecord[]> {
  const imageRoot = safeDataPath(root, '06-content-packages', 'images');
  for (const path of content.imagePaths ?? []) {
    if (!isAbsolute(path)) throw new Error('Generated image paths must be absolute');
    const rel = relative(imageRoot, resolve(path));
    if (rel.startsWith('..') || isAbsolute(rel)) {
      throw new Error('Generated image path must stay inside the Creddy images directory');
    }
    if (!(await pathExists(path))) throw new Error(`Generated image is missing: ${path}`);
  }
  await writeJsonAtomic(safeDataPath(root, '06-content-packages', `${content.id}.json`), content);
  await writeJsonAtomic(safeDataPath(root, '06-content-packages', 'scripts', `${content.id}.json`),
    {
      id: content.id,
      revision,
      hook: content.hook,
      scriptLines: content.scriptLines,
      characterExpressions: content.characterExpressions ?? [],
    });
  await writeJsonAtomic(safeDataPath(root, '06-content-packages', 'captions', `${content.id}.json`),
    { id: content.id, revision, caption: content.caption, hashtags: content.hashtags, cta: content.cta });
  await writeJsonAtomic(safeDataPath(root, '06-content-packages', 'briefs', `${content.id}.json`),
    { id: content.id, revision, brief: content.brief, sourceUrls: content.sourceUrls });
  await writeJsonAtomic(safeDataPath(root, '06-content-packages', 'images', `${content.id}.json`),
    { id: content.id, revision, prompts: content.imagePrompts, paths: content.imagePaths ?? [] });

  const now = new Date().toISOString();
  const jobs: VideoJobRecord[] = (['text_music', 'narrated'] as const).map((format) => ({
    version: CREDDY_PIPELINE_VERSION,
    id: videoJobId(content.id, format, revision),
    contentPackageId: content.id,
    revision,
    format,
    status: 'queued',
    createdAt: now,
    updatedAt: now,
  }));
  for (const job of jobs) await writeJsonAtomic(safeDataPath(root, '07-video-jobs', `${job.id}.json`), job);
  return jobs;
}

export async function listPendingContentOpportunities(
  root: string,
): Promise<AnalysisDecisionRecord[]> {
  const result: AnalysisDecisionRecord[] = [];
  for (const path of await listJsonFiles(safeDataPath(root, '05-content-opportunities'))) {
    const opportunity = await readJson<AnalysisDecisionRecord>(path);
    const completed = safeDataPath(root, '06-content-packages', `${opportunity.id}.json`);
    if (!(await pathExists(completed))) result.push(opportunity);
  }
  return result;
}

export async function acceptContentPackage(
  root: string,
  unvalidated: ContentPackageRecord,
): Promise<VideoJobRecord[]> {
  const content = validateContentPackage(unvalidated);
  const opportunityPath = safeDataPath(root, '05-content-opportunities', `${content.analysisId}.json`);
  if (!(await pathExists(opportunityPath))) {
    throw new Error(`Content opportunity not found: ${content.analysisId}`);
  }
  const opportunity = await readJson<AnalysisDecisionRecord>(opportunityPath);
  if (opportunity.route !== 'auto_process') throw new Error('Only auto_process items can generate content');
  if (opportunity.canonicalId !== content.canonicalId) throw new Error('Content canonical identity mismatch');
  return writeContentAndJobs(root, content, 1);
}

export async function listPendingContentRevisions(root: string): Promise<Array<{
  bank: ContentBankRecord;
  content: ContentPackageRecord;
}>> {
  const revisions: Array<{ bank: ContentBankRecord; content: ContentPackageRecord }> = [];
  for (const path of await listJsonFiles(safeDataPath(root, '09-pending-approval'))) {
    const bank = await readJson<ContentBankRecord>(path);
    if (bank.status !== 'changes_requested' || !bank.changeRequest) continue;
    revisions.push({
      bank,
      content: await readJson<ContentPackageRecord>(
        safeDataPath(root, '06-content-packages', `${bank.contentPackageId}.json`),
      ),
    });
  }
  return revisions;
}

export async function acceptContentRevision(
  root: string,
  unvalidated: ContentPackageRecord,
): Promise<VideoJobRecord[]> {
  const content = validateContentPackage(unvalidated);
  const bank = await readJson<ContentBankRecord>(
    safeDataPath(root, '09-pending-approval', `${content.id}.json`),
  );
  if (bank.status !== 'changes_requested' || !bank.changeRequest) {
    throw new Error('Content item has no pending revision request');
  }
  if (bank.contentPackageId !== content.id) throw new Error('Revision identity mismatch');
  const original = await readJson<ContentPackageRecord>(
    safeDataPath(root, '06-content-packages', `${bank.contentPackageId}.json`),
  );
  if (original.analysisId !== content.analysisId || original.canonicalId !== content.canonicalId) {
    throw new Error('Revision cannot change analysis or canonical identity');
  }
  const jobs = await writeContentAndJobs(root, content, bank.revision);
  await writeJsonAtomic(
    safeDataPath(root, '09-pending-approval', `${content.id}.json`),
    { ...bank, status: 'rendering_revision' },
  );
  return jobs;
}
