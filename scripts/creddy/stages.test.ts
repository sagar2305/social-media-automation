import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { resolvedArticleUrl, runCollectionStage, sourceForUrl } from './collection-stage.js';
import { runDedupeStage, titlesDescribeSameStory, verificationForEvidence } from './dedupe-stage.js';
import { articleTextForQualification, dataQualityRejection, runFilterStage } from './filter-stage.js';
import { FirecrawlClient } from './firecrawl-client.js';
import {
  initializeCreddyDataRoot,
  listJsonFiles,
  readJson,
  safeDataPath,
  writeJsonAtomic,
} from './pipeline-store.js';
import { CREDDY_PIPELINE_VERSION, type ContentBankRecord, type ContentPackageRecord, type RawArticleRecord } from './pipeline-types.js';
import { qualifyCreddyText } from './qualification.js';
import { buildContentBankReviewReport, writeObservablePipelineReports } from './report-stage.js';

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('multi-tenant YouTube results are not attributed to Geobreeze by hostname', () => {
  assert.equal(sourceForUrl('https://www.youtube.com/watch?v=another-channel'), null);
});

test('search redirects use the publisher URL reported by the completed scrape', () => {
  assert.equal(
    resolvedArticleUrl('https://google.com/goto?url=opaque', {
      url: 'https://Publisher.Example/story/?utm_source=google#details',
    }),
    'https://publisher.example/story',
  );
});

test('Agent 7 report shows a published article without requiring a video pair', () => {
  const content = {
    id: 'production-ranking-current', distributionMode: 'article_only', hook: 'Current blog story',
    sourceUrls: ['https://example.com/source'], factualClaims: [],
  } as unknown as ContentPackageRecord;
  const articleBank = {
    version: CREDDY_PIPELINE_VERSION, id: `article-${content.id}`, contentPackageId: content.id,
    createdAt: '2026-09-02T12:00:00.000Z', status: 'pending_review', revision: 1,
    mediaType: 'article', articleReview: { status: 'published', blockers: [], publishedUrl: 'https://getcreddy.com/blog/current-story' },
  } as ContentBankRecord;
  const report = buildContentBankReviewReport([content], [], [articleBank]).join('\n');
  assert.match(report, /Article status: published=1/);
  assert.match(report, /Social status: not_applicable=1/);
  assert.doesNotMatch(report, /waiting_for_video_pair/);
});

test('collection stores new content once and respects the recheck window', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-stages-'));
  const progressPhases: string[] = [];
  const client = new FirecrawlClient({
    apiKey: 'test',
    fetchImpl: async (url, init) => {
      const body = JSON.parse(String(init?.body)) as { url?: string; query?: string };
      if (String(url).endsWith('/search')) {
        return jsonResponse({
          success: true,
          data: {
            news: body.query?.includes('"transfer bonus"')
              ? [{
                  title: 'Doctor of Credit transfer bonus',
                  url: 'https://google.com/goto?url=opaque-doctor-of-credit',
                }]
              : body.query?.includes('"welcome bonus"')
                ? [{
                    title: 'Chase welcome offer points update',
                    url: 'https://google.com/goto?url=second-opaque-doctor-of-credit',
                  }]
              : [],
          },
          creditsUsed: 1,
        });
      }
      if (body.url === 'https://awardwallet.com/blog/test-transfer-bonus') {
        return jsonResponse({
          success: true,
          data: {
            markdown: 'A new transfer bonus offers 20% more airline miles.',
            metadata: { title: 'New Transfer Bonus' },
          },
        });
      }
      if (body.url === 'https://google.com/goto?url=opaque-doctor-of-credit'
        || body.url === 'https://google.com/goto?url=second-opaque-doctor-of-credit') {
        return jsonResponse({
          success: true,
          data: {
            markdown: 'Doctor of Credit reports a new airline transfer bonus for loyalty points.',
            metadata: {
              title: 'Doctor of Credit transfer bonus',
              url: 'https://www.doctorofcredit.com/new-transfer-bonus/',
            },
          },
        });
      }
      if (body.url === 'https://doctorofcredit.com/new-transfer-bonus') {
        return jsonResponse({
          success: true,
          data: {
            markdown: 'Doctor of Credit reports a new airline transfer bonus for loyalty points.',
            metadata: {
              title: 'Doctor of Credit transfer bonus',
              url: 'https://www.doctorofcredit.com/new-transfer-bonus/',
            },
          },
        });
      }
      return jsonResponse({
        success: true,
        data: {
          markdown: '# Listing',
          links: body.url === 'https://awardwallet.com/blog/'
            ? ['https://awardwallet.com/blog/test-transfer-bonus']
            : body.url === 'https://www.doctorofcredit.com/'
              ? ['https://doctorofcredit.com/new-transfer-bonus']
              : [],
          ...(body.url === 'https://awardwallet.com/blog/'
            ? { markdown: '[Test transfer bonus](https://awardwallet.com/blog/test-transfer-bonus)' }
            : body.url === 'https://www.doctorofcredit.com/'
              ? { markdown: '[Doctor transfer bonus](https://doctorofcredit.com/new-transfer-bonus)' }
            : {}),
          metadata: { title: 'Listing' },
        },
      });
    },
  });

  const first = await runCollectionStage({
    root,
    client,
    now: new Date('2026-08-21T12:00:00Z'),
    redditFetchImpl: async () => new Response('', { status: 429 }),
    youtubeFetchImpl: async () => new Response('', { status: 429 }),
    onProgress: (event) => progressPhases.push(event.phase),
  });
  assert.equal(first.outputCount, 2);
  assert.equal((await listJsonFiles(safeDataPath(root, '01-raw'))).length, 2);
  const discoveryFiles = await listJsonFiles(safeDataPath(root, '00-discovery'));
  const discovery = await readJson<{
    candidates: Array<{
      url: string;
      sourceId: string;
      disposition: string;
      rawRecordId?: string;
      discoveredTitle?: string;
      publisherKey?: string;
      resolvedPublisherKey?: string;
      eventFingerprint?: string;
      resolvedEventFingerprint?: string;
    }>;
  }>(discoveryFiles[0]);
  assert.equal(discovery.candidates[0].discoveredTitle, 'Test transfer bonus');
  const redirectedDiscovery = discovery.candidates.find((item) => item.url.includes('opaque-doctor-of-credit'));
  const secondRedirectedDiscovery = discovery.candidates.find((item) => item.url.includes('second-opaque-doctor-of-credit'));
  assert.equal(redirectedDiscovery?.sourceId, 'doctor-of-credit');
  assert.equal(redirectedDiscovery?.disposition, 'unchanged');
  assert.equal(redirectedDiscovery?.publisherKey, 'unknown:transfer-bonus');
  assert.equal(secondRedirectedDiscovery?.publisherKey, 'unknown:card-offer');
  assert.equal(redirectedDiscovery?.resolvedPublisherKey, 'doctor-of-credit');
  assert.equal(secondRedirectedDiscovery?.resolvedPublisherKey, 'doctor-of-credit');
  assert.equal(redirectedDiscovery?.resolvedEventFingerprint, secondRedirectedDiscovery?.resolvedEventFingerprint);
  assert.ok(progressPhases.includes('run_started'));
  assert.ok(progressPhases.includes('source_started'));
  assert.ok(progressPhases.includes('search_completed'));
  assert.ok(progressPhases.includes('article_stored'));
  assert.equal(progressPhases.at(-1), 'run_completed');

  await writeObservablePipelineReports(root);
  const immutableReport = await readFile(
    safeDataPath(root, 'reports', 'runs', first.runId, '01-discovery-and-collection.md'),
    'utf8',
  );
  const immutableRawIndex = await readFile(
    safeDataPath(root, 'reports', 'runs', first.runId, '01-raw-article-index.md'),
    'utf8',
  );
  assert.match(immutableReport, /stored: 2/);
  assert.match(immutableReport, /Selection: selected=4 \(core=4, adjacent=0\)/);
  assert.match(immutableReport, /\| unknown:transfer-bonus \| 1 \|/);
  assert.match(immutableReport, /\| unknown:card-offer \| 1 \|/);
  assert.match(immutableRawIndex, /New Transfer Bonus/);

  const rawRecords = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '01-raw'))).map((path) => readJson<RawArticleRecord>(path)),
  );
  const resolvedSearch = rawRecords.find((record) =>
    record.canonicalUrl === 'https://doctorofcredit.com/new-transfer-bonus');
  assert.equal(resolvedSearch?.sourceId, 'doctor-of-credit');
  assert.equal(resolvedSearch?.sourceTier, 'B');
  assert.equal(resolvedSearch?.factualUse, 'discovery_and_confirmation');
  assert.equal(redirectedDiscovery?.rawRecordId, resolvedSearch?.id);
  const urlIndex = await readJson<Record<string, { lastRecordId: string }>>(
    safeDataPath(root, 'indexes', 'url-index.json'),
  );
  assert.equal(urlIndex['https://google.com/goto?url=opaque-doctor-of-credit']?.lastRecordId, resolvedSearch?.id);
  assert.equal(urlIndex['https://doctorofcredit.com/new-transfer-bonus']?.lastRecordId, resolvedSearch?.id);

  const second = await runCollectionStage({
    root,
    client,
    now: new Date('2026-08-21T13:00:00Z'),
    redditFetchImpl: async () => new Response('', { status: 429 }),
    youtubeFetchImpl: async () => new Response('', { status: 429 }),
  });
  assert.equal(second.outputCount, 0);
  assert.equal((await listJsonFiles(safeDataPath(root, '01-raw'))).length, 2);
});

test('filter applies OR keywords and dedupe attaches duplicate evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-stages-'));
  const filterProgress: string[] = [];
  const dedupeProgress: string[] = [];
  await initializeCreddyDataRoot(root);
  const base: RawArticleRecord = {
    version: CREDDY_PIPELINE_VERSION,
    id: 'raw-a',
    runId: '20260819T120000Z-aaaaaaaa',
    sourceId: 'awardwallet',
    sourceName: 'AwardWallet',
    sourceTier: 'B',
    factualUse: 'discovery_and_confirmation',
    originalUrl: 'https://awardwallet.com/blog/bonus',
    canonicalUrl: 'https://awardwallet.com/blog/bonus',
    title: 'New Transfer Bonus',
    markdown: 'A transfer bonus is available for airline points. The promotion applies to eligible US cardholders and includes clear program terms and an announced end date.',
    contentHash: 'a'.repeat(64),
    titleFingerprint: 'new transfer bonus',
    fetchedAt: '2026-08-19T12:00:00.000Z',
    providerMetadata: {},
  };
  const duplicate: RawArticleRecord = {
    ...base,
    id: 'raw-b',
    sourceId: 'frequent-miler',
    sourceName: 'Frequent Miler',
    originalUrl: 'https://frequentmiler.com/bonus-report',
    canonicalUrl: 'https://frequentmiler.com/bonus-report',
    contentHash: 'b'.repeat(64),
  };
  const noise: RawArticleRecord = {
    ...base,
    id: 'raw-noise',
    originalUrl: 'https://awardwallet.com/blog/weather',
    canonicalUrl: 'https://awardwallet.com/blog/weather',
    title: 'Weather Today',
    markdown: 'It will rain this afternoon.',
    contentHash: 'c'.repeat(64),
    titleFingerprint: 'weather today',
  };
  for (const record of [base, duplicate, noise]) {
    await writeJsonAtomic(
      safeDataPath(root, '01-raw', '2026-08-19', record.runId, `${record.id}.json`),
      record,
    );
  }

  const filtered = await runFilterStage(root, new Date('2026-08-19T12:05:00Z'), (event) => {
    filterProgress.push(event.phase);
  });
  assert.equal(filtered.outputCount, 2);
  assert.equal(filtered.skippedCount, 1);
  assert.ok(filterProgress.includes('record_qualified'));
  assert.ok(filterProgress.includes('record_rejected'));
  assert.equal(filterProgress.at(-1), 'run_completed');

  const deduped = await runDedupeStage(root, new Date('2026-08-19T12:10:00Z'), (event) => {
    dedupeProgress.push(event.phase);
  });
  assert.equal(deduped.outputCount, 1);
  assert.equal(deduped.skippedCount, 1);
  assert.ok(dedupeProgress.includes('record_canonicalized'));
  assert.ok(dedupeProgress.includes('record_archived'));
  assert.equal(dedupeProgress.at(-1), 'run_completed');
  const canonicalFiles = await listJsonFiles(
    safeDataPath(root, '03-canonical-news', 'approved'),
  );
  assert.equal(canonicalFiles.length, 1);
  const canonical = await readJson<{ evidenceRecordIds: string[] }>(canonicalFiles[0]);
  assert.deepEqual(canonical.evidenceRecordIds.sort(), ['raw-a', 'raw-b']);
  const verified = await readJson<{
    verification: { status: string; evidenceSourceIds: string[]; requiresFactCheck: boolean };
  }>(canonicalFiles[0]);
  assert.equal(verified.verification.status, 'corroborated');
  assert.deepEqual(verified.verification.evidenceSourceIds.sort(), ['awardwallet', 'frequent-miler']);
  assert.equal(verified.verification.requiresFactCheck, false);

  await writeObservablePipelineReports(root);
  const immutableReport = await readFile(
    safeDataPath(root, 'reports', 'runs', deduped.runId, '02-filtering-and-deduplication.md'),
    'utf8',
  );
  const decisionLedger = await readFile(
    safeDataPath(root, 'reports', 'runs', deduped.runId, '02-decision-ledger.md'),
    'utf8',
  );
  assert.match(immutableReport, /Canonical articles retained: 1/);
  assert.match(decisionLedger, /New Transfer Bonus/);
  assert.match(decisionLedger, /duplicate_archived/);
});

test('filter rejects navigation pages before the keyword gate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'creddy-quality-'));
  await initializeCreddyDataRoot(root);
  const record: RawArticleRecord = {
    version: CREDDY_PIPELINE_VERSION,
    id: 'raw-navigation',
    runId: '20260819T120000Z-bbbbbbbb',
    sourceId: 'example',
    sourceName: 'Example',
    sourceTier: 'C',
    factualUse: 'discovery_only',
    originalUrl: 'https://example.com/news',
    canonicalUrl: 'https://example.com/news',
    title: 'News',
    markdown: 'Transfer bonus redemption status tools and many navigation links are shown here.',
    contentHash: 'd'.repeat(64),
    titleFingerprint: 'news',
    fetchedAt: '2026-08-19T12:00:00.000Z',
    providerMetadata: {},
  };
  await writeJsonAtomic(
    safeDataPath(root, '01-raw', '2026-08-19', record.runId, `${record.id}.json`),
    record,
  );
  const result = await runFilterStage(root, new Date('2026-08-19T12:05:00Z'));
  assert.equal(result.outputCount, 0);
  const rejection = await readJson<{ reason: string }>(
    safeDataPath(root, '03-canonical-news', 'rejected', `${record.id}.json`),
  );
  assert.equal(rejection.reason, 'non_article');
});

test('data quality rejects browse-all guide indexes even when their footer has relevant phrases', () => {
  const raw = {
    title: 'Browse Credit Card Guides from Example.com',
    markdown: 'Compare the complete catalog of guides. Airport lounge access and statement credit links appear in the navigation footer.',
    providerMetadata: {},
  } as RawArticleRecord;
  assert.equal(dataQualityRejection(raw)?.reason, 'non_article');
});

test('data quality rejects observed multi-topic link roundups', () => {
  const raw = {
    sourceId: 'miles-to-memories',
    sourceName: 'Miles to Memories',
    canonicalUrl: 'https://milestomemories.com/around-the-web-1098',
    title: "Amazon lawsuit, insure your points from devaluation, and Paris day trips",
    markdown: 'A collection of unrelated links. One link discusses protecting points from devaluation while the other links cover unrelated news.',
    providerMetadata: {},
  } as RawArticleRecord;
  assert.equal(dataQualityRejection(raw)?.reason, 'non_article');
});

test('qualification ignores keywords found only in related-post and footer boilerplate', () => {
  const raw = {
    title: 'VPN cashback deal',
    markdown: [
      '## The Offer',
      'Get cashback on a VPN subscription.',
      '### You may also like',
      '[Airline redemption guide](https://example.com/redemption)',
    ].join('\n'),
  } as RawArticleRecord;
  assert.equal(
    qualifyCreddyText(articleTextForQualification(raw)).qualifies,
    false,
  );
});

test('article cleaning skips navigation before a matching article heading', () => {
  const raw = {
    title: 'Which credit cards reward you with milestone bonuses? - The Example',
    markdown: [
      '- [Home](https://example.com)',
      '- [Credit Cards](https://example.com/cards)',
      '# Which credit cards reward you with milestone bonuses?',
      'Singapore credit cardholders can earn a milestone bonus after S$80,000 annual spend with UOB or S$60,000 with DBS.',
      '## Related Articles',
      'A US welcome offer appears only in this unrelated footer.',
    ].join('\n'),
    providerMetadata: {},
  } as RawArticleRecord;
  const articleText = articleTextForQualification(raw);
  assert.doesNotMatch(articleText, /\[Home\]/);
  assert.match(articleText, /S\$80,000/);
  assert.doesNotMatch(articleText, /US welcome offer/);
  assert.equal(dataQualityRejection(raw)?.reason, 'wrong_market');
});

test('qualification ignores status tokens found only inside social link destinations', () => {
  const raw = {
    title: 'Airline improves meals but cabin cleaning still lags',
    markdown: '[View on X](https://x.com/example/status/123?ref_url=https://airline.example/story)\nThe cabin food and cleaning experience changed.',
  } as RawArticleRecord;
  assert.equal(qualifyCreddyText(articleTextForQualification(raw)).qualifies, false);
});

test('filter rejects articles explicitly limited to a non-US card market', () => {
  const raw = {
    title: 'Status matching for Indian frequent flyers',
    markdown: 'Indian residents can use this airline status match. Eligible cards issued in India provide hotel status to Indian residents.',
    providerMetadata: {},
  } as RawArticleRecord;
  assert.equal(dataQualityRejection(raw)?.reason, 'wrong_market');
});

test('market guard keeps globally relevant India content actionable to US travelers', () => {
  const raw = {
    title: 'How US travelers can use points in India',
    markdown: 'US travelers can redeem airline points in India. Cardholders receive lounge access in India when flying through Delhi with US-issued credit cards.',
    providerMetadata: {},
  } as RawArticleRecord;
  assert.equal(dataQualityRejection(raw), undefined);
});

test('Agent 02 calibration retains points upgrades and notable Admirals Club news', () => {
  assert.equal(
    qualifyCreddyText('Emirates Points Upgrade Strategy: upgrade a JFK cash ticket using airline points.').qualifies,
    true,
  );
  assert.equal(
    qualifyCreddyText("American announces its largest Admirals Club airport lounge at DFW.").qualifies,
    true,
  );
});

test('market guard rejects Singapore card-product spend guides but not global Singapore Airlines awards', () => {
  const localCards = {
    title: 'Which credit cards reward you with milestone bonuses?',
    markdown: 'Singapore credit cardholders can earn a milestone bonus. UOB requires S$80,000 annual spend, while DBS requires S$60,000 and Maybank has a separate card threshold.',
    providerMetadata: {},
  } as RawArticleRecord;
  assert.equal(dataQualityRejection(localCards)?.reason, 'wrong_market');

  const globalAwards = {
    title: 'Singapore Airlines opens US award space',
    markdown: 'US travelers can redeem airline points from New York for Singapore Airlines business-class award seats.',
    providerMetadata: {},
  } as RawArticleRecord;
  assert.equal(dataQualityRejection(globalAwards), undefined);
});

test('near-title dedupe groups the same event but preserves offers with different numbers', () => {
  assert.equal(
    titlesDescribeSameStory(
      'Chase launches elevated 100K Ink Business welcome offer',
      'New Chase Ink Business cards get an elevated 100K welcome offer',
    ),
    true,
  );
  assert.equal(
    titlesDescribeSameStory(
      'Chase launches elevated 100K Ink Business welcome offer',
      'Chase launches elevated 150K Ink Business welcome offer',
    ),
    false,
  );
});

test('verification requires two confirmation-eligible sources', () => {
  assert.equal(verificationForEvidence([
    { sourceId: 'reddit-awardtravel', factualUse: 'signal_only' },
  ]).status, 'community_signal_only');
  assert.equal(verificationForEvidence([
    { sourceId: 'reddit-awardtravel', factualUse: 'signal_only' },
    { sourceId: 'awardwallet', factualUse: 'discovery_and_confirmation' },
  ]).status, 'single_source_unverified');
  assert.equal(verificationForEvidence([
    { sourceId: 'awardwallet', factualUse: 'discovery_and_confirmation' },
    { sourceId: 'frequent-miler', factualUse: 'discovery_and_confirmation' },
  ]).status, 'corroborated');
  assert.equal(verificationForEvidence([
    { sourceId: 'thrifty-traveler', factualUse: 'discovery_only' },
    { sourceId: 'loyalty-lobby', factualUse: 'discovery_only' },
  ]).status, 'single_source_unverified');
});
