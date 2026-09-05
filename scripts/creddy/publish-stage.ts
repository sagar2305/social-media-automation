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
import { notifyCreddyPublished } from './slack-notifications.js';
import { assertAutoUrgentAuthorizationCurrent, assertProductionAuthorizationCurrent, assertSocialVerificationSatisfied, assertVerificationGateIntegrity } from './publication-policy.js';

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
        // A recorded remote submission is already a side effect. Read its status
        // even if its historical local package is gone; never recreate it.
        for (const destination of bank.destinations ?? []) {
          if (!destination.submissionId || ['published', 'failed'].includes(destination.status)
            || destination.platform === 'creddy_website' || destination.format === 'article') continue;
          try {
            const remote = await client.getPostStatus(destination.submissionId);
            destination.lastCheckedAt = now.toISOString();
            const isDraft = destination.mode === 'tiktok_draft' || destination.status === 'draft_sent'
              || String(destination.status) === 'blotato_draft';
            if (remote.status === 'published' && !isDraft) {
              destination.status = 'published';
              destination.publishedAt ??= now.toISOString();
              destination.publishedUrl = remote.url;
              destination.error = undefined;
              manifest.outputCount++;
            } else if (remote.status === 'failed') {
              destination.status = 'failed';
              destination.error = 'Remote publishing failed; inspect the existing submission.';
              manifest.failedCount++;
            } else if (isDraft && remote.status === 'published') {
              // Provider success for a TikTok inbox upload is not a public post.
              destination.status = 'draft_sent';
              manifest.skippedCount++;
            }
            await writeJsonAtomic(path, bank);
            if (destination.status === 'published') {
              await notifyCreddyPublished({ id: bank.id, hook: bank.id, platform: destination.platform,
                account: destination.account, publishedAt: destination.publishedAt!, publishedUrl: destination.publishedUrl });
            }
          } catch {
            manifest.failedCount++;
            manifest.errors.push(`${bank.id}: ${destination.platform} status reconciliation failed; existing submission retained.`);
          }
        }
        const pending = bank.destinations?.filter(destination => !destination.submissionId
          && !['published', 'failed'].includes(destination.status)
          && destination.platform !== 'creddy_website' && destination.format !== 'article') ?? [];
        if (!pending.length && bank.destinations?.length) {
          if (bank.destinations.every(destination => destination.status === 'published')) {
            await writeJsonAtomic(safeDataPath(root, '12-published', `${bank.id}.json`), { ...bank, status: 'published' });
          }
          continue;
        }
        if (!bank.approvedBy || !bank.approvedAt || !bank.destinations?.length) {
          throw new Error('Scheduled content is missing a valid approval or destinations');
        }
        const content = await readJson<ContentPackageRecord>(
          safeDataPath(root, '06-content-packages', `${bank.contentPackageId}.json`),
        );
        if (bank.mediaType === 'slideshow') throw new Error('New slideshow delivery requires its dedicated approved image publishing path');
        assertVerificationGateIntegrity(bank, content);
        await assertProductionAuthorizationCurrent(root, bank, now);
        if (bank.destinations.some((destination) =>
          destination.platform !== 'creddy_website' && destination.format !== 'article')) {
          assertSocialVerificationSatisfied(bank.verificationGate, bank.revision);
        }
        for (const destination of pending) {
          if (destination.status === 'published' || destination.status === 'failed') continue;
          if (destination.platform === 'creddy_website' || destination.format === 'article') {
            // Website articles use the separate human-approved export boundary.
            // Blotato must never receive an article destination.
            manifest.skippedCount += 1;
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
          if (bank.approvalMode === 'auto_urgent') {
            await assertAutoUrgentAuthorizationCurrent(root, bank, now);
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
          await writeJsonAtomic(path, bank);
        }
        await writeJsonAtomic(path, bank);
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
