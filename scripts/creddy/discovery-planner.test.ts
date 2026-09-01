import assert from 'node:assert/strict';
import test from 'node:test';

import { CREDDY_SOURCES } from './config.js';
import { activeCreddyTopicSearches } from './discovery-cadence.js';
import { buildCreddyDiscoveryPlan, filterSourceArticleLinks } from './discovery-planner.js';

test('discovery plan contains approved listings and six rotating searches without network access', () => {
  const plan = buildCreddyDiscoveryPlan(new Date('2026-08-24T12:00:00.000Z'));
  assert.equal(plan.sourceOperations.length, 18);
  assert.equal(plan.searchOperations.length, 6);
  assert.equal(plan.baselineRequests, 24);
});

test('consecutive New York hourly windows cover all twelve searches without overlap', () => {
  const firstHour = activeCreddyTopicSearches(new Date('2026-08-24T12:00:00.000Z'));
  const secondHour = activeCreddyTopicSearches(new Date('2026-08-24T13:00:00.000Z'));
  assert.equal(firstHour.length, 6);
  assert.equal(secondHour.length, 6);
  assert.equal(firstHour.some((search) => secondHour.some((other) => other.id === search.id)), false);
  assert.equal(new Set([...firstHour, ...secondHour].map((search) => search.id)).size, 12);
});

for (const [label, first, second] of [
  ['spring forward', '2026-03-08T06:00:00.000Z', '2026-03-08T07:00:00.000Z'],
  ['fall back', '2026-11-01T05:00:00.000Z', '2026-11-01T06:00:00.000Z'],
] as const) {
  test(`hourly search rotation remains disjoint across New York ${label}`, () => {
    const firstHour = activeCreddyTopicSearches(new Date(first));
    const secondHour = activeCreddyTopicSearches(new Date(second));
    assert.equal(firstHour.some((search) => secondHour.some((other) => other.id === search.id)), false);
    assert.equal(new Set([...firstHour, ...secondHour].map((search) => search.id)).size, 12);
  });
}

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

test('Miles to Memories skips roundup pages before article scraping', () => {
  const source = CREDDY_SOURCES.find((candidate) => candidate.id === 'miles-to-memories');
  assert.ok(source);
  assert.deepEqual(
    filterSourceArticleLinks(source, [
      'https://milestomemories.com/around-the-web-321/',
      'https://milestomemories.com/a-new-airline-transfer-bonus/',
    ]),
    ['https://milestomemories.com/a-new-airline-transfer-bonus'],
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
