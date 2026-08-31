import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  CREDDY_ARTICLE_DISCLOSURE,
  renderCreddyArticlePreview,
} from './creddy/article-content.js';
import type { CreddyArticleDraft } from './creddy/pipeline-types.js';

const explanatoryParagraph = (lead: string): string => Array.from({ length: 5 }, (_, index) =>
  `${lead} The useful number is the amount you can realistically capture, not merely the largest figure in the marketing headline. Step ${index + 1} is to confirm the current terms, check the reset window, compare the annual fee with benefits you already use, and leave room for eligibility or timing details that can change the decision.`,
).join(' ');

const article: CreddyArticleDraft = {
  version: 'creddy-article-v1',
  designVersion: 'creddy-guides-v1',
  id: 'article-local-design-preview',
  slug: 'how-to-stop-losing-credit-card-benefits',
  category: 'benefits',
  title: 'How to Stop Losing Credit Card Benefits You Already Paid For',
  dek: 'A practical system for understanding reset clocks, valuing benefits honestly, and using the credits that fit your real life.',
  excerpt: 'Learn how to organize recurring card benefits, catch reset deadlines, and decide which credits deserve a place in your wallet.',
  seoTitle: 'Stop Losing Credit Card Benefits — Creddy',
  seoDescription: 'Learn a practical system for tracking credit card benefits, understanding reset schedules, and capturing the value that fits your real spending.',
  authorName: 'Creddy Editorial',
  createdAt: '2026-08-25T00:00:00.000Z',
  updatedAt: '2026-08-25T00:00:00.000Z',
  readingMinutes: 6,
  heroVisualId: 'hero-benefit-calendar',
  sourceUrls: ['https://getcreddy.com/guides/how-statement-credits-reset'],
  referralDisclosure: CREDDY_ARTICLE_DISCLOSURE,
  blocks: [
    { id: 'hero', type: 'visual', visualId: 'hero-benefit-calendar', caption: 'A simple calendar view makes every benefit deadline visible.' },
    { id: 'takeaways', type: 'key_takeaways', title: 'The short version', items: ['Identify the reset clock for every recurring benefit.', 'Value only the credits that match spending you would make anyway.', 'Create reminders before monthly, quarterly, and annual value disappears.'], claimFields: [] },
    { id: 'why-value-disappears', type: 'heading', level: 2, text: 'Why advertised value quietly disappears' },
    { id: 'value-explained', type: 'paragraph', text: explanatoryParagraph('Premium cards often bundle several small credits behind one impressive annual total.'), claimFields: [] },
    { id: 'clock-visual', type: 'visual', visualId: 'inline-reset-clocks', caption: 'Monthly, quarterly, calendar-year, and anniversary clocks need different reminder strategies.' },
    { id: 'three-clocks', type: 'heading', level: 2, text: 'Build a system around the three common reset clocks' },
    { id: 'clock-system', type: 'paragraph', text: explanatoryParagraph('Start by labeling each benefit as monthly, calendar-based, or tied to the card anniversary.'), claimFields: [] },
    { id: 'decision-rule', type: 'callout', tone: 'decision', title: 'A better decision rule', body: 'Count a benefit at full value only when you can use it naturally, on time, without spending extra just to trigger it.', claimFields: [] },
    { id: 'annual-value', type: 'heading', level: 2, text: 'Measure the value your wallet actually captures' },
    { id: 'measurement', type: 'paragraph', text: explanatoryParagraph('Review captured value against the annual fee instead of trusting a theoretical maximum.'), claimFields: [] },
    { id: 'comparison', type: 'comparison_table', caption: 'A practical benefit-tracking rhythm', columns: ['Reset type', 'Best review rhythm', 'Main risk'], rows: [['Monthly', 'Beginning and middle of each month', 'No rollover'], ['Quarterly', 'First week of every quarter', 'Short redemption window'], ['Annual or anniversary', 'Ninety and thirty days before reset', 'Large unused balance']], claimFields: [] },
    { id: 'referral', type: 'referral_card', referralId: 'example-card-registry-id', title: 'Compare the complete benefit package', body: 'Review the annual fee, recurring credits, eligibility, and realistic first-year value before applying.', ctaLabel: 'View approved card details', claimFields: [] },
    { id: 'faq', type: 'faq', items: [{ question: 'Should every credit count at face value?', answer: 'No. Use the value you would willingly pay for the product or service without the card.', claimFields: [] }, { question: 'When should I review my wallet?', answer: 'A short monthly review catches expiring value while leaving enough time to use it naturally.', claimFields: [] }] },
    { id: 'subscribe', type: 'subscribe', title: 'Get practical card-benefit guides', body: 'Receive plain-English updates that help you understand changes before they cost you value.', consentLabel: 'I agree to receive Creddy editorial emails and can unsubscribe at any time.' },
    { id: 'download', type: 'download', title: 'Keep every reset date in one place', body: 'Use Creddy to track card benefits, welcome-offer progress, and value before it expires.', iosUrl: 'https://apps.apple.com/app/id6768603911?ct=web_discovery', androidUrl: 'https://play.google.com/store/apps/details?id=com.thebrewapps.creddy' },
  ],
};

const output = resolve(process.argv[2] || 'artifacts/creddy-article-preview.html');
await mkdir(dirname(output), { recursive: true });
await writeFile(output, renderCreddyArticlePreview(article));
console.log(output);
