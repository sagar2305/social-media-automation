import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { acceptContentPackage, acceptContentRevision } from './content-stage.js';
import {
  initializeCreddyDataRoot,
  listJsonFiles,
  pathExists,
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
import type { CreddyArticleReadySlackEvent } from './slack-notifications.js';
import { approveContentBankItem, buildCreddyVideoScript, runArticleContentBankHandoff, runContentBankHandoff, runVideoStage } from './video-stage.js';

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

test('article-only packages enter review and can be approved without videos', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-article-bank-'));
  await initializeCreddyDataRoot(root);
  const previewPath = join(root, 'article-preview.html');
  await writeFile(previewPath, '<!doctype html><title>Guide</title>');
  const content: ContentPackageRecord = {
    version: CREDDY_PIPELINE_VERSION, distributionMode: 'article_only', contentDraftId: 'copy-analysis-article',
    id: 'production-analysis-article', analysisId: 'analysis-article', canonicalId: 'canonical-article',
    createdAt: '2026-08-19T12:30:00.000Z', audience: 'US rewards users', slot: 'understand', hook: 'Credit card guide',
    scriptLines: [], caption: '', hashtags: [], cta: { label: 'Open Creddy', deepLink: 'creddy://home' },
    imagePrompts: [], characterExpressions: [], narrationLines: [], visualPlanId: 'visual-copy-analysis-article',
    brief: 'Evergreen guide.', sourceUrls: ['https://example.com/guide'], factualClaims: [],
    article: {
      id: 'article-credit-card-benefit-reset',
      title: 'How Credit Card Benefit Resets Work',
      seoTitle: 'How Credit Card Benefit Resets Work — Creddy',
      seoDescription: 'Learn how credit card benefit resets work, when the value renews, and what to verify before relying on a benefit in your budget.',
      dek: 'A practical benefit reset guide.', excerpt: 'Understand credit card benefit reset timing.',
      category: 'guides', readingMinutes: 5, heroVisualId: 'hero-reset',
      sourceUrls: ['https://example.com/guide'],
      blocks: [
        { id: 'clock-heading', type: 'heading', level: 2, text: 'Understand the benefit reset clock' },
        { id: 'clock-copy', type: 'paragraph', text: 'A credit card benefit reset determines when the next benefit period begins.', claimFields: [] },
        { id: 'decision-heading', type: 'heading', level: 2, text: 'Verify the timing before deciding' },
      ],
    } as ContentPackageRecord['article'],
    articleVisuals: {
      version: 'creddy-article-visuals-v1', designVersion: 'creddy-guides-v1',
      assets: ['hero-reset', 'reset-clock', 'reset-decision'].map((id, index) => ({
        id, usage: index === 0 ? 'hero' as const : 'inline' as const,
        articleBlockId: index === 0 ? 'clock-heading' : 'decision-heading',
        assetType: 'editorial_illustration' as const, aspectRatio: '16:9' as const, generationMode: 'generate' as const,
        altText: `Editorial calendar showing benefit reset step ${index + 1}`,
        caption: `Benefit reset planning detail ${index + 1}.`, claimFields: [], assetPath: join(root, `${id}.png`),
      })),
    },
    articlePreviewPath: previewPath, articleReadiness: 'ready_for_review',
  };
  for (const asset of content.articleVisuals!.assets) await writeFile(asset.assetPath!, 'article-image');
  await writeJsonAtomic(safeDataPath(root, '06-content-packages', `${content.id}.json`), content);
  assert.equal(await runArticleContentBankHandoff(root), 1);
  const bankId = `article-${content.id}`;
  const approved = await approveContentBankItem(root, {
    id: bankId,
    approvedBy: 'editor@example.com',
    destinations: [{
      format: 'article', platform: 'creddy_website', account: 'getcreddy.com',
      scheduledFor: '2026-08-20T15:00:00.000Z',
    }],
  }, new Date('2026-08-19T14:00:00.000Z'));
  assert.equal(approved.mediaType, 'article');
  assert.equal(approved.articleReview?.status, 'approved');
  assert.equal(approved.articleReview?.seoReview?.status, 'pass');
  assert.equal((await listJsonFiles(safeDataPath(root, '07-video-jobs'))).length, 0);
});

test('Agent 7 blocks an SEO failure, sends it for review, and preserves terminal publication state', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-article-seo-block-'));
  await initializeCreddyDataRoot(root);
  const previewPath = join(root, 'article-preview.html');
  await writeFile(previewPath, '<!doctype html><title>Guide</title>');
  const articleVisuals: NonNullable<ContentPackageRecord['articleVisuals']> = {
    version: 'creddy-article-visuals-v1', designVersion: 'creddy-guides-v1',
    assets: ['hero-reset', 'reset-clock', 'reset-decision'].map((id, index) => ({
      id, usage: index === 0 ? 'hero' as const : 'inline' as const,
      articleBlockId: index === 0 ? 'clock-heading' : 'decision-heading',
      assetType: 'editorial_illustration' as const, aspectRatio: '16:9' as const, generationMode: 'generate' as const,
      altText: `Editorial calendar showing benefit reset step ${index + 1}`,
      caption: `Benefit reset planning detail ${index + 1}.`, claimFields: [], assetPath: join(root, `${id}.png`),
    })),
  };
  const content: ContentPackageRecord = {
    version: CREDDY_PIPELINE_VERSION, distributionMode: 'article_only', contentDraftId: 'copy-seo-block',
    id: 'production-seo-block', analysisId: 'analysis-seo-block', canonicalId: 'canonical-seo-block',
    createdAt: '2026-09-01T00:00:00.000Z', audience: 'US rewards users', slot: 'understand', hook: 'Benefit reset guide',
    scriptLines: [], caption: '', hashtags: [], cta: { label: 'Open Creddy', deepLink: 'creddy://home' },
    imagePrompts: [], brief: 'Evergreen guide.', sourceUrls: ['https://example.com/guide'], factualClaims: [],
    article: {
      id: 'article-seo-block', title: 'How Credit Card Benefit Resets Work',
      seoTitle: 'Generic Rewards Guide',
      seoDescription: 'Learn how credit card benefit resets work, when the value renews, and what to verify before relying on a benefit in your budget.',
      dek: 'A practical benefit reset guide.', excerpt: 'Understand credit card benefit reset timing.',
      category: 'guides', readingMinutes: 5, heroVisualId: 'hero-reset', sourceUrls: ['https://example.com/guide'],
      blocks: [
        { id: 'clock-heading', type: 'heading', level: 2, text: 'Understand the benefit reset clock' },
        { id: 'clock-copy', type: 'paragraph', text: 'A credit card benefit reset determines when the next benefit period begins.', claimFields: [] },
        { id: 'decision-heading', type: 'heading', level: 2, text: 'Verify the timing before deciding' },
      ],
    } as ContentPackageRecord['article'],
    articleVisuals, articlePreviewPath: previewPath, articleReadiness: 'ready_for_review',
  };
  await writeJsonAtomic(safeDataPath(root, '06-content-packages', `${content.id}.json`), content);
  let publishCalls = 0;
  let notifierCalls = 0;
  await runArticleContentBankHandoff(root, new Date('2026-09-01T01:00:00.000Z'), {
    autoPublisher: async () => { publishCalls += 1; return true; },
    notifier: async (event) => {
      notifierCalls += 1;
      assert.equal(event.seoReviewStatus, 'needs_changes');
      return { sent: true, channel: 'C123', messageTs: '123.456', fileIds: [] };
    },
  });
  const bank = await readJson<ContentBankRecord>(safeDataPath(root, '09-pending-approval', `article-${content.id}.json`));
  assert.equal(publishCalls, 0);
  assert.equal(notifierCalls, 1);
  assert.equal(bank.articleReview?.status, 'changes_requested');
  assert.equal(bank.articleReview?.seoReview?.status, 'needs_changes');
  assert.ok(bank.articleReview?.blockers?.some((blocker) => /SEO review/.test(blocker)));
  assert.equal(await pathExists(bank.articleReview!.seoReview!.reportPath), true);

  bank.articleReview!.status = 'published';
  bank.articleReview!.publishedUrl = 'https://getcreddy.com/blog/benefit-reset-guide';
  await writeJsonAtomic(safeDataPath(root, '09-pending-approval', `article-${content.id}.json`), bank);
  await runArticleContentBankHandoff(root, new Date('2026-09-01T02:00:00.000Z'));
  const rerun = await readJson<ContentBankRecord>(safeDataPath(root, '09-pending-approval', `article-${content.id}.json`));
  assert.equal(rerun.articleReview?.status, 'published');
  assert.equal(rerun.articleReview?.seoReview?.status, 'needs_changes');
  assert.ok(rerun.articleReview?.blockers?.some((blocker) => /SEO review/.test(blocker)));
});

test('Agent 7 sends a fresh Slack update when same-revision article SEO is corrected and published', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-article-seo-slack-lifecycle-'));
  await initializeCreddyDataRoot(root);
  const previewPath = join(root, 'article-preview.html');
  await writeFile(previewPath, '<!doctype html><title>Guide</title>');
  const articleVisuals: NonNullable<ContentPackageRecord['articleVisuals']> = {
    version: 'creddy-article-visuals-v1', designVersion: 'creddy-guides-v1',
    assets: ['hero-reset', 'reset-clock', 'reset-decision'].map((id, index) => ({
      id, usage: index === 0 ? 'hero' as const : 'inline' as const,
      articleBlockId: index === 0 ? 'clock-heading' : 'decision-heading',
      assetType: 'editorial_illustration' as const, aspectRatio: '16:9' as const, generationMode: 'generate' as const,
      altText: `Editorial calendar showing benefit reset step ${index + 1}`,
      caption: `Benefit reset planning detail ${index + 1}.`, claimFields: [], assetPath: join(root, `${id}.png`),
    })),
  };
  const content: ContentPackageRecord = {
    version: CREDDY_PIPELINE_VERSION, distributionMode: 'article_only', contentDraftId: 'copy-seo-lifecycle',
    id: 'production-seo-lifecycle', analysisId: 'analysis-seo-lifecycle', canonicalId: 'canonical-seo-lifecycle',
    createdAt: '2026-09-01T00:00:00.000Z', audience: 'US rewards users', slot: 'understand', hook: 'Benefit reset guide',
    scriptLines: [], caption: '', hashtags: [], cta: { label: 'Open Creddy', deepLink: 'creddy://home' },
    imagePrompts: [], brief: 'Evergreen guide.', sourceUrls: ['https://example.com/guide'], factualClaims: [],
    article: {
      id: 'article-seo-lifecycle', title: 'How Credit Card Benefit Resets Work', seoTitle: 'Generic Rewards Guide',
      seoDescription: 'Learn how credit card benefit resets work, when the value renews, and what to verify before relying on a benefit in your budget.',
      dek: 'A practical benefit reset guide.', excerpt: 'Understand credit card benefit reset timing.', category: 'guides',
      readingMinutes: 5, heroVisualId: 'hero-reset', sourceUrls: ['https://example.com/guide'],
      blocks: [
        { id: 'clock-heading', type: 'heading', level: 2, text: 'Understand the benefit reset clock' },
        { id: 'clock-copy', type: 'paragraph', text: 'A credit card benefit reset determines when the next benefit period begins.', claimFields: [] },
        { id: 'decision-heading', type: 'heading', level: 2, text: 'Verify the timing before deciding' },
      ],
    } as ContentPackageRecord['article'],
    articleVisuals, articlePreviewPath: previewPath, articleReadiness: 'ready_for_review',
  };
  for (const asset of articleVisuals.assets) await writeFile(asset.assetPath!, 'article-image');
  const packagePath = safeDataPath(root, '06-content-packages', `${content.id}.json`);
  await writeJsonAtomic(packagePath, content);
  const notifications: Array<{ seo?: string; publish?: string }> = [];
  const notifier = async (event: CreddyArticleReadySlackEvent) => {
    notifications.push({ seo: event.seoReviewStatus, publish: event.publishStatus });
    return { sent: true, channel: 'C123', messageTs: String(notifications.length), fileIds: [] };
  };
  await runArticleContentBankHandoff(root, new Date('2026-09-01T01:00:00.000Z'), { notifier });
  assert.deepEqual(notifications, [{ seo: 'needs_changes', publish: undefined }]);

  content.article!.seoTitle = 'How Credit Card Benefit Resets Work — Creddy';
  await writeJsonAtomic(packagePath, content);
  let publishCalls = 0;
  const autoPublisher = async (id: string) => {
    publishCalls += 1;
    const destination = safeDataPath(root, '09-pending-approval', `${id}.json`);
    const bank = await readJson<ContentBankRecord>(destination);
    bank.articleReview!.status = 'published';
    bank.articleReview!.publishedUrl = 'https://getcreddy.com/blog/benefit-reset-guide';
    await writeJsonAtomic(destination, bank);
    return true;
  };
  await runArticleContentBankHandoff(root, new Date('2026-09-01T02:00:00.000Z'), { autoPublisher, notifier });
  assert.equal(publishCalls, 1);
  assert.deepEqual(notifications, [
    { seo: 'needs_changes', publish: undefined },
    { seo: 'pass', publish: 'published' },
  ]);
  await runArticleContentBankHandoff(root, new Date('2026-09-01T03:00:00.000Z'), { notifier });
  assert.equal(notifications.length, 2);
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
  await assert.rejects(() => acceptContentRevision(root, {
    ...content,
    verificationGate: {
      portfolioRank: 1,
      selectedAt: '2026-08-31T10:00:00.000Z',
      socialStatus: 'verified',
      official: {
        version: 1, id: 'tampered-verification', decisionId: content.analysisId,
        canonicalId: content.canonicalId, checkedAt: '2026-08-31T10:01:00.000Z', status: 'verified',
        attemptedUrls: ['https://delta.com/terms'],
        evidence: [{ url: 'https://delta.com/terms', owner: 'Delta Air Lines', sourceType: 'airline' }],
        claimOutcomes: [], remainingRequirements: [], failureReasons: [],
      },
    },
  }), /cannot change or remove the official-verification boundary/);
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
