import { copyFile } from 'node:fs/promises';
import { basename, isAbsolute } from 'node:path';

import { CREDDY_CAMPAIGN_SLUG } from './config.js';
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
  type ContentBankRecord,
  type ContentPackageRecord,
  type PipelineRunManifest,
  type VideoJobRecord,
} from './pipeline-types.js';
import type { VideoFactoryApi, VideoFactoryRemoteJob } from './video-factory-client.js';

export interface VideoStageOptions {
  root: string;
  client: VideoFactoryApi;
  musicPath?: string;
  now?: Date;
}

const CREDDY_POSE_ALIASES: Record<string, string> = {
  excited: 'starstruck',
  concerned: 'worried',
  celebrating: 'celebrate',
  pointing: 'guide',
  explaining: 'guide',
  urgent: 'surprised',
};

function creddyPose(value: string | undefined, index: number): string {
  const fallbacks = ['surprised', 'thinking', 'guide', 'celebrate'];
  return CREDDY_POSE_ALIASES[value ?? ''] ?? value ?? fallbacks[index % fallbacks.length];
}

export function buildCreddyVideoScript(content: ContentPackageRecord): string[] {
  const lines = [
    'brand: creddy',
    'accent: #D4AF5F',
  ];
  content.scriptLines.forEach((line, index) => {
      const existing = line.split('::').map((part) => part.trim());
      if (existing.length >= 2) {
        const label = existing[0] || (index === 0 ? 'CREDDY UPDATE' : 'CARD BENEFITS');
        const headline = existing[1];
        const subline = existing[2] ?? '';
        lines.push(`${label} :: ${headline} :: ${subline} :: ${creddyPose(content.characterExpressions?.[index], index)}`);
      } else {
        const label = index === 0 ? 'CREDDY UPDATE' : index === content.scriptLines.length - 1 ? 'OPEN CREDDY' : 'CARD BENEFITS';
        lines.push(`${label} :: ${line} :: :: ${creddyPose(content.characterExpressions?.[index], index)}`);
      }
      const narration = content.narrationLines?.[index]?.trim();
      if (narration) lines.push(`> ${narration}`);
  });
  return lines;
}

function mapStatus(status: string): VideoJobRecord['status'] {
  if (status === 'done') return 'done';
  if (status === 'failed') return 'failed';
  if (status === 'queue') return 'submitted';
  return 'rendering';
}

async function copyRenderedOutput(
  root: string,
  local: VideoJobRecord,
  remote: VideoFactoryRemoteJob,
): Promise<string> {
  if (!remote.output || !isAbsolute(remote.output)) {
    throw new Error(`Video Factory job ${remote.id} returned no absolute output path`);
  }
  const destination = safeDataPath(
    root,
    '08-rendered-videos',
    local.format === 'narrated' ? 'narrated' : 'text-music',
    `${local.contentPackageId}-r${local.revision}-${basename(remote.output)}`,
  );
  if (!(await pathExists(destination))) await copyFile(remote.output, destination);
  return destination;
}

export async function runVideoStage(options: VideoStageOptions): Promise<PipelineRunManifest> {
  const now = options.now ?? new Date();
  return withStageLock(options.root, 'video_rendering', async () => {
    const runId = createRunId(now);
    const manifest: PipelineRunManifest = {
      version: CREDDY_PIPELINE_VERSION,
      runId,
      campaignSlug: CREDDY_CAMPAIGN_SLUG,
      stage: 'video_rendering',
      status: 'running',
      startedAt: now.toISOString(),
      inputCount: 0,
      outputCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errors: [],
    };
    await writeRunManifest(options.root, manifest);

    const capabilities = await options.client.getCapabilities();
    const modes = new Set(capabilities.capabilities?.audio_modes ?? []);
    if (!modes.has('narrated') || !modes.has('text_music')) {
      throw new Error('Video Factory does not expose narrated and text_music capabilities');
    }
    if (capabilities.capabilities?.styles
      && !capabilities.capabilities.styles.includes('creddy')) {
      throw new Error('Video Factory does not expose the Creddy renderer');
    }

    const jobPaths = await listJsonFiles(safeDataPath(options.root, '07-video-jobs'));
    const jobs = await Promise.all(jobPaths.map((path) => readJson<VideoJobRecord>(path)));
    manifest.inputCount = jobs.length;

    for (let index = 0; index < jobs.length; index += 1) {
      const job = jobs[index];
      if (job.status !== 'queued') continue;
      try {
        if (job.format === 'text_music' && !options.musicPath) {
          throw new Error('Text + music job requires CREDDY_BACKGROUND_MUSIC_PATH');
        }
        const content = await readJson<ContentPackageRecord>(
          safeDataPath(options.root, '06-content-packages', `${job.contentPackageId}.json`),
        );
        const remote = await options.client.submitJob({
          external_id: job.id,
          campaign_slug: CREDDY_CAMPAIGN_SLUG,
          title: content.hook,
          script: buildCreddyVideoScript(content),
          keyword: content.imagePrompts[0] ?? 'travel rewards',
          format: '9:16',
          audio_mode: job.format,
          music_path: job.format === 'text_music' ? options.musicPath : undefined,
          background_path: content.imagePaths?.[0],
          character_expressions: content.characterExpressions,
          voice: 'cloned',
          style: 'creddy',
          theme: content.visualTheme ?? 'editorial',
        });
        job.videoFactoryJobId = remote.id;
        job.status = mapStatus(remote.status);
        job.updatedAt = now.toISOString();
        await writeJsonAtomic(jobPaths[index], job);
      } catch (error) {
        manifest.failedCount += 1;
        manifest.errors.push(`${job.id}: ${(error as Error).message}`);
      }
    }

    const remoteById = new Map(
      (await options.client.listJobs()).map((remote) => [remote.id, remote]),
    );
    for (let index = 0; index < jobs.length; index += 1) {
      const job = await readJson<VideoJobRecord>(jobPaths[index]);
      if (!job.videoFactoryJobId || (job.status === 'done' && job.outputPath)) {
        manifest.skippedCount += 1;
        continue;
      }
      const remote = remoteById.get(job.videoFactoryJobId);
      if (!remote) continue;
      try {
        job.status = mapStatus(remote.status);
        job.updatedAt = new Date().toISOString();
        job.error = remote.error;
        if (job.status === 'done') {
          job.outputPath = await copyRenderedOutput(options.root, job, remote);
          manifest.outputCount += 1;
        } else if (job.status === 'failed') {
          manifest.failedCount += 1;
          manifest.errors.push(`${job.id}: ${remote.error ?? 'Video Factory failed'}`);
        }
        await writeJsonAtomic(jobPaths[index], job);
      } catch (error) {
        manifest.failedCount += 1;
        manifest.errors.push(`${job.id}: ${(error as Error).message}`);
      }
    }
    manifest.completedAt = new Date().toISOString();
    manifest.status = manifest.failedCount === 0 ? 'completed' : 'partially_completed';
    await writeRunManifest(options.root, manifest);
    return manifest;
  });
}

export async function runContentBankHandoff(root: string, now = new Date()): Promise<number> {
  const jobs = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '07-video-jobs'))).map((path) =>
      readJson<VideoJobRecord>(path),
    ),
  );
  const byContent = new Map<string, VideoJobRecord[]>();
  for (const job of jobs) {
    const group = byContent.get(job.contentPackageId) ?? [];
    group.push(job);
    byContent.set(job.contentPackageId, group);
  }
  let created = 0;
  for (const [contentPackageId, group] of byContent) {
    const destination = safeDataPath(root, '09-pending-approval', `${contentPackageId}.json`);
    const existing = (await pathExists(destination))
      ? await readJson<ContentBankRecord>(destination)
      : undefined;
    const targetRevision = existing && ['changes_requested', 'rendering_revision'].includes(existing.status)
      ? existing.revision
      : Math.max(...group.map((job) => job.revision));
    const narrated = group.find((job) => job.revision === targetRevision && job.format === 'narrated' && job.status === 'done');
    const textMusic = group.find((job) => job.revision === targetRevision && job.format === 'text_music' && job.status === 'done');
    if (!narrated || !textMusic) continue;
    if (existing && !['changes_requested', 'rendering_revision'].includes(existing.status)) continue;
    const content = await readJson<ContentPackageRecord>(
      safeDataPath(root, '06-content-packages', `${contentPackageId}.json`),
    );
    const articleBlockers = content.article && content.articleReadiness !== 'ready_for_review'
      ? ['One or more Agent 05 article visuals do not have approved asset files yet.']
      : [];
    const record: ContentBankRecord = {
      ...existing,
      version: CREDDY_PIPELINE_VERSION,
      id: contentPackageId,
      contentPackageId,
      createdAt: now.toISOString(),
      status: 'pending_review',
      textMusicVideoPath: textMusic.outputPath,
      narratedVideoPath: narrated.outputPath,
      articlePreviewPath: content.articlePreviewPath,
      articleReview: content.article ? {
        status: articleBlockers.length ? 'needs_assets' : 'pending_review',
        blockers: articleBlockers,
      } : undefined,
      revision: targetRevision,
      changeRequest: undefined,
      approvedBy: undefined,
      approvedAt: undefined,
      destinations: undefined,
      rejectedBy: undefined,
      rejectedAt: undefined,
      rejectionReason: undefined,
    };
    await writeJsonAtomic(destination, record);
    created += 1;
  }
  return created;
}

export async function runArticleContentBankHandoff(root: string, now = new Date()): Promise<number> {
  let created = 0;
  const packagePaths = (await listJsonFiles(safeDataPath(root, '06-content-packages')))
    .filter((path) => /\/production-[^/]+\.json$/.test(path) && !path.includes('/legacy/'));
  for (const path of packagePaths) {
    const content = await readJson<ContentPackageRecord>(path);
    if (content.distributionMode !== 'article_only' || !content.article || !content.articlePreviewPath) continue;
    const id = `article-${content.id}`;
    const destination = safeDataPath(root, '09-pending-approval', `${id}.json`);
    const existing = await pathExists(destination) ? await readJson<ContentBankRecord>(destination) : undefined;
    if (existing && !['pending_review', 'changes_requested', 'rendering_revision'].includes(existing.status)) continue;
    const blockers = content.articleReadiness === 'ready_for_review'
      ? []
      : ['One or more Agent 05 article visuals do not have approved asset files yet.'];
    const record: ContentBankRecord = {
      ...existing,
      version: CREDDY_PIPELINE_VERSION,
      id,
      contentPackageId: content.id,
      mediaType: 'article',
      contentDraftId: content.contentDraftId,
      visualPlanId: content.visualPlanId,
      articlePreviewPath: content.articlePreviewPath,
      articleReview: {
        status: blockers.length ? 'needs_assets' : 'pending_review',
        blockers,
      },
      createdAt: existing?.createdAt ?? now.toISOString(),
      status: 'pending_review',
      revision: existing?.revision ?? 1,
      changeRequest: undefined,
      approvedBy: undefined,
      approvedAt: undefined,
      destinations: undefined,
      rejectedBy: undefined,
      rejectedAt: undefined,
      rejectionReason: undefined,
    };
    await writeJsonAtomic(destination, record);
    created += existing ? 0 : 1;
  }
  return created;
}

export async function rejectContentBankItem(
  root: string,
  input: { id: string; rejectedBy: string; reason: string },
  now = new Date(),
): Promise<ContentBankRecord> {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(input.id)) {
    throw new Error('Invalid Content Bank id');
  }
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 2000) {
    throw new Error('Rejection reason must be 5–2000 characters');
  }
  const pendingPath = safeDataPath(root, '09-pending-approval', `${input.id}.json`);
  const pending = await readJson<ContentBankRecord>(pendingPath);
  if (!['pending_review', 'changes_requested'].includes(pending.status)) {
    throw new Error(`Cannot reject an item in ${pending.status} state`);
  }
  const rejected: ContentBankRecord = {
    ...pending,
    status: 'rejected',
    rejectedBy: input.rejectedBy.trim() || 'human-reviewer',
    rejectedAt: now.toISOString(),
    rejectionReason: reason,
  };
  await writeJsonAtomic(pendingPath, rejected);
  await writeJsonAtomic(safeDataPath(root, '13-rejected-content', `${input.id}.json`), rejected);
  return rejected;
}

export async function approveContentBankItem(
  root: string,
  input: {
    id: string;
    approvedBy: string;
    destinations: Array<{
      format: 'text_music' | 'narrated' | 'article';
      platform: 'instagram' | 'tiktok' | 'creddy_website';
      account: string;
      scheduledFor: string;
    }>;
  },
  now = new Date(),
): Promise<ContentBankRecord> {
  if (!input.approvedBy.trim()) throw new Error('Approver identity is required');
  if (!Array.isArray(input.destinations) || input.destinations.length === 0) {
    throw new Error('At least one publishing destination is required');
  }
  const destinations = input.destinations.map((destination) => {
    const isArticle = destination.format === 'article' || destination.platform === 'creddy_website';
    if (isArticle && (destination.format !== 'article' || destination.platform !== 'creddy_website')) {
      throw new Error('Website destinations must use article format on creddy_website');
    }
    if (!isArticle && !['instagram', 'tiktok'].includes(destination.platform)) {
      throw new Error('Social video destinations must use Instagram or TikTok');
    }
    if (!destination.account.trim()) throw new Error('Publishing account is required');
    const scheduled = new Date(destination.scheduledFor);
    if (!Number.isFinite(scheduled.getTime()) || scheduled <= now) {
      throw new Error('Every scheduledFor value must be a valid future date');
    }
    return { ...destination, scheduledFor: scheduled.toISOString(), status: 'pending' as const };
  });
  const uniqueDestinations = new Set(
    destinations.map((destination) =>
      `${destination.platform}:${destination.account}:${destination.format}`,
    ),
  );
  if (uniqueDestinations.size !== destinations.length) throw new Error('Duplicate publishing destination');
  const pendingPath = safeDataPath(root, '09-pending-approval', `${input.id}.json`);
  const pending = await readJson<ContentBankRecord>(pendingPath);
  if (pending.status !== 'pending_review' && pending.status !== 'changes_requested') {
    throw new Error(`Content item cannot be approved from status ${pending.status}`);
  }
  const approvesArticle = destinations.some((destination) => destination.format === 'article');
  if (approvesArticle) {
    if (!pending.articleReview) throw new Error('Content item has no website article to approve');
    if (pending.articleReview.status === 'needs_assets' || pending.articleReview.blockers?.length) {
      throw new Error('Website article cannot be approved until all planned assets are ready');
    }
  }
  const approved: ContentBankRecord = {
    ...pending,
    status: 'approved',
    approvedBy: input.approvedBy,
    approvedAt: now.toISOString(),
    articleReview: approvesArticle ? {
      ...pending.articleReview!,
      status: 'approved',
      approvedBy: input.approvedBy,
      approvedAt: now.toISOString(),
      blockers: [],
    } : pending.articleReview,
    destinations,
  };
  await writeJsonAtomic(safeDataPath(root, '10-approved', `${approved.id}.json`), approved);
  await writeJsonAtomic(pendingPath, approved);
  await writeJsonAtomic(
    safeDataPath(root, '11-scheduled', `${approved.id}.json`),
    { ...approved, status: 'scheduled' },
  );
  return approved;
}
