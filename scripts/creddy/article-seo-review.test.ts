import assert from 'node:assert/strict';
import test from 'node:test';

import { reviewCreddyArticleSeo } from './article-seo-review.js';
import type { CreddyArticleDraft, CreddyArticleVisualPlan } from './pipeline-types.js';

function article(): CreddyArticleDraft {
  return {
    version: 'creddy-article-v1', designVersion: 'creddy-guides-v1', id: 'article-benefit-reset',
    slug: 'credit-card-benefit-reset-guide', category: 'benefits',
    title: 'How Credit Card Benefit Resets Work',
    dek: 'Understand a benefit reset before relying on the value.',
    excerpt: 'A practical guide to credit card benefit reset timing and decisions.',
    seoTitle: 'How Credit Card Benefit Resets Work — Creddy',
    seoDescription: 'Learn how credit card benefit resets work, when the value renews, and what to verify before relying on a benefit in your budget.',
    authorName: 'Creddy Editorial', createdAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-09-01T00:00:00.000Z',
    readingMinutes: 6, heroVisualId: 'hero-reset', sourceUrls: ['https://example.com/terms'],
    referralDisclosure: 'Advertiser disclosure.',
    blocks: [
      { id: 'hero', type: 'visual', visualId: 'hero-reset', caption: 'A benefit reset calendar.' },
      { id: 'clock-heading', type: 'heading', level: 2, text: 'Understand the benefit reset clock' },
      { id: 'clock-copy', type: 'paragraph', text: 'A credit card benefit reset determines when the next benefit period begins and which terms need confirmation.', claimFields: [] },
      { id: 'decision-heading', type: 'heading', level: 2, text: 'Verify the timing before deciding' },
      { id: 'decision-copy', type: 'paragraph', text: 'Compare the usable value with the card cost and your normal spending.', claimFields: [] },
    ],
  };
}

function visuals(): CreddyArticleVisualPlan {
  return {
    version: 'creddy-article-visuals-v1', designVersion: 'creddy-guides-v1', imageBlockStyle: 'creddy-abstract-editorial-v1',
    assets: ['hero-reset', 'reset-detail', 'reset-decision'].map((id, index) => ({
      id, usage: index === 0 ? 'hero' as const : 'inline' as const,
      articleBlockId: index === 0 ? 'hero' : index === 1 ? 'clock-heading' : 'decision-heading',
      assetType: 'editorial_illustration' as const, aspectRatio: '16:9' as const, generationMode: 'generate' as const,
      altText: `Editorial calendar showing benefit reset step ${index + 1}`,
      caption: `Benefit reset planning detail ${index + 1}.`, claimFields: [],
    })),
  };
}

test('shared SEO review passes a distinct intent-aligned article and keeps FAQ optional', () => {
  const review = reviewCreddyArticleSeo({ article: article(), visuals: visuals() });
  assert.equal(review.status, 'pass');
  assert.deepEqual(review.hardFailures, []);
  assert.ok(review.warnings.some((warning) => /FAQ/.test(warning)));
  assert.match(review.contentSha256, /^[a-f0-9]{64}$/);
});

test('shared SEO review blocks missing intent alignment and exact portfolio duplicates', () => {
  const value = article();
  value.seoTitle = 'A General Guide to Rewards Decisions';
  const peer = article();
  peer.id = 'article-existing-benefit-reset';
  const review = reviewCreddyArticleSeo({ article: value, peers: [peer] });
  assert.equal(review.status, 'needs_changes');
  assert.ok(review.hardFailures.some((failure) => /primary topic/.test(failure)));
  assert.ok(review.hardFailures.some((failure) => /duplicates article/.test(failure)));
});

test('one generic offer word cannot stand in for the actual card and program topic', () => {
  const value = article();
  value.title = 'Chase Business Offers';
  value.seoTitle = 'Business Offers and Rewards Decisions — Creddy';
  value.seoDescription = 'Review business offers, compare the important terms, and verify the practical value before making a rewards card decision today.';
  value.blocks[1] = { id: 'offer-heading', type: 'heading', level: 2, text: 'Understand the business offers available' };
  value.blocks[2] = { id: 'offer-copy', type: 'paragraph', text: 'Business offers should be compared by usable value and timing.', claimFields: [] };
  const review = reviewCreddyArticleSeo({ article: value });
  assert.ok(review.hardFailures.some((failure) => /primary topic/.test(failure)));
});

test('comparison and volatile title promises require a table and visible checked date', () => {
  const value = article();
  value.title = 'Compare Current Credit Card Benefit Offers';
  value.seoTitle = 'Compare Current Credit Card Benefit Offers';
  value.seoDescription = 'Compare current credit card benefit offers, understand the reset timing, and verify the usable value before choosing a card.';
  const review = reviewCreddyArticleSeo({ article: value });
  assert.ok(review.hardFailures.some((failure) => /comparison table/.test(failure)));
  assert.ok(review.hardFailures.some((failure) => /Last checked/.test(failure)));
});

test('capitalized freshness labels pass while evergreen bonus explainers need no artificial date', () => {
  const current = article();
  current.title = 'Current Benefit Reset Promotion';
  current.category = 'loyalty_news';
  current.seoTitle = 'Current Benefit Reset Promotion — Creddy';
  current.seoDescription = 'Review the current benefit reset promotion, understand its timing, and verify the practical value before making a card decision.';
  current.blocks[2] = { id: 'current-copy', type: 'paragraph', text: 'As of September 1, 2026, the current benefit reset promotion requires checking the latest terms.', claimFields: [] };
  const currentReview = reviewCreddyArticleSeo({ article: current });
  assert.equal(currentReview.checks.find((check) => check.id === 'volatile-fact-date')?.status, 'pass');

  const evergreen = article();
  evergreen.title = 'How Transfer Bonuses Work';
  evergreen.seoTitle = 'How Transfer Bonuses Work for Rewards — Creddy';
  evergreen.seoDescription = 'Learn how transfer bonuses work, when a transfer can improve an award, and which tradeoffs to verify before moving rewards points.';
  evergreen.blocks[1] = { id: 'transfer-heading', type: 'heading', level: 2, text: 'Understand how a transfer bonus works' };
  evergreen.blocks[2] = { id: 'transfer-copy', type: 'paragraph', text: 'A transfer bonus can increase the program miles received from a points transfer.', claimFields: [] };
  const evergreenReview = reviewCreddyArticleSeo({ article: evergreen });
  assert.equal(evergreenReview.checks.find((check) => check.id === 'volatile-fact-date')?.status, 'pass');
});

test('article images require distinct descriptive accessibility copy', () => {
  const plan = visuals();
  plan.assets[1]!.altText = plan.assets[0]!.altText;
  const review = reviewCreddyArticleSeo({ article: article(), visuals: plan });
  assert.ok(review.hardFailures.some((failure) => /distinct 16:9 images/.test(failure)));
});
