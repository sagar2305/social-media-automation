import assert from 'node:assert/strict';
import test from 'node:test';

import { resolveCreddyNewsDataRoot } from './data-root.js';

test('uses a separate default directory from the existing Creddy pipeline', () => {
  const env = { CREDDY_DATA_ROOT: '/tmp/creddy-agent-test' };
  assert.equal(resolveCreddyNewsDataRoot(env), '/tmp/creddy-agent-test/creddy-news');
});

test('supports an explicit standalone News root', () => {
  assert.equal(resolveCreddyNewsDataRoot({ CREDDY_NEWS_DATA_ROOT: '/tmp/app-news-only' }), '/tmp/app-news-only');
});

test('rejects relative and shared content-pipeline roots', () => {
  assert.throws(() => resolveCreddyNewsDataRoot({ CREDDY_NEWS_DATA_ROOT: 'news' }), /absolute/);
  assert.throws(() => resolveCreddyNewsDataRoot({
    CREDDY_DATA_ROOT: '/tmp/creddy-agent-test',
    CREDDY_NEWS_DATA_ROOT: '/tmp/creddy-agent-test/creddy',
  }), /must be different/);
});
