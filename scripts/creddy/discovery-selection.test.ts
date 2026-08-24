import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyDiscoveryCandidate, discoveryEventFingerprint, selectDiscoveryCandidates } from './discovery-selection.js';

function supportingCore(): Array<{ url: string; laneId: string; publisherKey: string; discoveredTitle: string }> {
  return Array.from({ length: 16 }, (_, index) => ({
    url: `https://supporting-core-${index}.example/story`,
    laneId: `supporting-core-${index}`,
    publisherKey: `supporting-core-${index}`,
    discoveredTitle: `Airline loyalty transfer bonus ${index + 100}`,
  }));
}

test('obvious generic news is visible but never selected for scraping', () => {
  const noise = {
    url: 'https://example.com/hotel-status',
    laneId: 'search:hotel',
    discoveredTitle: 'Netflix filming status at a historic hotel',
  };
  assert.equal(classifyDiscoveryCandidate(noise).discoveryClass, 'low_relevance');
  assert.deepEqual(selectDiscoveryCandidates([noise], 20).selected, []);
});

test('selection is deterministic, fair by lane, and caps adjacent exploration at twenty percent', () => {
  const core = Array.from({ length: 24 }, (_, index) => ({
    url: `https://core.example/${index}`,
    laneId: `core-${index % 6}`,
    publisherKey: `core-${index % 6}`,
    discoveredTitle: `Airline transfer bonus ${index} for loyalty points`,
  }));
  const adjacent = Array.from({ length: 12 }, (_, index) => ({
    url: `https://adjacent.example/${index}`,
    laneId: `adjacent-${index % 3}`,
    publisherKey: `adjacent-${index % 3}`,
    discoveredTitle: `Travel rewards update ${index}`,
  }));
  const result = selectDiscoveryCandidates([...core, ...adjacent], 20);
  assert.equal(result.selected.length, 20);
  assert.equal(result.selected.filter((item) => item.url.includes('adjacent')).length, 4);
  assert.equal(new Set(result.selected.slice(0, 6).map((item) => item.laneId)).size, 6);
  assert.deepEqual(result.selected, selectDiscoveryCandidates([...core, ...adjacent], 20).selected);
});

test('explicit card offers, benefit changes, and loyalty promotions classify as core', () => {
  const coreTitles = [
    'Marriott Card 150K Bonus Points + $250 Statement Credit Offer',
    "The Citi AAdvantage Executive's new benefits are live",
    'August Flying Blue Promo Awards',
    'How to maximize online shopping portals for airline points',
    'This underrated credit card perk includes US Open access',
    'New 125K Welcome Bonus on the AAdvantage Executive Card',
    'Amex points now transfer to ALL Accor hotels',
    'Which credit cards offer milestone bonuses?',
  ];
  for (const [index, discoveredTitle] of coreTitles.entries()) {
    assert.equal(classifyDiscoveryCandidate({
      url: `https://example.com/core-${index}`,
      laneId: 'source:example',
      discoveredTitle,
    }).discoveryClass, 'core', discoveredTitle);
  }
});

test('generic evergreen card indexes remain adjacent without a timely core signal', () => {
  assert.equal(classifyDiscoveryCandidate({
    url: 'https://example.com/best-card-offers',
    laneId: 'source:example',
    discoveredTitle: 'Best Credit Card Offers',
  }).discoveryClass, 'adjacent');
});

test('publisher and event caps are hard while eight-publisher diversity is best effort', () => {
  const repeatedEvent = Array.from({ length: 5 }, (_, index) => ({
    url: `https://publisher-${index}.example/chase-offer`,
    laneId: `source:publisher-${index}`,
    publisherKey: `publisher-${index}`,
    discoveredTitle: 'Chase launches a 100K welcome bonus for its Ink card',
  }));
  const varied = Array.from({ length: 24 }, (_, index) => ({
    url: `https://varied-${index % 9}.example/story-${index}`,
    laneId: `source:varied-${index % 9}`,
    publisherKey: `varied-${index % 9}`,
    discoveredTitle: `Airline transfer bonus ${20 + index}% for loyalty points program ${index}`,
  }));
  const selected = selectDiscoveryCandidates([...repeatedEvent, ...varied], 20).selected;
  const publisherCounts = new Map<string, number>();
  for (const item of selected) publisherCounts.set(item.publisherKey!, (publisherCounts.get(item.publisherKey!) ?? 0) + 1);
  assert.equal(Math.max(...publisherCounts.values()) <= 3, true);
  assert.equal(selected.filter((item) => item.discoveredTitle === repeatedEvent[0].discoveredTitle).length, 2);
  assert.equal(new Set(selected.map((item) => item.publisherKey)).size >= 8, true);
});

test('meaningful numbers remain distinct in event fingerprints and selection', () => {
  const twenty = {
    url: 'https://a.example/bonus-20', laneId: 'source:a', publisherKey: 'a',
    discoveredTitle: 'Amex launches a 20 percent Flying Blue transfer bonus',
  };
  const thirty = {
    url: 'https://b.example/bonus-30', laneId: 'source:b', publisherKey: 'b',
    discoveredTitle: 'Amex launches a 30% Flying Blue transfer bonus',
  };
  assert.notEqual(discoveryEventFingerprint(twenty), discoveryEventFingerprint(thirty));
  assert.deepEqual(selectDiscoveryCandidates([twenty, thirty], 20).selected, [twenty, thirty]);
});

test('adjacent candidates never backfill an undersupplied core allocation', () => {
  const core = Array.from({ length: 2 }, (_, index) => ({
    url: `https://core-${index}.example/story`, laneId: `source:core-${index}`, publisherKey: `core-${index}`,
    discoveredTitle: `Airline transfer bonus ${index} for loyalty points`,
  }));
  const adjacent = Array.from({ length: 20 }, (_, index) => ({
    url: `https://adjacent-${index}.example/story`, laneId: `source:adjacent-${index}`, publisherKey: `adjacent-${index}`,
    discoveredTitle: `Travel rewards discussion ${index}`,
  }));
  const selected = selectDiscoveryCandidates([...core, ...adjacent], 20).selected;
  assert.equal(selected.length, 2);
  assert.equal(selected.filter((item) => item.url.includes('adjacent')).length, 0);
});

test('opaque search redirects remain separate unknown publisher lanes', () => {
  const candidates = Array.from({ length: 4 }, (_, index) => ({
    url: `https://google.com/goto?url=opaque-${index}`,
    laneId: `search:query-${index}`,
    publisherKey: `unknown:query-${index}`,
    discoveredTitle: `Travel rewards update ${index}`,
  }));
  const selected = selectDiscoveryCandidates([...supportingCore(), ...candidates], 20).selected;
  assert.equal(selected.filter((item) => item.publisherKey.startsWith('unknown:')).length, 4);
});

test('selection provides bounded lane coverage across sequential twice-daily slots', () => {
  const adjacent = Array.from({ length: 14 }, (_, index) => ({
    url: `https://adjacent.example/${index}`,
    laneId: `adjacent-${index.toString().padStart(2, '0')}`,
    publisherKey: `adjacent-${index.toString().padStart(2, '0')}`,
    discoveredTitle: `Travel rewards update ${index}`,
  }));
  const covered = new Set<string>();
  // 08:00 and 18:00 America/New_York in August (EDT).
  for (const scheduledTime of [
    '2026-08-24T12:00:00.000Z',
    '2026-08-24T22:00:00.000Z',
    '2026-08-25T12:00:00.000Z',
    '2026-08-25T22:00:00.000Z',
  ]) {
    const selected = selectDiscoveryCandidates(
      [...supportingCore(), ...adjacent],
      20,
      new Date(scheduledTime),
    ).selected;
    assert.equal(selected.length, 20);
    selected.filter((item) => item.url.includes('adjacent.example')).forEach((item) => covered.add(item.laneId));
  }
  assert.equal(covered.size, 14);
});

test('adjacent items approaching expiry are selected ahead of undated exploration', () => {
  const now = new Date('2026-08-24T12:00:00.000Z');
  const expiring = {
    url: 'https://www.youtube.com/watch?v=expiring',
    laneId: 'source:creator',
    publisherKey: 'creator',
    discoveredTitle: 'Travel rewards strategy update',
    publishedAt: '2026-08-23T12:30:00.000Z',
  };
  const undated = Array.from({ length: 8 }, (_, index) => ({
    url: `https://adjacent.example/${index}`,
    laneId: `adjacent-${index}`,
    publisherKey: `adjacent-${index}`,
    discoveredTitle: `Travel rewards update ${index}`,
  }));
  const selected = selectDiscoveryCandidates([...supportingCore(), expiring, ...undated], 20, now).selected;
  assert.ok(selected.includes(expiring));
  assert.equal(selected.filter((item) => item.url.includes('youtube.com') || item.url.includes('adjacent.example'))[0], expiring);
});

test('expiring adjacent items preserve lane diversity when one RSS lane is busy', () => {
  const now = new Date('2026-08-24T12:00:00.000Z');
  const reddit = Array.from({ length: 5 }, (_, index) => ({
    url: `https://reddit.com/r/awardtravel/comments/${index}`,
    laneId: 'source:reddit-awardtravel',
    publisherKey: 'reddit-awardtravel',
    discoveredTitle: `Travel rewards discussion ${index}`,
    publishedAt: `2026-08-23T${String(13 + index).padStart(2, '0')}:00:00.000Z`,
  }));
  const geobreeze = {
    url: 'https://youtube.com/watch?v=geobreeze-expiring',
    laneId: 'source:geobreeze-travel',
    publisherKey: 'geobreeze-travel',
    discoveredTitle: 'Travel rewards strategy update',
    publishedAt: '2026-08-23T13:30:00.000Z',
  };
  const selected = selectDiscoveryCandidates([...supportingCore(), ...reddit, geobreeze], 20, now).selected;
  assert.equal(selected.length, 20);
  assert.ok(selected.includes(geobreeze));
  const selectedAdjacent = selected.filter((item) => item.laneId.startsWith('source:'));
  assert.equal(selectedAdjacent.length, 4);
  assert.equal(new Set(selectedAdjacent.map((item) => item.laneId)).size, 2);
});

test('dated feed items outside the news window are deferred', () => {
  const candidate = {
    url: 'https://www.youtube.com/watch?v=old',
    laneId: 'source:creator',
    discoveredTitle: 'Airline transfer bonus for loyalty points',
    publishedAt: '2026-08-20T00:00:00.000Z',
  };
  assert.equal(
    classifyDiscoveryCandidate(candidate, new Date('2026-08-24T00:00:00.000Z')).discoveryClass,
    'low_relevance',
  );
});
