import {
  CREDDY_TOPIC_SEARCHES,
  getEnabledCreddySources,
  type CreddySourceConfig,
} from './config.js';
import { normalizeArticleUrl } from './article-identity.js';

const EXCLUDED_PATH_SEGMENTS = new Set([
  'about',
  'advertise',
  'author',
  'category',
  'contact',
  'feed',
  'login',
  'newsletter',
  'privacy',
  'search',
  'tag',
  'terms',
  'wp-admin',
  'wp-login.php',
]);

const SOURCE_EXCLUDED_PATHS: Readonly<Record<string, ReadonlySet<string>>> = {
  '10x-travel': new Set(['/creditcards', '/resources', '/start-here']),
  'doctor-of-credit': new Set(['/bank-accounts', '/credit-cards', '/knowledge-base']),
  'frequent-miler': new Set([
    '/about-frequent-miler',
    '/best-credit-card-offers',
    '/best-offers-card-exploration-tool-beta',
    '/frequent-miler-ask-us-anything',
    '/frequent-miler-on-the-air',
    '/contact-frequent-miler',
    '/resources',
    '/start-here',
    '/subscribe',
  ]),
  'one-mile-at-a-time': new Set([
    '/best-credit-cards/travel',
    '/deals',
    '/guides',
    '/guides/best-credit-cards',
    '/insights',
    '/news',
    '/reviews',
  ]),
  'the-points-guy': new Set(['/credit-cards', '/loyalty-programs', '/news']),
  'upgraded-points': new Set(['/advertising-policy', '/credit-card-rating-methodology', '/news']),
};

const NON_ARTICLE_EXTENSIONS = /\.(?:avif|css|gif|ico|jpe?g|js|json|mp3|mp4|pdf|png|svg|webm|webp|xml)$/i;

export interface SourceDiscoveryOperation {
  kind: 'source_listing';
  sourceId: string;
  sourceName: string;
  url: string;
}

export interface TopicSearchOperation {
  kind: 'topic_search';
  query: string;
}

export interface CreddyDiscoveryPlan {
  sourceOperations: SourceDiscoveryOperation[];
  searchOperations: TopicSearchOperation[];
  baselineRequests: number;
}

export function buildCreddyDiscoveryPlan(): CreddyDiscoveryPlan {
  const sourceOperations = getEnabledCreddySources().map((source) => ({
    kind: 'source_listing' as const,
    sourceId: source.id,
    sourceName: source.name,
    url: source.url,
  }));
  const searchOperations = CREDDY_TOPIC_SEARCHES.map((query) => ({
    kind: 'topic_search' as const,
    query,
  }));

  return {
    sourceOperations,
    searchOperations,
    baselineRequests: sourceOperations.length + searchOperations.length,
  };
}

function comparableHost(url: URL): string {
  return url.hostname.toLocaleLowerCase('en-US').replace(/^www\./, '');
}

function isLikelySourceArticle(source: CreddySourceConfig, url: URL): boolean {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const lowerPath = path.toLocaleLowerCase('en-US');
  if (SOURCE_EXCLUDED_PATHS[source.id]?.has(lowerPath)) return false;

  if (source.id === 'awardwallet' && lowerPath.startsWith('/blog/link/')) return false;
  if (source.id === 'the-points-guy') {
    if (lowerPath.startsWith('/lp/') || lowerPath.startsWith('/newsletters/')) return false;
    if (['/cardmatch', '/credit-cards/best', '/tsa'].includes(lowerPath)) return false;
  }
  if (source.id === 'flyertalk') {
    return /^\/forum\/[^/]+\/\d+[^/]*\.html$/i.test(lowerPath);
  }
  if (source.id.startsWith('reddit-')) {
    return /^\/r\/[^/]+\/comments\//i.test(lowerPath);
  }
  return true;
}

/**
 * Keep only likely article URLs belonging to the configured source. This is a
 * pre-scrape cost/safety gate, not the later content relevance classifier.
 */
export function filterSourceArticleLinks(
  source: CreddySourceConfig,
  links: readonly string[],
  limit = 100,
): string[] {
  if (!Number.isInteger(limit) || limit < 1) {
    throw new Error('Discovery link limit must be a positive integer');
  }

  const base = new URL(source.url);
  const baseHost = comparableHost(base);
  const basePath = base.pathname.replace(/\/+$/, '') || '/';
  const accepted = new Set<string>();

  for (const candidate of links) {
    if (accepted.size >= limit) break;
    if (!candidate.trim() || /[\s[\]]/.test(candidate)) continue;

    let resolved: URL;
    try {
      resolved = new URL(candidate, base);
    } catch {
      continue;
    }
    if (!['http:', 'https:'].includes(resolved.protocol)) continue;
    if (comparableHost(resolved) !== baseHost) continue;
    if (NON_ARTICLE_EXTENSIONS.test(resolved.pathname)) continue;

    const pathSegments = resolved.pathname
      .toLocaleLowerCase('en-US')
      .split('/')
      .filter(Boolean);
    if (pathSegments.some((segment) => EXCLUDED_PATH_SEGMENTS.has(segment))) continue;
    if (!isLikelySourceArticle(source, resolved)) continue;

    // A configured section such as AwardWallet /blog/ is a real allowlist.
    if (basePath !== '/' && !resolved.pathname.startsWith(`${basePath}/`)) continue;

    let canonical: string;
    try {
      canonical = normalizeArticleUrl(resolved.toString());
    } catch {
      continue;
    }
    if (canonical === normalizeArticleUrl(base.toString())) continue;
    accepted.add(canonical);
  }

  return [...accepted];
}

function main(): void {
  const plan = buildCreddyDiscoveryPlan();
  console.log(JSON.stringify(plan, null, 2));
  console.log(
    `Plan only: ${plan.sourceOperations.length} source listing requests + ` +
      `${plan.searchOperations.length} topic search requests = ` +
      `${plan.baselineRequests} baseline requests before new-article scrapes.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) main();
