import { createHash } from 'node:crypto';

const TRACKING_PARAMETER_NAMES = new Set([
  '_ga',
  '_gl',
  'fbclid',
  'gclid',
  'igshid',
  'mc_cid',
  'mc_eid',
  'msclkid',
]);

export type ArticleChange = 'new_url' | 'unchanged' | 'content_changed';

export interface StoredArticleIdentity {
  canonicalUrl: string;
  contentHash: string;
}

export interface ArticleIdentity {
  canonicalUrl: string;
  contentHash: string;
  titleFingerprint: string;
}

function isTrackingParameter(name: string): boolean {
  const normalized = name.toLocaleLowerCase('en-US');
  return normalized.startsWith('utm_') || TRACKING_PARAMETER_NAMES.has(normalized);
}

/**
 * Produce a stable comparison URL without discarding content-selection query
 * parameters. This is deliberately conservative: it removes known tracking
 * values but retains every parameter whose meaning is unknown.
 */
export function normalizeArticleUrl(input: string): string {
  const url = new URL(input.trim());
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Unsupported article protocol: ${url.protocol}`);
  }
  if (url.username || url.password) {
    throw new Error('Article URLs must not contain credentials');
  }

  url.protocol = 'https:';
  url.hostname = url.hostname.toLocaleLowerCase('en-US').replace(/^www\./, '');
  url.port = '';
  url.hash = '';

  const retainedParameters = [...url.searchParams.entries()]
    .filter(([name]) => !isTrackingParameter(name))
    .sort(([leftName, leftValue], [rightName, rightValue]) =>
      leftName === rightName
        ? leftValue.localeCompare(rightValue, 'en-US')
        : leftName.localeCompare(rightName, 'en-US'),
    );
  url.search = '';
  for (const [name, parameterValue] of retainedParameters) {
    url.searchParams.append(name, parameterValue);
  }

  url.pathname = url.pathname.replace(/\/{2,}/g, '/');
  if (url.pathname !== '/') url.pathname = url.pathname.replace(/\/+$/, '');

  return url.toString();
}

/** Hash normalized extracted text, not provider response JSON or page HTML. */
export function hashArticleContent(content: string): string {
  const normalized = content.replace(/\r\n?/g, '\n').replace(/[ \t]+/g, ' ').trim();
  return createHash('sha256').update(normalized, 'utf8').digest('hex');
}

/** Cheap exact-title gate used before semantic clustering. */
export function fingerprintArticleTitle(title: string): string {
  return title
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function buildArticleIdentity(input: {
  url: string;
  content: string;
  title?: string;
}): ArticleIdentity {
  return {
    canonicalUrl: normalizeArticleUrl(input.url),
    contentHash: hashArticleContent(input.content),
    titleFingerprint: fingerprintArticleTitle(input.title ?? ''),
  };
}

export function classifyArticleChange(
  incoming: ArticleIdentity,
  stored: StoredArticleIdentity | undefined,
): ArticleChange {
  if (!stored || stored.canonicalUrl !== incoming.canonicalUrl) return 'new_url';
  return stored.contentHash === incoming.contentHash ? 'unchanged' : 'content_changed';
}
