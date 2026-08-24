import assert from 'node:assert/strict';
import test from 'node:test';

import { parseYouTubeAtom } from './youtube-feed-client.js';

test('YouTube creator feed preserves title, description, publication time, and public metrics', () => {
  const xml = `<?xml version="1.0"?><feed><entry>
    <title>New Flying Blue Sweet Spot</title>
    <link rel="alternate" href="https://www.youtube.com/watch?v=test123"/>
    <published>2026-08-24T10:00:00Z</published>
    <media:description>A useful redemption for US points travelers.</media:description>
    <media:starRating count="42" average="5.00"/>
    <media:statistics views="1200"/>
  </entry></feed>`;
  const [entry] = parseYouTubeAtom(xml);
  assert.equal(entry.title, 'New Flying Blue Sweet Spot');
  assert.equal(entry.publishedAt, '2026-08-24T10:00:00Z');
  assert.match(entry.markdown, /useful redemption/);
  assert.deepEqual(entry.providerMetadata, {
    collectionProvider: 'youtube_rss',
    views: 1200,
    likes: 42,
  });
});
