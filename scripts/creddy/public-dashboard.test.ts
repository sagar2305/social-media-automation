import assert from 'node:assert/strict';
import test from 'node:test';

import { optionalStableDashboardBaseUrl, requireStableDashboardBaseUrl } from './public-dashboard.js';

test('accepts a stable public HTTPS dashboard origin', () => {
  assert.equal(
    requireStableDashboardBaseUrl({ DASHBOARD_BASE_URL: 'https://creddy.example.com/' }),
    'https://creddy.example.com',
  );
});

test('rejects temporary Cloudflare quick tunnels', () => {
  assert.throws(
    () => requireStableDashboardBaseUrl({ DASHBOARD_BASE_URL: 'https://temporary-name.trycloudflare.com' }),
    /stable named hostname/,
  );
});

test('rejects localhost, HTTP, paths, and missing URLs', () => {
  assert.throws(() => requireStableDashboardBaseUrl({}), /required/);
  assert.throws(
    () => requireStableDashboardBaseUrl({ DASHBOARD_BASE_URL: 'http://creddy.example.com' }),
    /HTTPS/,
  );
  assert.throws(
    () => requireStableDashboardBaseUrl({ DASHBOARD_BASE_URL: 'https://localhost:3000' }),
    /public DNS hostname/,
  );
  assert.throws(
    () => requireStableDashboardBaseUrl({ DASHBOARD_BASE_URL: 'https://creddy.example.com/dashboard' }),
    /without a path/,
  );
});

test('optional helper omits invalid portal links', () => {
  assert.equal(optionalStableDashboardBaseUrl({ DASHBOARD_BASE_URL: 'https://x.trycloudflare.com' }), undefined);
});
