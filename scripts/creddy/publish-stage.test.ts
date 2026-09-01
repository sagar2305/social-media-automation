import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type {
  BlotatoApi,
  BlotatoPostStatus,
  BlotatoScheduleInput,
  BlotatoScheduleResult,
} from './blotato-client.js';
import {
  initializeCreddyDataRoot,
  pathExists,
  safeDataPath,
  writeJsonAtomic,
} from './pipeline-store.js';
import {
  CREDDY_PIPELINE_VERSION,
  type ContentBankRecord,
  type ContentPackageRecord,
} from './pipeline-types.js';
import { runPublishStage } from './publish-stage.js';

class FakeBlotato implements BlotatoApi {
  readonly scheduled: BlotatoScheduleInput[] = [];
  published = false;

  async scheduleVideo(input: BlotatoScheduleInput): Promise<BlotatoScheduleResult> {
    this.scheduled.push(input);
    return { submissionId: `submission-${this.scheduled.length}`, mediaUrl: 'https://media.example/video' };
  }

  async getPostStatus(submissionId: string): Promise<BlotatoPostStatus> {
    return this.published
      ? { status: 'published', url: `https://social.example/${submissionId}` }
      : { status: 'scheduled' };
  }
}

test('publishing submits only approved due destinations and reconciles idempotently', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-publish-'));
  await initializeCreddyDataRoot(root);
  const textVideo = join(root, 'text.mp4');
  const voiceVideo = join(root, 'voice.mp4');
  await writeFile(textVideo, 'video');
  await writeFile(voiceVideo, 'video');
  const content: ContentPackageRecord = {
    version: CREDDY_PIPELINE_VERSION,
    id: 'content-publish',
    analysisId: 'analysis-publish',
    canonicalId: 'canonical-publish',
    createdAt: '2026-08-19T12:00:00Z',
    audience: 'US users',
    slot: 'act_now',
    hook: 'Bonus alert',
    scriptLines: ['Bonus alert.', 'Check the terms.'],
    caption: 'Check the latest terms.',
    platformCaptions: {
      instagram: 'Instagram-specific terms.',
      tiktok: 'TikTok-specific terms.',
    },
    hashtags: ['points'],
    cta: { label: 'Open Creddy', deepLink: 'creddy://home' },
    imagePrompts: [],
    brief: 'Brief',
    sourceUrls: ['https://example.com'],
    factualClaims: [],
  };
  const bank: ContentBankRecord = {
    version: CREDDY_PIPELINE_VERSION,
    id: content.id,
    contentPackageId: content.id,
    createdAt: '2026-08-19T12:10:00Z',
    status: 'scheduled',
    textMusicVideoPath: textVideo,
    narratedVideoPath: voiceVideo,
    revision: 1,
    approvedBy: 'boss@example.com',
    approvedAt: '2026-08-19T12:20:00Z',
    destinations: [
      {
        format: 'text_music',
        platform: 'instagram',
        account: 'creddy-news',
        scheduledFor: '2026-08-19T13:10:00Z',
        status: 'pending',
      },
      {
        format: 'narrated',
        platform: 'tiktok',
        account: 'creddy-voice',
        scheduledFor: '2026-08-19T13:10:00Z',
        status: 'pending',
      },
    ],
  };
  await writeJsonAtomic(safeDataPath(root, '06-content-packages', `${content.id}.json`), content);
  await writeJsonAtomic(safeDataPath(root, '11-scheduled', `${bank.id}.json`), bank);

  const client = new FakeBlotato();
  await runPublishStage(root, client, new Date('2026-08-19T13:00:00Z'), 15);
  assert.equal(client.scheduled.length, 2);
  assert.match(client.scheduled[0].caption, /^Instagram-specific terms\./);
  assert.match(client.scheduled[1].caption, /^TikTok-specific terms\./);
  await runPublishStage(root, client, new Date('2026-08-19T13:01:00Z'), 15);
  assert.equal(client.scheduled.length, 2);

  client.published = true;
  const reconciled = await runPublishStage(root, client, new Date('2026-08-19T13:11:00Z'), 15);
  assert.equal(reconciled.outputCount, 2);
  assert.equal(
    await pathExists(safeDataPath(root, '12-published', `${bank.id}.json`)),
    true,
  );
});

test('Agent 8 refuses scheduled records without explicit human approval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-publish-unapproved-'));
  await initializeCreddyDataRoot(root);
  const content: ContentPackageRecord = {
    version: CREDDY_PIPELINE_VERSION,
    id: 'content-unapproved',
    analysisId: 'analysis-unapproved',
    canonicalId: 'canonical-unapproved',
    createdAt: '2026-08-19T12:00:00Z',
    audience: 'US users',
    slot: 'act_now',
    hook: 'Unapproved post',
    scriptLines: ['Do not publish.'],
    caption: 'Do not publish.',
    hashtags: [],
    cta: { label: 'Open Creddy', deepLink: 'creddy://home' },
    imagePrompts: [],
    brief: 'Brief',
    sourceUrls: ['https://example.com'],
    factualClaims: [],
  };
  const bank: ContentBankRecord = {
    version: CREDDY_PIPELINE_VERSION,
    id: content.id,
    contentPackageId: content.id,
    createdAt: '2026-08-19T12:10:00Z',
    status: 'scheduled',
    revision: 1,
    destinations: [{
      format: 'text_music',
      platform: 'instagram',
      account: 'creddy-news',
      scheduledFor: '2026-08-19T13:10:00Z',
      status: 'pending',
    }],
  };
  await writeJsonAtomic(safeDataPath(root, '06-content-packages', `${content.id}.json`), content);
  await writeJsonAtomic(safeDataPath(root, '11-scheduled', `${bank.id}.json`), bank);

  const client = new FakeBlotato();
  const manifest = await runPublishStage(root, client, new Date('2026-08-19T13:00:00Z'), 15);
  assert.equal(client.scheduled.length, 0);
  assert.equal(manifest.failedCount, 1);
  assert.match(manifest.errors[0], /missing a valid approval/);
});

test('Agent 8 independently refuses unresolved social verification even on an approved scheduled record', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-publish-verification-'));
  await initializeCreddyDataRoot(root);
  const content: ContentPackageRecord = {
    version: CREDDY_PIPELINE_VERSION, id: 'content-verification', analysisId: 'analysis-verification',
    canonicalId: 'canonical-verification', createdAt: '2026-08-31T12:00:00Z', audience: 'US users',
    slot: 'act_now', hook: 'Verification pending', scriptLines: ['Review this first.'], caption: 'Review this first.',
    hashtags: [], cta: { label: 'Open Creddy', deepLink: 'creddy://home' }, imagePrompts: [], brief: 'Brief',
    sourceUrls: ['https://example.com'], factualClaims: [],
  };
  const bank: ContentBankRecord = {
    version: CREDDY_PIPELINE_VERSION, id: content.id, contentPackageId: content.id,
    createdAt: '2026-08-31T12:10:00Z', status: 'scheduled', revision: 1,
    approvedBy: 'editor@example.com', approvedAt: '2026-08-31T12:20:00Z',
    verificationGate: {
      portfolioRank: 1, selectedAt: '2026-08-31T12:00:00Z', socialStatus: 'manual_confirmation_required',
      official: {
        version: 1, id: 'official-verification-analysis-verification', decisionId: 'analysis-verification',
        canonicalId: 'canonical-verification', checkedAt: '2026-08-31T12:05:00Z', status: 'unavailable',
        attemptedUrls: ['https://exampleairline.com/terms'], evidence: [], claimOutcomes: [],
        remainingRequirements: ['Confirm facts manually.'], failureReasons: ['Official page unavailable.'],
      },
    },
    destinations: [{ format: 'text_music', platform: 'instagram', account: 'creddy-news', scheduledFor: '2026-08-31T13:10:00Z', status: 'pending' }],
  };
  await writeJsonAtomic(safeDataPath(root, '06-content-packages', `${content.id}.json`), content);
  await writeJsonAtomic(safeDataPath(root, '11-scheduled', `${bank.id}.json`), bank);
  const client = new FakeBlotato();
  const manifest = await runPublishStage(root, client, new Date('2026-08-31T13:00:00Z'), 15);
  assert.equal(client.scheduled.length, 0);
  assert.equal(manifest.failedCount, 1);
  assert.match(manifest.errors[0], /Facts verified and approve/);
});
