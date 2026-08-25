import assert from 'node:assert/strict';
import test from 'node:test';

import { inspectPublicCreddyReleases } from './product-release-stage.js';

test('public release monitor detects a new app build without exposing response bodies', async () => {
  const fetchImpl = (async (input: string | URL | Request) => {
    const url = String(input);
    if (url.includes('itunes.apple.com')) {
      return new Response(JSON.stringify({ results: [{ version: '1.0.3', currentVersionReleaseDate: '2026-08-26T00:00:00Z' }] }), { status: 200 });
    }
    return new Response('<div>Updated on</div><div>Aug 8, 2026</div>', { status: 200 });
  }) as typeof fetch;
  const status = await inspectPublicCreddyReleases(new Date('2026-08-26T00:00:00Z'), fetchImpl);
  assert.equal(status.ios.changed, true);
  assert.equal(status.android.changed, false);
  assert.equal(status.requiresReview, true);
});

test('public release monitor remains usable during a transient lookup failure', async () => {
  const fetchImpl = (async () => new Response('down', { status: 503 })) as typeof fetch;
  const status = await inspectPublicCreddyReleases(new Date('2026-08-26T00:00:00Z'), fetchImpl);
  assert.equal(status.requiresReview, false);
  assert.equal(status.warnings.length, 2);
});
