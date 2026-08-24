import assert from 'node:assert/strict';
import test from 'node:test';

import { CREDDY_SOURCES } from './config.js';
import { buildCreddyDiscoveryPlan, filterSourceArticleLinks } from './discovery-planner.js';

test('discovery plan contains approved listings and four searches without network access', () => {
  const plan = buildCreddyDiscoveryPlan();
  assert.equal(plan.sourceOperations.length, 14);
  assert.equal(plan.searchOperations.length, 4);
  assert.equal(plan.baselineRequests, 18);
});

test('source filtering keeps same-site articles and removes tracking duplicates', () => {
  const source = CREDDY_SOURCES.find((candidate) => candidate.id === 'awardwallet');
  assert.ok(source);

  assert.deepEqual(
    filterSourceArticleLinks(source, [
      '/blog/new-transfer-bonus/?utm_source=email',
      '/blog/link/affiliate-redirect',
      'https://www.awardwallet.com/blog/new-transfer-bonus/',
      'https://competitor.example/blog/new-transfer-bonus/',
      'https://awardwallet.com/privacy/',
      'https://awardwallet.com/blog/image.jpg',
      'not a valid [url',
    ]),
    ['https://awardwallet.com/blog/new-transfer-bonus'],
  );
});

test('FlyerTalk keeps thread URLs but rejects forum indexes and searches', () => {
  const source = CREDDY_SOURCES.find((candidate) => candidate.id === 'flyertalk');
  assert.ok(source);
  assert.deepEqual(
    filterSourceArticleLinks(source, [
      'https://www.flyertalk.com/forum/',
      'https://www.flyertalk.com/forum/search.php?do=getnew',
      'https://www.flyertalk.com/forum/american-airlines-aadvantage/2199999-new-status-match.html',
    ]),
    ['https://flyertalk.com/forum/american-airlines-aadvantage/2199999-new-status-match.html'],
  );
});

test('configured section paths behave as allowlists', () => {
  const source = CREDDY_SOURCES.find((candidate) => candidate.id === 'awardwallet');
  assert.ok(source);
  assert.deepEqual(
    filterSourceArticleLinks(source, [
      'https://awardwallet.com/account/settings',
      'https://awardwallet.com/blog/inside-section',
    ]),
    ['https://awardwallet.com/blog/inside-section'],
  );
});

test('source filter applies a deterministic pre-scrape cap', () => {
  const source = CREDDY_SOURCES.find((candidate) => candidate.id === 'doctor-of-credit');
  assert.ok(source);
  assert.deepEqual(
    filterSourceArticleLinks(
      source,
      ['https://doctorofcredit.com/a', 'https://doctorofcredit.com/b'],
      1,
    ),
    ['https://doctorofcredit.com/a'],
  );
});
