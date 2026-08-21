import assert from 'node:assert/strict';
import test from 'node:test';

import { FirecrawlClient, FirecrawlRequestError } from './firecrawl-client.js';

function response(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

test('scrapePage uses predictable one-credit options and US locale', async () => {
  let requestUrl = '';
  let requestInit: RequestInit | undefined;
  const client = new FirecrawlClient({
    apiKey: 'test-key',
    fetchImpl: async (url, init) => {
      requestUrl = String(url);
      requestInit = init;
      return response({
        success: true,
        data: { markdown: '# News', links: ['https://example.com/new'] },
      });
    },
  });

  const data = await client.scrapePage('https://example.com/news');
  assert.equal(requestUrl, 'https://api.firecrawl.dev/v2/scrape');
  assert.equal(data.markdown, '# News');

  const body = JSON.parse(String(requestInit?.body));
  assert.deepEqual(body.formats, ['markdown', 'links']);
  assert.equal(body.proxy, 'basic');
  assert.equal(body.maxAge, 900_000);
  assert.deepEqual(body.location, { country: 'US', languages: ['en-US'] });
  const usage = client.getUsageSnapshot();
  assert.equal(usage.scrapeRequests, 1);
  assert.equal(usage.scrapeSuccesses, 1);
  assert.equal(usage.creditsComplete, false);
});

test('searchNews discovers URLs without scraping every result', async () => {
  let requestBody: Record<string, unknown> = {};
  const client = new FirecrawlClient({
    apiKey: 'test-key',
    fetchImpl: async (_url, init) => {
      requestBody = JSON.parse(String(init?.body));
      return response({
        success: true,
        data: { news: [{ title: 'New bonus', url: 'https://example.com/bonus' }] },
        creditsUsed: 2,
      });
    },
  });

  const results = await client.searchNews('transfer bonus');
  assert.equal(results.length, 1);
  assert.deepEqual(requestBody.sources, ['news']);
  assert.equal(requestBody.tbs, 'qdr:d');
  assert.equal('scrapeOptions' in requestBody, false);
  const usage = client.getUsageSnapshot();
  assert.equal(usage.searchRequests, 1);
  assert.equal(usage.reportedCredits, 2);
  assert.equal(usage.creditsComplete, true);
});

test('request failures redact the configured key', async () => {
  const client = new FirecrawlClient({
    apiKey: 'secret-test-key',
    fetchImpl: async () => response({ error: 'secret-test-key rejected' }, 401),
  });

  await assert.rejects(
    () => client.searchNews('hotel status'),
    (error: unknown) => {
      assert.ok(error instanceof FirecrawlRequestError);
      assert.equal(error.status, 401);
      assert.equal(error.message.includes('secret-test-key'), false);
      assert.equal(error.message.includes('[redacted]'), true);
      return true;
    },
  );
  assert.equal(client.getUsageSnapshot().searchFailures, 1);
});

test('invalid URL protocols are rejected before network use', async () => {
  const client = new FirecrawlClient({
    apiKey: 'test-key',
    fetchImpl: async () => {
      throw new Error('fetch must not run');
    },
  });
  await assert.rejects(() => client.scrapePage('file:///tmp/private'), /Unsupported scrape protocol/);
});
