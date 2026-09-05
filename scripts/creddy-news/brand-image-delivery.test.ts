import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { NewsService } from '../../shared/creddy-news/creddy-news-service.js';
import type { NewsItem } from '../../shared/creddy-news/creddy-news-types.js';
import { calculateEditorialPriorityScore, calculateViralPotentialScore } from '../creddy/analysis-stage.js';
import { initializeCreddyDataRoot, readJson, safeDataPath, writeJsonAtomic } from '../creddy/pipeline-store.js';
import { CREDDY_PIPELINE_VERSION, type AnalysisDecisionRecord, type CanonicalNewsRecord } from '../creddy/pipeline-types.js';
import { runAppNewsStage } from './news-stage.js';

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'news-brand-delivery-'));
  await initializeCreddyDataRoot(root);
  const date = new Date().toISOString();
  const article: CanonicalNewsRecord = {
    version: CREDDY_PIPELINE_VERSION, id: 'raw-brand', runId: 'test', canonicalId: 'canonical-brand',
    sourceId: 'the-points-guy', sourceName: 'The Points Guy', sourceTier: 'B', factualUse: 'discovery_and_confirmation',
    originalUrl: 'https://thepointsguy.com/news/brand-benefit', canonicalUrl: 'https://thepointsguy.com/news/brand-benefit',
    title: 'Verified brand benefit', markdown: 'Test evidence', cleanedMarkdown: 'Test evidence', contentHash: 'a'.repeat(64),
    titleFingerprint: 'brand-benefit', fetchedAt: date, publishedAt: date, providerMetadata: {},
    qualification: { qualifies: true, matchedKeywords: ['card'] }, evidenceRecordIds: ['raw-brand'], deduplicatedAt: date,
  };
  const decision: AnalysisDecisionRecord = {
    version: CREDDY_PIPELINE_VERSION, id: 'analysis-brand', canonicalId: article.canonicalId, analyzedAt: date,
    market: 'US', headline: 'A verified brand benefit for eligible card members',
    summary: 'Eligible members can use this verified test benefit after checking the current terms. Review account eligibility and current offer details before making a decision.',
    eventType: 'card_offer', topic: 'cards', affectedPrograms: ['Test Brand'], requiredAction: null, expiry: null,
    claims: [{ field: 'eligibility', value: 'Eligible members', sourceRecordIds: ['raw-brand'], confidence: 90 }],
    productFitScore: 90, popularityScore: 80, importanceScore: 80, confidenceScore: 90,
    importanceReasons: ['Useful'], confidenceReasons: ['Verified'], materialConflict: false,
    conflictChangesMessage: false, verificationExhausted: false, route: 'auto_process', rejectionReasons: [],
    evidenceRecordIds: ['raw-brand'], rubricVersion: 'creddy-ranking-v3',
    viralPotential: { score: 80, hookStrength: 80, audienceBreadth: 80, financialMagnitude: 80, novelty: 80,
      urgency: 80, practicalUtility: 80, visualPotential: 80, discussionPotential: 80, emotionalAspiration: 80,
      shareSavePotential: 80, reasons: ['Useful'] },
    channelScores: { instagramTikTok: 80, blogSeo: 80, newsletter: 80, evergreen: 80 }, freshnessScore: 90,
    editorialDisposition: 'produce', verificationState: 'ready', verificationRequirements: [], hookType: 'program_change',
    hookRationale: 'A useful change', portfolioCategory: 'card_offer',
  };
  decision.viralPotential!.score = calculateViralPotentialScore(decision.viralPotential!);
  decision.editorialPriorityScore = calculateEditorialPriorityScore(decision);
  await writeJsonAtomic(safeDataPath(root, '03-canonical-news', 'approved', 'brand.json'), article);
  await writeJsonAtomic(safeDataPath(root, '01-raw', 'brand.json'), article);
  await writeJsonAtomic(safeDataPath(root, '04-analysis-queue', 'completed', 'brand.json'), decision);
  let current: NewsItem | undefined;
  let notifications = 0;
  const service = {
    findByIdentity: async () => current,
    get: async () => current!,
    ingest: async (input: Parameters<NewsService['ingest']>[0]) => {
      assert.equal(input.error, null);
      current ??= { id: input.id, source_key: input.sourceKey, content: input.content, provenance: input.provenance,
        status: 'published', validation_error: null, revision: 1, manually_edited: false, created_at: date, updated_at: date,
        slack_channel: null, slack_ts: null, slack_revision: 0, slack_error: null };
      return current;
    },
  } as unknown as NewsService;
  const notify = async () => {
    notifications++;
    current!.slack_channel = 'CNEWS'; current!.slack_ts = '1.2'; current!.slack_revision = current!.revision;
  };
  return { root, service, notify, current: () => current, notifications: () => notifications, canonicalId: article.canonicalId };
}

test('optional image failure does not block eligible News publication or its Slack receipt', async () => {
  const f = await fixture();
  const result = await runAppNewsStage(f.root, { env: { CREDDY_NEWS_ENABLED: 'true' }, service: f.service, notify: f.notify,
    prepareImage: async () => { throw new Error('Image upload unavailable'); } });
  assert.equal(result.publishedNew, 1);
  assert.deepEqual(result.failures, []);
  assert.equal(result.imageWithheld?.length, 1);
  assert.equal(f.current()!.content.image_url, null);
  assert.equal(f.notifications(), 1);
  assert.equal(f.current()!.slack_revision, 1);
  const receipt = await readJson<{ status: string }>(safeDataPath(f.root, 'reports', 'news-delivery', `${f.canonicalId}.json`));
  assert.equal(receipt.status, 'published');
  const report = await readJson<{ imageWithheld: unknown[] }>(safeDataPath(f.root, 'reports', 'latest', 'app-news.json'));
  assert.equal(report.imageWithheld.length, 1);
});

test('no matching reviewed brand asset leaves eligible News publishable', async () => {
  const f = await fixture();
  const result = await runAppNewsStage(f.root, { env: { CREDDY_NEWS_ENABLED: 'true' }, service: f.service, notify: f.notify,
    prepareImage: async () => undefined });
  assert.equal(result.publishedNew, 1);
  assert.equal(result.imageWithheld?.length, 1);
  assert.equal(f.current()!.content.image_url, null);
  assert.equal(f.notifications(), 1);
});

test('reviewed brand image is attributed on publication without regenerating existing News', async () => {
  const f = await fixture();
  const image = { url: 'https://assets.example.com/brand.webp', rights: 'editorial_reference' as const,
    attribution: 'Official brand mark used for editorial identification.' };
  let imagePreparations = 0;
  const options = { env: { CREDDY_NEWS_ENABLED: 'true' }, service: f.service, notify: f.notify,
    prepareImage: async () => { imagePreparations++; return image; } };
  const result = await runAppNewsStage(f.root, options);
  assert.equal(result.publishedNew, 1);
  assert.deepEqual(result.imageWithheld, []);
  assert.equal(f.current()!.content.image_url, image.url);
  assert.deepEqual(f.current()!.provenance.imageRights, image);
  const rerun = await runAppNewsStage(f.root, options);
  assert.equal(rerun.publishedUnchanged, 1);
  assert.equal(imagePreparations, 1);
  assert.equal(f.notifications(), 1);
});
