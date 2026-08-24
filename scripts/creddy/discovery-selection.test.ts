import assert from 'node:assert/strict';
import test from 'node:test';

import { classifyDiscoveryCandidate, selectDiscoveryCandidates } from './discovery-selection.js';

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
    discoveredTitle: `Airline transfer bonus ${index} for loyalty points`,
  }));
  const adjacent = Array.from({ length: 12 }, (_, index) => ({
    url: `https://adjacent.example/${index}`,
    laneId: `adjacent-${index % 3}`,
    discoveredTitle: `Travel rewards update ${index}`,
  }));
  const result = selectDiscoveryCandidates([...core, ...adjacent], 20);
  assert.equal(result.selected.length, 20);
  assert.equal(result.selected.filter((item) => item.url.includes('adjacent')).length, 4);
  assert.equal(new Set(result.selected.slice(0, 6).map((item) => item.laneId)).size, 6);
  assert.deepEqual(result.selected, selectDiscoveryCandidates([...core, ...adjacent], 20).selected);
});

test('selection provides bounded lane coverage across sequential twice-daily slots', () => {
  const adjacent = Array.from({ length: 14 }, (_, index) => ({
    url: `https://adjacent.example/${index}`,
    laneId: `adjacent-${index.toString().padStart(2, '0')}`,
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
      adjacent,
      20,
      new Date(scheduledTime),
    ).selected;
    assert.equal(selected.length, 4);
    selected.forEach((item) => covered.add(item.laneId));
  }
  assert.equal(covered.size, 14);
});

test('adjacent items approaching expiry are selected ahead of undated exploration', () => {
  const now = new Date('2026-08-24T12:00:00.000Z');
  const expiring = {
    url: 'https://www.youtube.com/watch?v=expiring',
    laneId: 'source:creator',
    discoveredTitle: 'Travel rewards strategy update',
    publishedAt: '2026-08-23T12:30:00.000Z',
  };
  const undated = Array.from({ length: 8 }, (_, index) => ({
    url: `https://adjacent.example/${index}`,
    laneId: `adjacent-${index}`,
    discoveredTitle: `Travel rewards update ${index}`,
  }));
  const selected = selectDiscoveryCandidates([expiring, ...undated], 20, now).selected;
  assert.ok(selected.includes(expiring));
  assert.equal(selected.indexOf(expiring), 0);
});

test('expiring adjacent items preserve lane diversity when one RSS lane is busy', () => {
  const now = new Date('2026-08-24T12:00:00.000Z');
  const reddit = Array.from({ length: 5 }, (_, index) => ({
    url: `https://reddit.com/r/awardtravel/comments/${index}`,
    laneId: 'source:reddit-awardtravel',
    discoveredTitle: `Travel rewards discussion ${index}`,
    publishedAt: `2026-08-23T${String(13 + index).padStart(2, '0')}:00:00.000Z`,
  }));
  const geobreeze = {
    url: 'https://youtube.com/watch?v=geobreeze-expiring',
    laneId: 'source:geobreeze-travel',
    discoveredTitle: 'Travel rewards strategy update',
    publishedAt: '2026-08-23T13:30:00.000Z',
  };
  const selected = selectDiscoveryCandidates([...reddit, geobreeze], 20, now).selected;
  assert.equal(selected.length, 4);
  assert.ok(selected.includes(geobreeze));
  assert.equal(new Set(selected.map((item) => item.laneId)).size, 2);
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
