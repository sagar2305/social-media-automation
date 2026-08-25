import assert from 'node:assert/strict';
import test from 'node:test';

import type { ContentDraftRecord } from './pipeline-types.js';
import { CREDDY_PIPELINE_VERSION } from './pipeline-types.js';
import { phoneTemplateForDraft, validateApprovedCta } from './product-capabilities.js';

function draft(): ContentDraftRecord {
  const message = 'See your welcome-offer progress and time left in Creddy.';
  return {
    version: CREDDY_PIPELINE_VERSION,
    copyVersion: 'creddy-copy-v2',
    id: 'copy-a', analysisId: 'a', canonicalId: 'a', createdAt: '2026-08-25T00:00:00Z',
    audience: 'US', slot: 'act_now', hook: 'Offer',
    textScenes: ['1', '2', '3', '4', '5', message],
    narrationScript: 'word '.repeat(40), instagramCaption: 'Caption', tiktokCaption: 'Caption',
    hashtags: ['#one', '#two', '#three'],
    cta: {
      kind: 'product', messageId: 'welcome-see-progress-and-time', capabilityId: 'welcome_offer_progress',
      label: message, deepLink: 'creddy://home',
    },
    brief: 'Brief', sourceUrls: ['https://example.com'], factualClaims: [],
  };
}

test('truthful CTA registry locks slide 6, route, capability, and phone proof', () => {
  const valid = draft();
  assert.doesNotThrow(() => validateApprovedCta(valid, new Date('2026-08-25T00:00:00Z')));
  assert.equal(phoneTemplateForDraft(valid), 'spend_goals');

  const wrongCapability = draft();
  wrongCapability.cta.capabilityId = 'loyalty_wallet';
  assert.throws(() => validateApprovedCta(wrongCapability, new Date('2026-08-25T00:00:00Z')), /capability/);

  const wrongSlide = draft();
  wrongSlide.textScenes[5] = 'Track the offer in Creddy.';
  assert.throws(() => validateApprovedCta(wrongSlide, new Date('2026-08-25T00:00:00Z')), /Slide 6/);
});

test('stale public-product evidence blocks new Agent 4 copy', () => {
  assert.throws(
    () => validateApprovedCta(draft(), new Date('2026-10-01T00:00:00Z')),
    /registry is stale/,
  );
});

test('engagement fallback remains available after product evidence expires', () => {
  const engagement = draft();
  const message = 'Save this checklist, then verify every award with the airline.';
  engagement.cta = {
    kind: 'engagement', messageId: 'engagement-save-award-checklist',
    label: message, deepLink: 'creddy://home',
  };
  engagement.textScenes[5] = message;
  assert.doesNotThrow(() => validateApprovedCta(engagement, new Date('2026-10-01T00:00:00Z')));
});

test('structural CTA validation is deterministic without a wall-clock freshness check', () => {
  assert.doesNotThrow(() => validateApprovedCta(draft()));
});
