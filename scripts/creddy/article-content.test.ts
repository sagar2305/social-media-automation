import assert from 'node:assert/strict';
import test from 'node:test';

import {
  CREDDY_ARTICLE_DISCLOSURE,
  articleWordCount,
  renderCreddyArticlePreview,
  validateCreddyArticle,
  validateCreddyArticleVisuals,
} from './article-content.js';
import type { CreddyArticleDraft, CreddyArticleVisualPlan, CreddyClaim } from './pipeline-types.js';

const source = 'https://example.com/verified-benefit';
const claims: CreddyClaim[] = [
  { field: 'benefitValue', value: '$200', sourceRecordIds: ['source-1'], confidence: 95 },
  { field: 'resetSchedule', value: 'calendar year', sourceRecordIds: ['source-1'], confidence: 92 },
];

function longParagraph(prefix: string): string {
  const sentence = `${prefix} Cardholders should confirm the current terms, understand the reset window, compare the cost with value they can realistically use, and make a decision based on their own wallet rather than a headline number.`;
  return Array.from({ length: 12 }, () => sentence).join(' ');
}

function article(): CreddyArticleDraft {
  return {
    version: 'creddy-article-v1',
    designVersion: 'creddy-guides-v1',
    id: 'article-decision-1',
    slug: 'how-a-card-benefit-reset-works',
    category: 'benefits',
    title: 'How This Credit Card Benefit Reset Actually Works',
    dek: 'A plain-English guide to the reset clock, the real value, and the decision to make before the benefit expires.',
    excerpt: 'Understand the reset schedule, practical value, and limitations before counting the benefit at its full advertised amount.',
    seoTitle: 'How a Credit Card Benefit Reset Works — Creddy',
    seoDescription: 'Learn how this credit card benefit resets, what the published value means in practice, and which details to verify before relying on it.',
    authorName: 'Creddy Editorial',
    createdAt: '2026-08-25T00:00:00.000Z',
    updatedAt: '2026-08-25T00:00:00.000Z',
    readingMinutes: 6,
    heroVisualId: 'hero-reset-clock',
    sourceUrls: [source],
    referralDisclosure: CREDDY_ARTICLE_DISCLOSURE,
    blocks: [
      { id: 'hero-visual', type: 'visual', visualId: 'hero-reset-clock', caption: 'A clear view of the benefit reset cycle.' },
      { id: 'takeaways', type: 'key_takeaways', title: 'What to know', items: ['The published value is $200.', 'The benefit follows a calendar-year reset.'], claimFields: ['benefitValue', 'resetSchedule'] },
      { id: 'reset-heading', type: 'heading', level: 2, text: 'Start with the reset clock' },
      { id: 'reset-body', type: 'paragraph', text: longParagraph('The benefit follows a calendar-year schedule.'), claimFields: ['resetSchedule'] },
      { id: 'clock-visual', type: 'visual', visualId: 'inline-reset-clock', caption: 'The calendar-year window from opening to expiration.' },
      { id: 'value-heading', type: 'heading', level: 2, text: 'Decide what the value means for you' },
      { id: 'value-body', type: 'paragraph', text: longParagraph('The published benefit value is $200.'), claimFields: ['benefitValue'] },
      { id: 'value-chart', type: 'visual', visualId: 'comparison-value', caption: 'A comparison between published and realistically usable value.' },
      { id: 'decision', type: 'callout', tone: 'decision', title: 'The practical decision', body: 'Count only the portion you can use naturally and verify the current terms before applying.', claimFields: ['benefitValue', 'resetSchedule'] },
      { id: 'faq', type: 'faq', items: [{ question: 'Does unused value roll over?', answer: 'Verify the current terms because the accepted evidence establishes the reset schedule, not a rollover promise.', claimFields: ['resetSchedule'] }] },
      { id: 'subscribe', type: 'subscribe', title: 'Get practical Creddy guides', body: 'Receive plain-English card-benefit updates and decision guides.', consentLabel: 'I agree to receive Creddy editorial emails and can unsubscribe at any time.' },
      { id: 'download', type: 'download', title: 'Track benefits before they reset', body: 'Use Creddy to keep benefit timing visible in one place.', iosUrl: 'https://apps.apple.com/app/id6768603911?ct=web_discovery', androidUrl: 'https://play.google.com/store/apps/details?id=com.thebrewapps.creddy' },
    ],
  };
}

function visuals(): CreddyArticleVisualPlan {
  const generated = (id: string, usage: 'hero' | 'inline' | 'comparison', articleBlockId: string, aspectRatio: '16:9' | '4:3') => ({
    id, usage, articleBlockId, assetType: 'editorial_illustration' as const, aspectRatio,
    generationMode: 'generate' as const,
    seriesStyle: 'Premium tactile editorial still-life series using warm cream paper, restrained brushed gold accents, soft left-side window light, a natural 50mm perspective, subtle grain, realistic imperfections, and calm medium contrast.',
    prompt: 'Premium editorial still life using warm cream paper, a restrained gold circular calendar motif, natural window light, tactile materials, subtle depth, realistic imperfections, and generous negative space for HTML copy.',
    negativePrompt: 'No text, no logos, no watermarks, no fake credit cards, no app screens, no people, no distorted objects.',
    altText: 'Gold calendar markers arranged around a warm cream planning surface',
    caption: 'A visual explanation of the benefit reset cycle.',
    claimFields: ['resetSchedule'],
  });
  return {
    version: 'creddy-article-visuals-v1',
    designVersion: 'creddy-guides-v1',
    assets: [
      generated('hero-reset-clock', 'hero', 'hero-visual', '16:9'),
      generated('inline-reset-clock', 'inline', 'clock-visual', '4:3'),
      generated('comparison-value', 'comparison', 'value-chart', '4:3'),
    ],
  };
}

test('validates and renders the unified Creddy website article', () => {
  const value = article();
  assert.ok(articleWordCount(value) >= 650);
  assert.equal(validateCreddyArticle(value, claims, [source]), value);
  assert.equal(validateCreddyArticleVisuals(visuals(), value, claims).assets.length, 3);
  const html = renderCreddyArticlePreview(value, {
    'hero-reset-clock': { src: 'assets/hero-reset-clock.png', altText: 'Calendar markers on a planning desk' },
  });
  assert.match(html, /#FBFAF7/i);
  assert.match(html, /Get practical Creddy guides/);
  assert.match(html, /Download on the/);
  assert.match(html, /App Store/);
  assert.match(html, /class="app-store-icon"/);
  assert.match(html, /Get it on/);
  assert.match(html, /Google Play/);
  assert.match(html, /data-download-article/);
  assert.match(html, /how-a-card-benefit-reset-works\.html/);
  assert.match(html, /Advertiser disclosure/);
  assert.match(html, /<img src="assets\/hero-reset-clock\.png" alt="Calendar markers on a planning desk"/);
  assert.match(html, /Visual · inline-reset-clock/);
  assert.match(html, /width:min\(100%,1440px\)/);
  assert.match(html, /@media\(min-width:701px\)\{header,main,footer\{width:100%;max-width:none/);
  assert.match(html, /\.hero,\.article,\.article>p,\.article>h2,\.article>h3,\.faq,\.takeaways,\.callout,\.sources\{width:100%;max-width:none\}/);
  assert.match(html, /@media\(max-width:700px\)\{header,main,footer\{padding-inline:16px\}/);
  assert.match(html, /\.store-buttons\{grid-template-columns:1fr\}/);
  assert.match(html, /figure\{margin-inline:0\}/);
  assert.match(html, /class="visual-frame"/);
  assert.doesNotMatch(html, /Creddy visual guide/);
  assert.match(html, /width:min\(100%,900px\)/);
  assert.match(html, /aspect-ratio:16\/9/);
  assert.match(html, /class="visual-ornaments" aria-hidden="true"/);
  assert.match(html, /ornament-dollar/);
  assert.match(html, /@media\(max-width:1100px\)\{\.visual \.visual-ornaments\{display:none\}\}/);
});

test('requires one identical art direction across pending generated article images', () => {
  const inconsistent = visuals();
  inconsistent.assets[1]!.seriesStyle = 'A completely different glossy neon 3D render series with saturated purple lighting, plastic materials, extreme contrast, and an ultra-wide synthetic camera perspective.';
  assert.throws(
    () => validateCreddyArticleVisuals(inconsistent, article(), claims),
    /same seriesStyle/,
  );
});

test('rejects missing subscription and unsafe generated visual requests', () => {
  const missingSubscribe = article();
  missingSubscribe.blocks = missingSubscribe.blocks.filter((block) => block.type !== 'subscribe');
  assert.throws(() => validateCreddyArticle(missingSubscribe, claims, [source]), /subscribe/);

  const unsafe = visuals();
  unsafe.assets[0]!.prompt = 'Create a realistic bank logo and credit card design with headline text inside the image for this article.';
  assert.throws(() => validateCreddyArticleVisuals(unsafe, article(), claims), /prohibited/);
});
