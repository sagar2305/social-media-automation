import { createHash } from 'node:crypto';
import { dirname } from 'node:path';

import { listJsonFiles, readJson, safeDataPath, writeJsonAtomic } from './pipeline-store.js';
import type {
  ContentDraftRecord,
  ContentBankRecord,
  CreddyArticleDraft,
  CreddyArticleVisualPlan,
  CreddyVerificationGate,
} from './pipeline-types.js';

export const CREDDY_ARTICLE_SEO_REVIEW_VERSION = 1 as const;

export type CreddyArticleSeoCheck = {
  id: string;
  status: 'pass' | 'fail' | 'warning';
  message: string;
};

export type CreddyArticleSeoReview = {
  version: typeof CREDDY_ARTICLE_SEO_REVIEW_VERSION;
  status: 'pass' | 'needs_changes';
  contentSha256: string;
  checks: CreddyArticleSeoCheck[];
  hardFailures: string[];
  warnings: string[];
};

export type CreddyArticleSeoPeer = Pick<CreddyArticleDraft, 'id' | 'seoTitle' | 'seoDescription' | 'blocks'>;

const TOPIC_STOP_WORDS = new Set([
  'about', 'after', 'before', 'benefit', 'benefits', 'bonus', 'bonuses', 'card',
  'cards', 'credit', 'from', 'guide', 'into', 'mile', 'miles', 'offer', 'offers',
  'point', 'points', 'reward', 'rewards', 'that', 'their', 'this', 'what', 'when', 'where', 'which', 'with',
  'work', 'works', 'your',
]);
const DIRECT_VOLATILE_TITLE = /\b(?:current|deadline|promotion|promo|limited|20\d{2}|january|february|march|april|may|june|july|august|september|october|november|december)\b/i;
const NEWS_VOLATILE_TITLE = /\b(?:offer|offers|bonus|bonuses|change|changes)\b/i;
const VISIBLE_DATE = /\b(?:as of|last checked|updated)\s+(?:[a-z]+\s+\d{1,2},\s+20\d{2}|20\d{2}-\d{2}-\d{2})\b/i;
const PROHIBITED_CLICKBAIT = /\b(?:you won['’]?t believe|secret|hack|game[ -]?changer)\b|[!?]{2,}/i;

function normalize(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim().replace(/\s+/g, ' ');
}

function intentTerms(value: string): string[] {
  return normalize(value).split(' ').map((term) =>
    term.length > 4 && term.endsWith('s') && !term.endsWith('ss') && !term.endsWith('us')
      ? term.slice(0, -1)
      : term,
  );
}

function topicTerms(title: string): Set<string> {
  return new Set(intentTerms(title).filter((term) => term.length >= 4 && !TOPIC_STOP_WORDS.has(term)));
}

function overlaps(topic: Set<string>, value: string): boolean {
  const candidate = new Set(intentTerms(value));
  const required = Math.min(2, topic.size);
  return [...topic].filter((term) => candidate.has(term)).length >= required;
}

function h2s(article: Pick<CreddyArticleDraft, 'blocks'>): string[] {
  return article.blocks.flatMap((block) => block.type === 'heading' && block.level === 2 ? [block.text] : []);
}

function firstParagraph(article: CreddyArticleDraft): string {
  for (const block of article.blocks) {
    if (block.type === 'paragraph') return block.text;
  }
  return '';
}

function visibleText(article: CreddyArticleDraft): string {
  return [article.title, article.dek, article.excerpt, ...article.blocks.flatMap((block) => {
    switch (block.type) {
      case 'paragraph': return [block.text];
      case 'heading': return [block.text];
      case 'key_takeaways': return [block.title, ...block.items];
      case 'callout': return [block.title, block.body];
      case 'comparison_table': return [block.caption, ...block.columns, ...block.rows.flat()];
      case 'visual': return [block.caption];
      case 'referral_card': return [block.title, block.body, block.ctaLabel];
      case 'faq': return block.items.flatMap((item) => [item.question, item.answer]);
      case 'subscribe': return [block.title, block.body];
      case 'download': return [block.title, block.body];
    }
  })].join(' ');
}

function add(
  checks: CreddyArticleSeoCheck[],
  id: string,
  status: CreddyArticleSeoCheck['status'],
  message: string,
): void {
  checks.push({ id, status, message });
}

export function articleSeoContentSha256(
  article: CreddyArticleDraft,
  visuals?: CreddyArticleVisualPlan,
): string {
  const auditedVisuals = visuals ? {
    version: visuals.version,
    designVersion: visuals.designVersion,
    imageBlockStyle: visuals.imageBlockStyle,
    assets: visuals.assets.map((asset) => ({
      id: asset.id,
      usage: asset.usage,
      articleBlockId: asset.articleBlockId,
      aspectRatio: asset.aspectRatio,
      altText: asset.altText,
      caption: asset.caption,
    })),
  } : null;
  return createHash('sha256').update(JSON.stringify({ article, visuals: auditedVisuals })).digest('hex');
}

export async function loadCreddyArticleSeoPeers(
  root: string,
  excludedArticleId?: string,
  analysisBatchId?: string,
): Promise<CreddyArticleSeoPeer[]> {
  const draftsDirectory = safeDataPath(root, '06-content-drafts');
  const paths = (await listJsonFiles(draftsDirectory)).filter((path) => dirname(path) === draftsDirectory);
  const activeDraftIds = new Set<string>();
  for (const directory of ['09-pending-approval', '10-approved', '11-scheduled', '12-published']) {
    for (const bankPath of await listJsonFiles(safeDataPath(root, directory))) {
      const bank = await readJson<ContentBankRecord>(bankPath);
      if (bank.contentDraftId && bank.status !== 'rejected' && bank.articleReview?.status !== 'unpublished') {
        activeDraftIds.add(bank.contentDraftId);
      }
    }
  }
  const peers: CreddyArticleSeoPeer[] = [];
  for (const path of paths) {
    const draft = await readJson<ContentDraftRecord>(path);
    const currentBatch = Boolean(analysisBatchId && draft.analysisBatchId === analysisBatchId);
    if (draft.article && draft.article.id !== excludedArticleId && (currentBatch || activeDraftIds.has(draft.id))) {
      peers.push(draft.article);
    }
  }
  return peers;
}

export function reviewCreddyArticleSeo(options: {
  article: CreddyArticleDraft;
  peers?: CreddyArticleSeoPeer[];
  visuals?: CreddyArticleVisualPlan;
  verificationGate?: CreddyVerificationGate;
}): CreddyArticleSeoReview {
  const { article, visuals, verificationGate } = options;
  const peers = (options.peers ?? []).filter((peer) => peer.id !== article.id);
  const checks: CreddyArticleSeoCheck[] = [];
  const topic = topicTerms(article.title);
  const articleH2s = h2s(article);
  const normalizedH2s = articleH2s.map(normalize);

  add(checks, 'seo-title-length', article.seoTitle.length >= 30 && article.seoTitle.length <= 65 ? 'pass' : 'fail',
    'SEO title must be 30–65 characters.');
  add(checks, 'seo-description-length', article.seoDescription.length >= 110 && article.seoDescription.length <= 160 ? 'pass' : 'fail',
    'SEO description must be 110–160 characters.');

  const aligned = topic.size > 0 &&
    overlaps(topic, article.seoTitle) &&
    overlaps(topic, article.seoDescription) &&
    overlaps(topic, firstParagraph(article)) &&
    articleH2s.some((heading) => overlaps(topic, heading));
  add(checks, 'search-intent-alignment', aligned ? 'pass' : 'fail',
    'The primary topic must appear in the SEO title, description, first substantive paragraph, and at least one H2.');

  const meaningfulH2s = articleH2s.length >= 2 && new Set(normalizedH2s).size === articleH2s.length &&
    articleH2s.every((heading) => normalize(heading).split(' ').length >= 3);
  add(checks, 'meaningful-h2-outline', meaningfulH2s ? 'pass' : 'fail',
    'Use at least two distinct, descriptive H2 headings.');

  const comparisonPromise = /\b(?:compare|comparison|versus|vs\.?)(?:\b|$)/i.test(article.title);
  const hasComparison = article.blocks.some((block) => block.type === 'comparison_table');
  add(checks, 'title-promise', !comparisonPromise || hasComparison ? 'pass' : 'fail',
    'A comparison title must include a useful comparison table.');

  const volatile = DIRECT_VOLATILE_TITLE.test(article.title) ||
    (['card_offers', 'loyalty_news'].includes(article.category) && NEWS_VOLATILE_TITLE.test(article.title));
  add(checks, 'volatile-fact-date', !volatile || VISIBLE_DATE.test(visibleText(article)) ? 'pass' : 'fail',
    'Current offers, bonuses, deadlines, and dated news must show an “As of” or “Last checked” date in the article.');

  add(checks, 'responsible-headline', PROHIBITED_CLICKBAIT.test(article.title) || PROHIBITED_CLICKBAIT.test(article.seoTitle) ? 'fail' : 'pass',
    'Titles must avoid prohibited clickbait and repeated punctuation.');

  const seoTitle = normalize(article.seoTitle);
  const seoDescription = normalize(article.seoDescription);
  const outline = normalizedH2s.join('|');
  const duplicate = peers.find((peer) =>
    normalize(peer.seoTitle) === seoTitle ||
    normalize(peer.seoDescription) === seoDescription ||
    h2s(peer).map(normalize).join('|') === outline,
  );
  add(checks, 'portfolio-uniqueness', duplicate ? 'fail' : 'pass', duplicate
    ? `SEO metadata or H2 outline exactly duplicates article ${duplicate.id}.`
    : 'SEO metadata and H2 outline are distinct from the active article corpus.');

  if (visuals) {
    const alt = visuals.assets.map((asset) => normalize(asset.altText));
    const captions = visuals.assets.map((asset) => normalize(asset.caption));
    const validVisuals = visuals.assets.length === 3 &&
      new Set(alt).size === alt.length && new Set(captions).size === captions.length &&
      visuals.assets.every((asset) => asset.aspectRatio === '16:9' && asset.altText.trim().length >= 20 && asset.caption.trim().length >= 12) &&
      visuals.assets.some((asset) => asset.id === article.heroVisualId && asset.usage === 'hero');
    add(checks, 'accessible-article-images', validVisuals ? 'pass' : 'fail',
      'Use exactly three distinct 16:9 images with a matching hero, descriptive alt text, and distinct captions.');
  }

  if (!article.blocks.some((block) => block.type === 'faq')) {
    add(checks, 'faq-opportunity', 'warning', 'Consider an FAQ only when it answers real follow-up search intent; boilerplate is not required.');
  }
  if (articleH2s.length < 3) {
    add(checks, 'outline-depth', 'warning', 'Consider a third descriptive H2 if the topic needs more depth.');
  }
  if (article.blocks.some((block) => block.type === 'paragraph' && block.text.split(/\s+/).length > 220)) {
    add(checks, 'paragraph-length', 'warning', 'Break up very long paragraphs for mobile readability.');
  }
  if (verificationGate && verificationGate.official.status !== 'verified') {
    add(checks, 'primary-verification', 'warning',
      `Official verification is ${verificationGate.official.status}; retain cautious wording and the existing manual-review policy.`);
  }

  const hardFailures = checks.filter((check) => check.status === 'fail').map((check) => check.message);
  const warnings = checks.filter((check) => check.status === 'warning').map((check) => check.message);
  return {
    version: CREDDY_ARTICLE_SEO_REVIEW_VERSION,
    status: hardFailures.length ? 'needs_changes' : 'pass',
    contentSha256: articleSeoContentSha256(article, visuals),
    checks,
    hardFailures,
    warnings,
  };
}

export function assertCreddyArticleSeo(review: CreddyArticleSeoReview): void {
  if (review.hardFailures.length) {
    throw new Error(`Article SEO review failed: ${review.hardFailures.join(' ')}`);
  }
}

export async function persistCreddyArticleSeoReview(options: {
  root: string;
  contentBankId: string;
  revision: number;
  checkedAt: Date;
  article: CreddyArticleDraft;
  visuals?: CreddyArticleVisualPlan;
  verificationGate?: CreddyVerificationGate;
}): Promise<{
  review: CreddyArticleSeoReview;
  summary: {
    status: CreddyArticleSeoReview['status'];
    reviewedAt: string;
    reportPath: string;
    contentSha256: string;
    warnings: string[];
  };
}> {
  const review = reviewCreddyArticleSeo({
    article: options.article,
    visuals: options.visuals,
    peers: await loadCreddyArticleSeoPeers(options.root, options.article.id),
    verificationGate: options.verificationGate,
  });
  const reviewedAt = options.checkedAt.toISOString();
  const checkedAtSlug = reviewedAt.replace(/[^0-9A-Za-z]+/g, '').slice(0, 24);
  const reportPath = safeDataPath(
    options.root,
    'reports',
    'blog-seo-reviews',
    `${options.contentBankId}-revision-${options.revision}-${checkedAtSlug}-${review.contentSha256.slice(0, 12)}.json`,
  );
  await writeJsonAtomic(reportPath, {
    ...review,
    contentBankId: options.contentBankId,
    revision: options.revision,
    checkedAt: reviewedAt,
    stage: 'agent_7_review',
  });
  return {
    review,
    summary: {
      status: review.status,
      reviewedAt,
      reportPath,
      contentSha256: review.contentSha256,
      warnings: review.warnings,
    },
  };
}
