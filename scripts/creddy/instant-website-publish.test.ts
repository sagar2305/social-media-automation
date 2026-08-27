import assert from 'node:assert/strict';
import test from 'node:test';

import { assertInstantWebsitePublishConfigured, resolveWebsiteCmsCredentials } from './instant-website-publish.js';

function legacyJwt(ref: string, role = 'service_role'): string {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({ ref, role })).toString('base64url');
  return `${header}.${payload}.test-signature`;
}

const PROJECT_A = 'projectrefalpha';
const PROJECT_B = 'projectrefbravo';

test('instant website publishing fails closed unless the approval gate exists', () => {
  assert.throws(() => assertInstantWebsitePublishConfigured({}), /disabled/);
});

test('CMS credentials require CREDDY_SUPABASE_URL and never fall back to a public URL', () => {
  assert.throws(() => resolveWebsiteCmsCredentials({
    NEXT_PUBLIC_SUPABASE_URL: `https://${PROJECT_A}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: legacyJwt(PROJECT_A),
  }), /CREDDY_SUPABASE_URL is missing/);
});

test('CMS credentials reject a missing protected server credential', () => {
  assert.throws(() => assertInstantWebsitePublishConfigured({
    CREDDY_WEBSITE_AUTO_PUBLISH_ON_APPROVAL: 'true',
    CREDDY_SUPABASE_URL: `https://${PROJECT_A}.supabase.co`,
  }), /SUPABASE_SERVICE_ROLE_KEY/);
});

test('CMS credentials prefer CREDDY_SUPABASE_URL when both URL variables differ', () => {
  const resolved = resolveWebsiteCmsCredentials({
    CREDDY_SUPABASE_URL: `https://${PROJECT_A}.supabase.co`,
    NEXT_PUBLIC_SUPABASE_URL: `https://${PROJECT_B}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: legacyJwt(PROJECT_A),
  });
  assert.equal(resolved.projectRef, PROJECT_A);
});

test('CMS credentials reject a URL and legacy server key from different projects', () => {
  assert.throws(() => resolveWebsiteCmsCredentials({
    CREDDY_SUPABASE_URL: `https://${PROJECT_A}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: legacyJwt(PROJECT_B),
  }), /project references do not match/);
});

test('CMS credentials accept a matching URL and protected server key', () => {
  assert.doesNotThrow(() => assertInstantWebsitePublishConfigured({
    CREDDY_WEBSITE_AUTO_PUBLISH_ON_APPROVAL: 'true',
    CREDDY_SUPABASE_URL: `https://${PROJECT_A}.supabase.co`,
    SUPABASE_SERVICE_ROLE_KEY: legacyJwt(PROJECT_A),
  }));
});
