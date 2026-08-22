import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { acceptContentPackage, acceptContentRevision } from './content-stage.js';
import {
  initializeCreddyDataRoot,
  listJsonFiles,
  readJson,
  safeDataPath,
  writeJsonAtomic,
} from './pipeline-store.js';
import {
  CREDDY_PIPELINE_VERSION,
  type AnalysisDecisionRecord,
  type ContentPackageRecord,
  type ContentBankRecord,
} from './pipeline-types.js';
import type {
  SubmitVideoFactoryJob,
  VideoFactoryApi,
  VideoFactoryRemoteJob,
} from './video-factory-client.js';
import { approveContentBankItem, buildCreddyVideoScript, runContentBankHandoff, runVideoStage } from './video-stage.js';

class FakeVideoFactory implements VideoFactoryApi {
  readonly jobs: VideoFactoryRemoteJob[] = [];

  constructor(private readonly output: string) {}

  async getCapabilities() {
    return {
      version: 'v11.0',
      capabilities: { audio_modes: ['narrated', 'text_music'], external_id: true },
    };
  }

  async submitJob(job: SubmitVideoFactoryJob): Promise<VideoFactoryRemoteJob> {
    const existing = this.jobs.find((candidate) => candidate.external_id === job.external_id);
    if (existing) return existing;
    const created = {
      id: `remote-${this.jobs.length + 1}`,
      external_id: job.external_id,
      status: 'done',
      output: this.output,
    };
    this.jobs.push(created);
    return created;
  }

  async listJobs(): Promise<VideoFactoryRemoteJob[]> {
    return this.jobs;
  }
}

test('Video Factory payload uses the exact Creddy scene syntax and pose assets', () => {
  const content = {
    scriptLines: ['HOOK :: Save *20%* :: check the terms :: old-icon'],
    characterExpressions: ['excited'],
  } as ContentPackageRecord;
  assert.deepEqual(buildCreddyVideoScript(content), [
    'brand: creddy',
    'accent: #D4AF5F',
    'HOOK :: Save *20%* :: check the terms :: starstruck',
  ]);
});

function opportunity(): AnalysisDecisionRecord {
  return {
    version: CREDDY_PIPELINE_VERSION,
    id: 'analysis-video',
    canonicalId: 'canonical-video',
    analyzedAt: '2026-08-19T12:00:00.000Z',
    market: 'US',
    headline: 'Transfer bonus',
    summary: 'A verified bonus.',
    eventType: 'transfer_bonus',
    topic: 'points',
    affectedPrograms: ['Example'],
    requiredAction: 'Review terms.',
    expiry: null,
    claims: [{ field: 'bonus', value: 20, sourceRecordIds: ['raw-1'], confidence: 90 }],
    productFitScore: 90,
    popularityScore: 75,
    importanceScore: 80,
    confidenceScore: 90,
    importanceReasons: ['Actionable'],
    confidenceReasons: ['Verified'],
    materialConflict: false,
    conflictChangesMessage: false,
    verificationExhausted: true,
    route: 'auto_process',
    rejectionReasons: [],
    evidenceRecordIds: ['raw-1'],
  };
}

test('two Video Factory formats become one pending Content Bank item', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-video-'));
  await initializeCreddyDataRoot(root);
  const remoteOutput = join(root, 'factory-output.mp4');
  await writeFile(remoteOutput, 'test-video');
  await writeFile(join(root, 'music.mp3'), 'test-music');
  await writeJsonAtomic(
    safeDataPath(root, '05-content-opportunities', 'analysis-video.json'),
    opportunity(),
  );
  const content: ContentPackageRecord = {
    version: CREDDY_PIPELINE_VERSION,
    id: 'content-video',
    analysisId: 'analysis-video',
    canonicalId: 'canonical-video',
    createdAt: '2026-08-19T12:30:00.000Z',
    audience: 'US rewards users',
    slot: 'act_now',
    hook: 'Transfer bonus alert',
    scriptLines: ['Transfer bonus alert.', 'Check the terms before moving points.'],
    caption: 'Check the terms.',
    hashtags: ['points'],
    cta: { label: 'Open Creddy', deepLink: 'creddy://home' },
    imagePrompts: ['airline points'],
    brief: 'Verified short-form update.',
    sourceUrls: ['https://example.com/news'],
    factualClaims: opportunity().claims,
  };
  await acceptContentPackage(root, content);

  const client = new FakeVideoFactory(remoteOutput);
  const result = await runVideoStage({
    root,
    client,
    musicPath: join(root, 'music.mp3'),
    now: new Date('2026-08-19T13:00:00Z'),
  });
  assert.equal(result.outputCount, 2);
  assert.equal(await runContentBankHandoff(root), 1);
  assert.equal((await listJsonFiles(safeDataPath(root, '09-pending-approval'))).length, 1);

  const approved = await approveContentBankItem(
    root,
    {
      id: 'content-video',
      approvedBy: 'boss@example.com',
      destinations: [
        {
          format: 'text_music',
          platform: 'instagram',
          account: 'creddy-news',
          scheduledFor: '2026-08-21T14:00:00Z',
        },
        {
          format: 'narrated',
          platform: 'instagram',
          account: 'creddy-voice',
          scheduledFor: '2026-08-21T16:00:00Z',
        },
      ],
    },
    new Date('2026-08-19T14:00:00Z'),
  );
  assert.equal(approved.status, 'approved');
  assert.equal((await listJsonFiles(safeDataPath(root, '11-scheduled'))).length, 1);
  assert.equal((await readJson<ContentBankRecord>(safeDataPath(root, '09-pending-approval', 'content-video.json'))).status, 'approved');
  await assert.rejects(
    approveContentBankItem(root, {
      id: 'content-video',
      approvedBy: 'boss@example.com',
      destinations: [{ format: 'text_music', platform: 'instagram', account: 'creddy-news', scheduledFor: '2026-08-22T14:00:00Z' }],
    }, new Date('2026-08-19T14:00:00Z')),
    /cannot be approved/,
  );
});

test('text plus music jobs fail closed when no licensed music path is configured', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-video-'));
  await initializeCreddyDataRoot(root);
  const remoteOutput = join(root, 'factory-output.mp4');
  await writeFile(remoteOutput, 'test-video');
  await writeJsonAtomic(
    safeDataPath(root, '05-content-opportunities', 'analysis-video.json'),
    opportunity(),
  );
  const content: ContentPackageRecord = {
    version: CREDDY_PIPELINE_VERSION,
    id: 'content-video',
    analysisId: 'analysis-video',
    canonicalId: 'canonical-video',
    createdAt: '2026-08-19T12:30:00.000Z',
    audience: 'US rewards users',
    slot: 'act_now',
    hook: 'Transfer bonus alert',
    scriptLines: ['Transfer bonus alert.', 'Check the terms.'],
    caption: 'Check the terms.',
    hashtags: [],
    cta: { label: 'Open Creddy', deepLink: 'creddy://home' },
    imagePrompts: [],
    brief: 'Update.',
    sourceUrls: ['https://example.com/news'],
    factualClaims: opportunity().claims,
  };
  await acceptContentPackage(root, content);
  const result = await runVideoStage({ root, client: new FakeVideoFactory(remoteOutput) });
  assert.equal(result.failedCount, 1);
  assert.match(result.errors.join('\n'), /CREDDY_BACKGROUND_MUSIC_PATH/);
});

test('requested changes create fresh revision render jobs before returning to review', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-revision-'));
  await initializeCreddyDataRoot(root);
  const remoteOutput = join(root, 'factory-output.mp4');
  const music = join(root, 'music.mp3');
  await writeFile(remoteOutput, 'test-video');
  await writeFile(music, 'test-music');
  await writeJsonAtomic(safeDataPath(root, '05-content-opportunities', 'analysis-video.json'), opportunity());
  const content: ContentPackageRecord = {
    version: CREDDY_PIPELINE_VERSION,
    id: 'content-revision',
    analysisId: 'analysis-video',
    canonicalId: 'canonical-video',
    createdAt: '2026-08-19T12:30:00.000Z',
    audience: 'US rewards users',
    slot: 'act_now',
    hook: 'Original hook',
    scriptLines: ['Original first line.', 'Original second line.'],
    caption: 'Original caption.',
    hashtags: ['points'],
    cta: { label: 'Open Creddy', deepLink: 'creddy://home' },
    imagePrompts: ['points'],
    brief: 'Original.',
    sourceUrls: ['https://example.com/news'],
    factualClaims: opportunity().claims,
  };
  await acceptContentPackage(root, content);
  const client = new FakeVideoFactory(remoteOutput);
  await runVideoStage({ root, client, musicPath: music });
  await runContentBankHandoff(root);
  const pendingPath = safeDataPath(root, '09-pending-approval', `${content.id}.json`);
  const first = await readJson<ContentBankRecord>(pendingPath);
  await writeJsonAtomic(pendingPath, {
    ...first,
    status: 'changes_requested',
    revision: 2,
    changeRequest: { requestedBy: 'editor', requestedAt: new Date().toISOString(), notes: 'Correct the hook.' },
  });
  await acceptContentRevision(root, {
    ...content,
    hook: 'Corrected hook',
    scriptLines: ['Corrected first line.', 'Corrected second line.'],
  });
  assert.equal((await readJson<ContentBankRecord>(pendingPath)).status, 'rendering_revision');
  await runVideoStage({ root, client, musicPath: music });
  assert.equal(await runContentBankHandoff(root), 1);
  const revised = await readJson<ContentBankRecord>(pendingPath);
  assert.equal(revised.revision, 2);
  assert.equal(revised.status, 'pending_review');
  assert.equal(revised.changeRequest, undefined);
  assert.match(revised.textMusicVideoPath ?? '', /-r2-/);
  assert.equal(client.jobs.length, 4);
});
