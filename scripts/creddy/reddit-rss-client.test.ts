import assert from 'node:assert/strict';
import test from 'node:test';

import { fetchRedditRss, parseRedditAtom } from './reddit-rss-client.js';
import { CREDDY_SOURCES } from './config.js';

test('Reddit Atom parser keeps only post entries and extracts readable content', () => {
  const xml = `<?xml version="1.0"?><feed>
    <entry><title>New transfer bonus &amp; details</title>
      <link href="https://www.reddit.com/r/awardtravel/comments/abc123/new_transfer_bonus/" />
      <updated>2026-08-19T10:00:00Z</updated>
      <content type="html">&lt;p&gt;Earn &lt;b&gt;20% more&lt;/b&gt; points.&lt;/p&gt;</content>
    </entry>
    <entry><title>Navigation</title><link href="https://www.reddit.com/r/awardtravel/" />
      <content type="html">ignored</content></entry>
  </feed>`;
  assert.deepEqual(parseRedditAtom(xml), [{
    url: 'https://www.reddit.com/r/awardtravel/comments/abc123/new_transfer_bonus/',
    title: 'New transfer bonus & details',
    markdown: '# New transfer bonus & details\n\nEarn 20% more points.',
    publishedAt: '2026-08-19T10:00:00Z',
  }]);
});

test('Reddit RSS uses its bounded fallback after a server error', async () => {
  const source = CREDDY_SOURCES.find((item) => item.id === 'reddit-churning');
  assert.ok(source);
  const requested: string[] = [];
  const entries = await fetchRedditRss(source, 10, async (input) => {
    requested.push(String(input));
    if (requested.length === 1) return new Response('', { status: 503 });
    return new Response(`<feed><entry><title>Daily thread</title><link href="https://www.reddit.com/r/churning/comments/abc/daily_thread/"/><content type="html">Discussion</content></entry></feed>`, { status: 200 });
  });
  assert.equal(entries.length, 1);
  assert.equal(new URL(requested[1]).pathname.endsWith('/.rss'), true);
});

test('Reddit RSS does not retry across hosts after access denial or throttling', async () => {
  const source = CREDDY_SOURCES.find(item => item.id === 'reddit-awardtravel')!;
  for (const status of [403, 429]) {
    let calls = 0;
    await assert.rejects(fetchRedditRss(source, 10, async () => { calls++; return new Response('', { status }); }), new RegExp(`HTTP ${status}`));
    assert.equal(calls, 1);
  }
});
