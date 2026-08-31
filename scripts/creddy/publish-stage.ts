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
} from './pipeline-types.js';
import type { BlotatoApi } from './blotato-client.js';
import { notifyCreddyPublished, type CreddyPublishedSlackEvent } from './slack-notifications.js';
import { assertSocialVerificationSatisfied, assertVerificationGateIntegrity } from './publication-policy.js';

export async function runPublishStage(
  root: string,
  client: BlotatoApi,
  now = new Date(),
  leadMinutes = 15,
): Promise<PipelineRunManifest> {
  return withStageLock(root, 'publishing', async () => {
    const runId = createRunId(now);
    const manifest: PipelineRunManifest = {
      version: CREDDY_PIPELINE_VERSION,
      runId,
      campaignSlug: CREDDY_CAMPAIGN_SLUG,
      stage: 'publishing',
      status: 'running',
      startedAt: now.toISOString(),
      inputCount: 0,
      outputCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errors: [],
    };
    await writeRunManifest(root, manifest);

    for (const path of await listJsonFiles(safeDataPath(root, '11-scheduled'))) {
      manifest.inputCount += 1;
      try {
        const bank = await readJson<ContentBankRecord>(path);
        if (!bank.approvedBy || !bank.approvedAt || !bank.destinations?.length) {
          throw new Error('Scheduled content is missing human approval or destinations');
        }
        const content = await readJson<ContentPackageRecord>(
          safeDataPath(root, '06-content-packages', `${bank.contentPackageId}.json`),
        );
        assertVerificationGateIntegrity(bank, content);
        if (bank.destinations.some((destination) =>
          destination.platform !== 'creddy_website' && destination.format !== 'article')) {
          assertSocialVerificationSatisfied(bank.verificationGate, bank.revision);
        }
        const publishedNotifications: CreddyPublishedSlackEvent[] = [];
        for (const destination of bank.destinations) {
          if (destination.status === 'published' || destination.status === 'failed') continue;
          if (destination.platform === 'creddy_website' || destination.format === 'article') {
            // Website articles use the separate human-approved export boundary.
            // Blotato must never receive an article destination.
            manifest.skippedCount += 1;
            continue;
          }
          if (destination.submissionId) {
            const remote = await client.getPostStatus(destination.submissionId);
            destination.lastCheckedAt = now.toISOString();
            if (remote.status === 'published') {
              destination.status = 'published';
              destination.publishedAt ??= now.toISOString();
              destination.publishedUrl = remote.url;
              manifest.outputCount += 1;
              publishedNotifications.push({
                id: bank.id,
                hook: content.hook,
                platform: destination.platform,
                account: destination.account,
                publishedAt: destination.publishedAt,
                publishedUrl: destination.publishedUrl,
              });
            } else if (remote.status === 'failed') {
              destination.status = 'failed';
              destination.error = remote.error ?? 'Blotato publishing failed';
              manifest.failedCount += 1;
            }
            continue;
          }

          const scheduled = new Date(destination.scheduledFor);
          const untilSchedule = scheduled.getTime() - now.getTime();
          if (untilSchedule > leadMinutes * 60 * 1000) {
            manifest.skippedCount += 1;
            continue;
          }
          if (untilSchedule < -5 * 60 * 1000) {
            destination.status = 'failed';
            destination.error = 'Missed publishing window; manual review required';
            manifest.failedCount += 1;
            continue;
          }
          const videoPath =
            destination.format === 'narrated'
              ? bank.narratedVideoPath
              : bank.textMusicVideoPath;
          if (!videoPath || !(await pathExists(videoPath))) {
            throw new Error(`Approved ${destination.format} video is missing`);
          }
          const created = await client.scheduleVideo({
            platform: destination.platform,
            account: destination.account,
            caption: `${content.platformCaptions?.[destination.platform] ?? content.caption}\n\n${content.hashtags.map((tag) => `#${tag.replace(/^#/, '')}`).join(' ')}`.trim(),
            title: content.hook,
            videoPath,
            scheduledFor: destination.scheduledFor,
          });
          destination.submissionId = created.submissionId;
          destination.mediaUrl = created.mediaUrl;
          destination.status = 'submitted';
          destination.submittedAt ??= now.toISOString();
        }
        await writeJsonAtomic(path, bank);
        for (const notification of publishedNotifications) {
          await notifyCreddyPublished(notification);
        }
        if (bank.destinations.every((destination) => destination.status === 'published')) {
          await writeJsonAtomic(
            safeDataPath(root, '12-published', `${bank.id}.json`),
            { ...bank, status: 'published' },
          );
        }
      } catch (error) {
        manifest.failedCount += 1;
        manifest.errors.push(`${path}: ${(error as Error).message}`);
      }
    }
    manifest.completedAt = new Date().toISOString();
    manifest.status = manifest.failedCount === 0 ? 'completed' : 'partially_completed';
    await writeRunManifest(root, manifest);
    return manifest;
  });
}
