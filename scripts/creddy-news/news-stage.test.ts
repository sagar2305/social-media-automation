import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { calculateEditorialPriorityScore, calculateViralPotentialScore } from '../creddy/analysis-stage.js';
import { newsHeadlineWithoutPublisherSuffix, prepareAppNews, newsSourceKey, runAppNewsStage } from './news-stage.js';
import { CREDDY_PIPELINE_VERSION, type AnalysisDecisionRecord, type CanonicalNewsRecord } from '../creddy/pipeline-types.js';
import { initializeCreddyDataRoot, safeDataPath, writeJsonAtomic } from '../creddy/pipeline-store.js';
import { NewsService } from '../../shared/creddy-news/creddy-news-service.js';
import { authorizeNewsSlack, handleNewsSlack, newsMessage, newsSlackAcknowledgement, notifyNews, notifyWithheldNewsDigest, type NewsSlackPayload } from '../../shared/creddy-news/creddy-news-slack.js';
import { publicHttps, validateNewsPatch, type NewsItem } from '../../shared/creddy-news/creddy-news-types.js';

function fixtures() {
  const now = Date.now();
  const article: CanonicalNewsRecord = { version: CREDDY_PIPELINE_VERSION, id: 'raw-test', runId: 'test', sourceId: 'the-points-guy',
    sourceName: 'The Points Guy', sourceTier: 'B', factualUse: 'discovery_and_confirmation',
    originalUrl: 'https://thepointsguy.com/news/card-benefit', canonicalUrl: 'https://thepointsguy.com/news/card-benefit',
    title: 'Verified test card benefit', markdown: 'Test evidence', cleanedMarkdown: 'Test evidence', contentHash: 'a'.repeat(64),
    titleFingerprint: 'test-card', fetchedAt: new Date(now).toISOString(), publishedAt: new Date(now - 1000).toISOString(),
    providerMetadata: {}, qualification: { qualifies: true, matchedKeywords: ['card'] }, canonicalId: 'canonical-test',
    evidenceRecordIds: ['raw-test'], deduplicatedAt: new Date(now).toISOString() };
  const decision: AnalysisDecisionRecord = { version: CREDDY_PIPELINE_VERSION, id: 'analysis-test', canonicalId: article.canonicalId,
    analyzedAt: article.fetchedAt, market: 'US', headline: 'A verified test card benefit for members',
    summary: 'Eligible members can use this test card benefit after checking its terms. Verify account eligibility and the current offer details before taking action.',
    eventType: 'card_offer', topic: 'cards', affectedPrograms: ['Test Card'], requiredAction: null, expiry: null,
    claims: [{ field: 'eligibility', value: 'Eligible members', sourceRecordIds: ['raw-test'], confidence: 90 }],
    productFitScore: 90, popularityScore: 80, importanceScore: 80, confidenceScore: 90,
    importanceReasons: ['Useful'], confidenceReasons: ['Verified'], materialConflict: false,
    conflictChangesMessage: false, verificationExhausted: false, route: 'auto_process', rejectionReasons: [],
    evidenceRecordIds: ['raw-test'], rubricVersion: 'creddy-ranking-v3', viralPotential: { score: 80,
      hookStrength: 80, audienceBreadth: 80, financialMagnitude: 80, novelty: 80, urgency: 80, practicalUtility: 80,
      visualPotential: 80, discussionPotential: 80, emotionalAspiration: 80, shareSavePotential: 80, reasons: ['Useful'] },
    channelScores: { instagramTikTok: 80, blogSeo: 80, newsletter: 80, evergreen: 80 }, freshnessScore: 90,
    editorialDisposition: 'produce', verificationState: 'ready', verificationRequirements: [], hookType: 'program_change',
    hookRationale: 'A useful change', portfolioCategory: 'card_offer' };
  decision.viralPotential!.score = calculateViralPotentialScore(decision.viralPotential!);
  decision.editorialPriorityScore = calculateEditorialPriorityScore(decision);
  return { article, decision, now };
}
function item(): NewsItem {
  const { article, decision, now } = fixtures();
  return { id: 'news-test', source_key: article.canonicalUrl, ...prepareAppNews(decision, article, [article], now),
    status: 'published', validation_error: null, revision: 1, manually_edited: false, created_at: article.fetchedAt,
    updated_at: article.fetchedAt, slack_channel: null, slack_ts: null, slack_revision: 0, slack_error: null };
}
const env = { CREDDY_NEWS_ENABLED: 'true', CREDDY_NEWS_SLACK_CHANNEL_ID: 'CNEWS',
  CREDDY_NEWS_SLACK_TEAM_ID: 'TTEST', CREDDY_NEWS_SLACK_EDITOR_IDS: 'UEDITOR', SLACK_SIGNING_SECRET: 'test-only-signature-secret' };
function payload(): NewsSlackPayload {
  const message = newsMessage(item(), 'CNEWS', env);
  const blocks = message.blocks as Array<{ type: string; elements?: Array<{ action_id: string; value: string }> }>;
  const action = blocks.find(block => block.type === 'actions')!.elements![0];
  return { team: { id: 'TTEST' }, user: { id: 'UEDITOR' }, channel: { id: 'CNEWS' }, actions: [action] };
}

test('ready evidence becomes short app news, without generating an image', () => {
  const { article, decision, now } = fixtures();
  const prepared = prepareAppNews(decision, article, [article], now);
  assert.equal(prepared.error, null); assert.equal(prepared.content.image_url, null);
  assert.equal(prepared.content.source_url, article.canonicalUrl);
});
test('News removes only an exact trailing publisher suffix because attribution is separate', () => {
  for (const separator of ['-', '–', '—', '|']) {
    assert.equal(
      newsHeadlineWithoutPublisherSuffix(`Frontier makes elite status easier  ${separator}  the points guy`, 'The Points Guy'),
      'Frontier makes elite status easier',
    );
  }
  assert.equal(
    newsHeadlineWithoutPublisherSuffix('Miles+More changes award pricing - Miles+More (Blog)', 'Miles+More (Blog)'),
    'Miles+More changes award pricing',
  );
  assert.equal(
    newsHeadlineWithoutPublisherSuffix('What The Points Guy report means for Frontier members', 'The Points Guy'),
    'What The Points Guy report means for Frontier members',
  );
  assert.equal(
    newsHeadlineWithoutPublisherSuffix('Frontier makes elite status easier', 'The Points Guy'),
    'Frontier makes elite status easier',
  );
});
test('community-only, absent, old and incomplete evidence never publishes', () => {
  const { article, decision, now } = fixtures();
  assert.match(prepareAppNews(decision, article, [], now).error!, /evidence/);
  assert.match(prepareAppNews(decision, article, [{ ...article, sourceId: 'reddit-churning', canonicalUrl: 'https://reddit.com/r/churning/test', factualUse: 'signal_only' }], now).error!, /configured specialist/);
  assert.equal(prepareAppNews(decision, { ...article, publishedAt: '2020-01-01' }, [article], now).error, null);
  assert.match(prepareAppNews(decision, article, [article], now, undefined, '2020-01-01').error!, /72-hour window/);
  assert.match(prepareAppNews({ ...decision, summary: 'x'.repeat(481) }, article, [article], now).error!, /480/);
  assert.match(prepareAppNews({ ...decision, expiry: '2020-01-01' }, article, [article], now).error!, /expired/);
});
test('scraped image permission claims are ignored; explicit registry permissions can attach an image', () => {
  const { article, decision, now } = fixtures();
  const approved = { url: 'https://example.com/licensed.jpg', rights: 'licensed' as const, attribution: 'Test photo license' };
  article.providerMetadata.creddyNewsImage = approved;
  assert.equal(prepareAppNews(decision, article, [article], now).content.image_url, null);
  assert.equal(prepareAppNews(decision, article, [article], now, approved).content.image_url, approved.url);
});
test('source normalization removes only tracking and fragment, not article query identity', () => {
  assert.equal(newsSourceKey('https://example.com/story/?utm_source=x&id=2#hi'), 'https://example.com/story?id=2');
  assert.notEqual(newsSourceKey('https://example.com/story?id=2'), newsSourceKey('https://example.com/story?id=3'));
});
test('source dates remain provenance while News freshness truthfully uses first seen', () => {
  const { article, decision, now } = fixtures();
  article.providerMetadata['article:published_time'] = article.publishedAt;
  article.publishedAt = undefined;
  const metadata = prepareAppNews(decision, article, [article], now);
  assert.equal(metadata.error, null);
  assert.equal(metadata.provenance.dateBasis, 'first_seen');
  assert.equal(metadata.provenance.sourcePublishedAt, new Date(article.providerMetadata['article:published_time'] as string).toISOString());
  delete article.providerMetadata['article:published_time'];
  article.providerMetadata['article:modified_time'] = new Date(now).toISOString();
  const fallback = prepareAppNews(decision, article, [article], now, undefined, article.fetchedAt);
  assert.equal(fallback.error, null);
  assert.equal(fallback.provenance.dateBasis, 'first_seen');
  assert.equal(fallback.content.published_at, Date.parse(article.fetchedAt));
});
test('trusted batched News does not require routine official verification while conflicts still block', () => {
  const { article, decision, now } = fixtures();
  const attributed = { ...decision, analysisBatchId: 'batch-new', route: 'reverify' as const,
    verificationState: 'official_source_needed' as const, verificationRequirements: ['Routine issuer confirmation'] };
  assert.equal(prepareAppNews(attributed, article, [article], now).error, null);
  const conflicting = { ...decision, verificationGate:{official:{status:'conflicting'}} } as unknown as AnalysisDecisionRecord;
  assert.match(prepareAppNews(conflicting, article, [article], now).error!, /conflict/);
});
test('unknown search publishers and exceptional one-source claims remain withheld', () => {
  const { article, decision, now } = fixtures();
  const unknown = { ...article, sourceId: 'topic-search:card-offer', sourceName: 'Unknown Publisher',
    canonicalUrl: 'https://unknown.example/news/card-benefit', originalUrl: 'https://unknown.example/news/card-benefit' };
  assert.match(prepareAppNews(decision, unknown, [unknown], now).error!, /configured specialist/);
  const exceptional = { ...decision, route: 'reverify' as const, verificationState: 'independent_confirmation_needed' as const,
    verificationRequirements: ['Independent confirmation'] };
  assert.match(prepareAppNews(exceptional, article, [article], now).error!, /two trusted specialist/);
});
test('a configured source id cannot confer trust on an unrelated host', () => {
  const { article, decision, now } = fixtures();
  const spoofed = { ...article, sourceId: 'the-points-guy', sourceName: 'The Points Guy',
    canonicalUrl: 'https://unknown.example/news/card-benefit', originalUrl: 'https://unknown.example/news/card-benefit' };
  assert.match(prepareAppNews(decision, spoofed, [spoofed], now).error!, /configured specialist/);
});
test('trusted-source confidence floor admits legacy source-capped rankings but not weak claims', () => {
  const { article, decision, now } = fixtures();
  const accepted: AnalysisDecisionRecord = { ...decision, confidenceScore: 60, route: 'reverify',
    verificationState: 'official_source_needed', verificationRequirements: ['Routine issuer confirmation'],
    claims: decision.claims.map((claim) => ({ ...claim, confidence: 60 })) };
  accepted.editorialPriorityScore = calculateEditorialPriorityScore(accepted);
  assert.equal(prepareAppNews(accepted, article, [article], now).error, null);
  const weak: AnalysisDecisionRecord = { ...accepted, confidenceScore: 59,
    claims: accepted.claims.map((claim) => ({ ...claim, confidence: 59 })) };
  weak.editorialPriorityScore = calculateEditorialPriorityScore(weak);
  assert.match(prepareAppNews(weak, article, [article], now).error!, /does not qualify|evidence/);
});
test('news text and URLs are bounded and safe', () => {
  assert.throws(() => validateNewsPatch({ headline: 'short', summary: 'x'.repeat(100), category: 'Credit cards' }));
  for (const url of ['javascript:alert(1)', 'https://127.0.0.1/a', 'https://user:pass@example.com/a', 'http://example.com/a']) assert.equal(publicHttps(url), false);
  assert.equal(publicHttps('https://example.com/article'), true);
});
test('Slack actions require signed identity, workspace, channel and editor authorization', () => {
  assert.equal(authorizeNewsSlack(payload(), env).id, 'news-test');
  assert.throws(() => authorizeNewsSlack({ ...payload(), user: { id: 'UOTHER' } }, env));
  assert.throws(() => authorizeNewsSlack({ ...payload(), team: { id: 'TOTHER' } }, env));
  assert.throws(() => authorizeNewsSlack({ ...payload(), channel: { id: 'COTHER' } }, env));
  const changed = payload(); changed.actions![0].value += 'tamper';
  assert.throws(() => authorizeNewsSlack(changed, env));
});
test('Slack modal validates before acknowledging and preserves signed revision', () => {
  const p = payload();
  p.view = { callback_id: 'creddy_news_save', private_metadata: p.actions![0].value,
    state: { values: { headline: { value: { value: item().content.headline } }, summary: { value: { value: item().content.summary } },
      category: { value: { selected_option: { value: 'Credit cards' } } } } } };
  assert.equal(newsSlackAcknowledgement(p, env).response_action, 'update');
  p.view.state!.values!.summary.value.value = 'Too short';
  assert.throws(() => newsSlackAcknowledgement(p, env), /summary/);
});
test('deleted notices have no edit/publish action and social actions are absent', () => {
  const message = JSON.stringify(newsMessage({ ...item(), status: 'deleted' }, 'CNEWS', env));
  assert.doesNotMatch(message, /creddy_content_approve|creddy_website_|creddy_news_edit|creddy_news_delete/);
});
test('published notifications work without granting Slack editing permissions', async () => {
  const readOnlyEnv = { ...env, CREDDY_NEWS_SLACK_EDITOR_IDS: '', SLACK_SIGNING_SECRET: '' };
  const message = newsMessage(item(), 'CNEWS', readOnlyEnv);
  assert.match(JSON.stringify(message), /Published in app/);
  assert.doesNotMatch(JSON.stringify(message), /creddy_news_edit|creddy_news_delete/);
  assert.throws(() => authorizeNewsSlack(payload(), readOnlyEnv), /not an authorized/);
  let sent = false;
  const service = { claimNotification: async () => item(), notificationResult: async () => {} } as unknown as NewsService;
  await notifyNews(service, 'news-test', readOnlyEnv, async (_method, body) => {
    assert.doesNotMatch(JSON.stringify(body), /creddy_news_edit|creddy_news_delete/);
    sent = true; return { ts: '1.2' };
  });
  assert.equal(sent, true);
});
test('notification failures are durable, existing receipts update instead of reposting', async () => {
  const current = item(); current.slack_ts = '1.2'; current.slack_channel = 'CNEWS';
  const outcomes: unknown[] = [];
  const service = { claimNotification: async () => current, notificationResult: async (_: NewsItem, result: unknown) => { outcomes.push(result); } } as unknown as NewsService;
  await notifyNews(service, current.id, env, async method => { assert.equal(method, 'chat.update'); return { ts: '1.2' }; });
  assert.equal((outcomes[0] as { ts: string }).ts, '1.2');
  await assert.rejects(notifyNews(service, current.id, env, async () => { throw new Error('Test delivery failure'); }));
  assert.equal((outcomes[1] as { error: string }).error, 'Test delivery failure');
});
test('withheld News uses one bounded idempotent hourly digest', async () => {
  const calls: Array<Record<string, unknown>> = [];
  const result = await notifyWithheldNewsDigest(
    Array.from({ length: 7 }, (_, index) => ({ headline: `Candidate ${index}`, reason: 'Official verification is incomplete.' })),
    '2026-09-01T12',
    'http://127.0.0.1:3000',
    env,
    async (method, body) => { assert.equal(method, 'chat.postMessage'); calls.push(body); return { ts: '2.3' }; },
  );
  assert.equal(result.ts, '2.3');
  assert.equal(calls.length, 1);
  assert.match(JSON.stringify(calls[0]), /2 additional withheld candidate/);
  assert.match(JSON.stringify(calls[0]), /client_msg_id/);
});
test('disabled cycle performs no work', async () => {
  assert.equal((await runAppNewsStage('/not/a/data/root', { env: {} })).disabled, true);
});
test('standalone news branch consumes its own evidence root and records a report', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-news-stage-'));
  await initializeCreddyDataRoot(root);
  const { article, decision } = fixtures();
  await writeJsonAtomic(safeDataPath(root, '03-canonical-news', 'approved', 'test.json'), article);
  await writeJsonAtomic(safeDataPath(root, '01-raw', 'test.json'), article);
  await writeJsonAtomic(safeDataPath(root, '04-analysis-queue', 'completed', 'test.json'), decision);
  let ingested = 0;
  const service = { ingest: async (input: { error: string | null }) => { assert.equal(input.error, null); ingested++; return item(); } } as unknown as NewsService;
  const skipped = await runAppNewsStage(root, { env, service, notify: async () => {}, canonicalIds: ['not-selected'] });
  assert.equal(skipped.published, 0); assert.equal(ingested, 0);
  const result = await runAppNewsStage(root, { env, service, notify: async () => {} });
  assert.equal(ingested, 1); assert.equal(result.published, 1); assert.deepEqual(result.failures, []);
});
test('server errors never reveal upstream bodies or credentials', async () => {
  const service = new NewsService('https://example.com', 'test-key', async () => new Response('private upstream payload', { status: 500 }));
  await assert.rejects(service.get('test'), error => error instanceof Error && !error.message.includes('private upstream payload') && !error.message.includes('test-key'));
});

test('Slack edit opens promptly and loads the latest revision into the form', async () => {
  const current = { ...item(), revision: 4 };
  const calls: string[] = [];
  const service = { get: async () => { calls.push('get'); return current; } } as unknown as NewsService;
  await handleNewsSlack({ ...payload(), trigger_id: 'test-trigger' }, env, service, async (method, body) => {
    calls.push(method);
    if (method === 'views.open') return { view: { id: 'test-view' } };
    const view = body.view as NonNullable<NewsSlackPayload['view']>;
    assert.equal(view.callback_id, 'creddy_news_save');
    assert.equal(authorizeNewsSlack({ ...payload(), view }, env).revision, 4);
    return {};
  });
  assert.deepEqual(calls, ['views.open', 'get', 'views.update']);
});

test('Slack save writes once and updates the existing published notification', async () => {
  const current = item(); current.slack_ts = '1.2'; current.slack_channel = 'CNEWS';
  const p = payload();
  p.view = { id: 'test-view', callback_id: 'creddy_news_save', private_metadata: p.actions![0].value,
    state: { values: { headline: { value: { value: current.content.headline } },
      summary: { value: { value: current.content.summary } }, category: { value: { selected_option: { value: 'Credit cards' } } } } } };
  p.actions = undefined;
  let writes = 0;
  const service = {
    manage: async (id: string, revision: number, action: string, patch: unknown, actor: string) => {
      assert.equal(id, current.id); assert.equal(revision, 1); assert.equal(action, 'edit');
      assert.equal(actor, 'slack:UEDITOR'); assert.ok(patch); writes++; current.revision++;
    },
    claimNotification: async () => current, notificationResult: async () => {},
  } as unknown as NewsService;
  const calls: string[] = [];
  await handleNewsSlack(p, env, service, async (method, body) => {
    calls.push(method);
    if (method === 'chat.update') { assert.equal(body.ts, '1.2'); assert.match(JSON.stringify(body), /Revision 2/); return { ts:'1.2' }; }
    assert.match(JSON.stringify(body), /Saved to app News/); return {};
  });
  assert.equal(writes, 1); assert.deepEqual(calls, ['chat.update', 'views.update']);
});

test('Slack deletion tombstones the item and removes controls from its notification', async () => {
  const current = item(); current.slack_ts = '1.2'; current.slack_channel = 'CNEWS';
  const p = payload(); p.actions![0].action_id = 'creddy_news_delete';
  const service = {
    manage: async (_id: string, revision: number, action: string, patch: unknown) => {
      assert.equal(revision, 1); assert.equal(action, 'delete'); assert.equal(patch, null);
      current.status = 'deleted'; current.revision++;
    }, claimNotification: async () => current, notificationResult: async () => {},
  } as unknown as NewsService;
  await handleNewsSlack(p, env, service, async (method, body) => {
    assert.equal(method, 'chat.update'); assert.match(JSON.stringify(body), /Deleted from app/);
    assert.doesNotMatch(JSON.stringify(body), /creddy_news_edit|creddy_news_delete/); return { ts: '1.2' };
  });
});

test('stale Slack actions report failure without a false success notification', async () => {
  const p = payload(); p.actions![0].action_id = 'creddy_news_delete';
  const service = { manage: async () => { throw new Error('News changed. Reload and try again.'); } } as unknown as NewsService;
  await handleNewsSlack(p, env, service, async (method, body) => {
    assert.equal(method, 'chat.postEphemeral'); assert.equal(body.user, 'UEDITOR');
    assert.match(String(body.text), /News changed/); return {};
  });
});
