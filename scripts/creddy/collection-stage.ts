import { createHash } from 'node:crypto';

import { buildArticleIdentity, normalizeArticleUrl } from './article-identity.js';
import {
  CREDDY_CAMPAIGN_SLUG,
  CREDDY_SOURCES,
  CREDDY_TOPIC_SEARCHES,
  getEnabledCreddySources,
  type CreddySourceConfig,
} from './config.js';
import { filterSourceArticleLinks } from './discovery-planner.js';
import { selectDiscoveryCandidates } from './discovery-selection.js';
import { FirecrawlClient } from './firecrawl-client.js';
import { fetchRedditRss } from './reddit-rss-client.js';
import {
  createRunId,
  initializeCreddyDataRoot,
  listJsonFiles,
  readJson,
  runDate,
  safeDataPath,
  withStageLock,
  writeJsonAtomic,
  writeRunManifest,
} from './pipeline-store.js';
import {
  CREDDY_PIPELINE_VERSION,
  type DiscoveryCandidateRecord,
  type DiscoveryRunRecord,
  type PipelineRunManifest,
  type RawArticleRecord,
  type SourceCollectionResult,
  type TopicSearchCollectionResult,
} from './pipeline-types.js';
import { fetchYouTubeFeed } from './youtube-feed-client.js';

interface UrlIndexEntry {
  lastFetchedAt: string;
  lastContentHash: string;
  lastRecordId: string;
}

type UrlIndex = Record<string, UrlIndexEntry>;

export interface CollectionStageOptions {
  root: string;
  client: FirecrawlClient;
  now?: Date;
  maxLinksPerSource?: number;
  maxArticleScrapes?: number;
  recheckAfterHours?: number;
  redditFetchImpl?: typeof fetch;
  youtubeFetchImpl?: typeof fetch;
  onProgress?: (event: CollectionProgressEvent) => void;
}

export interface CollectionProgressEvent {
  phase:
    | 'run_started'
    | 'source_started'
    | 'source_completed'
    | 'source_failed'
    | 'search_started'
    | 'search_completed'
    | 'search_failed'
    | 'queue_ready'
    | 'article_started'
    | 'article_stored'
    | 'article_skipped'
    | 'article_failed'
    | 'run_completed';
  message: string;
  completed?: number;
  total?: number;
}

interface DiscoveredCandidate {
  url: string;
  source: CreddySourceConfig | null;
  searchQuery?: string;
  discoveredTitle?: string;
  discoveredDescription?: string;
  prefetchedMarkdown?: string;
  publishedAt?: string;
  providerMetadata?: Record<string, unknown>;
  laneId: string;
}

function listingTitles(markdown: string | undefined, baseUrl: string): Map<string, string> {
  const titles = new Map<string, string>();
  if (!markdown) return titles;
  const links = markdown.matchAll(/\[([^\]]+)]\(([^\s)]+)(?:\s+"[^"]*")?\)/g);
  for (const match of links) {
    try {
      const title = match[1].replace(/!\[[^\]]*]\([^)]*\)/g, '').trim();
      if (!title || title.length > 300) continue;
      const canonical = normalizeArticleUrl(new URL(match[2], baseUrl).toString());
      if (!titles.has(canonical)) titles.set(canonical, title);
    } catch {
      // Ignore malformed listing links; the canonical link filter owns URL safety.
    }
  }
  return titles;
}

function recordId(canonicalUrl: string, contentHash: string): string {
  return createHash('sha256')
    .update(`${canonicalUrl}\n${contentHash}`)
    .digest('hex')
    .slice(0, 24);
}

export function sourceForUrl(url: string): CreddySourceConfig | null {
  const host = new URL(url).hostname.replace(/^www\./, '').toLocaleLowerCase('en-US');
  return (
    CREDDY_SOURCES.find(
      (source) =>
        source.sourceClass !== 'creator_signal' &&
        new URL(source.url).hostname.replace(/^www\./, '').toLocaleLowerCase('en-US') ===
        host,
    ) ?? null
  );
}

function shouldRecheck(entry: UrlIndexEntry | undefined, now: Date, hours: number): boolean {
  if (!entry) return true;
  const fetchedAt = Date.parse(entry.lastFetchedAt);
  return !Number.isFinite(fetchedAt) || now.getTime() - fetchedAt >= hours * 60 * 60 * 1000;
}

async function loadUrlIndex(root: string): Promise<UrlIndex> {
  const path = safeDataPath(root, 'indexes', 'url-index.json');
  try {
    return await readJson<UrlIndex>(path);
  } catch {
    return {};
  }
}

export async function runCollectionStage(
  options: CollectionStageOptions,
): Promise<PipelineRunManifest> {
  const progress = (event: CollectionProgressEvent): void => {
    try {
      options.onProgress?.(event);
    } catch {
      // Observability must never stop collection.
    }
  };
  const now = options.now ?? new Date();
  const maxLinksPerSource = options.maxLinksPerSource ?? 10;
  const maxArticleScrapes = options.maxArticleScrapes ?? 40;
  const recheckAfterHours = options.recheckAfterHours ?? 24;
  if (maxArticleScrapes < 1) throw new Error('maxArticleScrapes must be positive');

  await initializeCreddyDataRoot(options.root);
  return withStageLock(options.root, 'collection', async () => {
    const runId = createRunId(now);
    const manifest: PipelineRunManifest = {
      version: CREDDY_PIPELINE_VERSION,
      runId,
      campaignSlug: CREDDY_CAMPAIGN_SLUG,
      stage: 'collection',
      status: 'running',
      startedAt: now.toISOString(),
      inputCount: 0,
      outputCount: 0,
      skippedCount: 0,
      failedCount: 0,
      errors: [],
    };
    await writeRunManifest(options.root, manifest);
    progress({
      phase: 'run_started',
      message: `Agent 01 started run ${runId}; collecting ${getEnabledCreddySources().length} sources and ${CREDDY_TOPIC_SEARCHES.length} topic searches.`,
    });

    const candidates = new Map<string, DiscoveredCandidate>();
    const sourceResults: SourceCollectionResult[] = [];
    let lastRedditRequestAt = 0;
    const enabledSources = getEnabledCreddySources();
    for (const [sourceIndex, source] of enabledSources.entries()) {
      progress({
        phase: 'source_started',
        message: `Source ${sourceIndex + 1}/${enabledSources.length}: ${source.name} started.`,
        completed: sourceIndex,
        total: enabledSources.length,
      });
      try {
        if (source.sourceClass === 'creator_signal') {
          const entries = await fetchYouTubeFeed(source, maxLinksPerSource, options.youtubeFetchImpl);
          for (const entry of entries) {
            const canonical = normalizeArticleUrl(entry.url);
            candidates.set(canonical, {
              url: canonical,
              source,
              discoveredTitle: entry.title,
              discoveredDescription: entry.markdown.slice(0, 1_000),
              prefetchedMarkdown: entry.markdown,
              publishedAt: entry.publishedAt,
              providerMetadata: entry.providerMetadata,
              laneId: `source:${source.id}`,
            });
          }
          sourceResults.push({
            sourceId: source.id,
            sourceName: source.name,
            configuredUrl: source.url,
            provider: 'youtube_rss',
            status: 'completed',
            discoveredCount: entries.length,
          });
          progress({
            phase: 'source_completed',
            message: `Source ${sourceIndex + 1}/${enabledSources.length}: ${source.name} completed via YouTube RSS; ${entries.length} videos discovered.`,
            completed: sourceIndex + 1,
            total: enabledSources.length,
          });
          continue;
        }
        if (source.id.startsWith('reddit-')) {
          const redditDelayMs = Math.max(0, 3_000 - (Date.now() - lastRedditRequestAt));
          if (redditDelayMs > 0) await new Promise((resolve) => setTimeout(resolve, redditDelayMs));
          lastRedditRequestAt = Date.now();
          const entries = await fetchRedditRss(source, maxLinksPerSource, options.redditFetchImpl);
          for (const entry of entries) {
            const canonical = normalizeArticleUrl(entry.url);
            candidates.set(canonical, {
              url: canonical,
              source,
              discoveredTitle: entry.title,
              prefetchedMarkdown: entry.markdown,
              publishedAt: entry.publishedAt,
              providerMetadata: { collectionProvider: 'reddit_rss' },
              laneId: `source:${source.id}`,
            });
          }
          sourceResults.push({
            sourceId: source.id,
            sourceName: source.name,
            configuredUrl: source.url,
            provider: 'reddit_rss',
            status: 'completed',
            discoveredCount: entries.length,
          });
          progress({
            phase: 'source_completed',
            message: `Source ${sourceIndex + 1}/${enabledSources.length}: ${source.name} completed via RSS; ${entries.length} entries discovered.`,
            completed: sourceIndex + 1,
            total: enabledSources.length,
          });
          continue;
        }
        const listing = await options.client.scrapePage(source.url);
        const links = filterSourceArticleLinks(
          source,
          listing.links ?? [],
          maxLinksPerSource,
        );
        const discoveredTitles = listingTitles(listing.markdown, source.url);
        for (const link of links) {
          candidates.set(link, {
            url: link,
            source,
            discoveredTitle: discoveredTitles.get(link),
            laneId: `source:${source.id}`,
          });
        }
        sourceResults.push({
          sourceId: source.id,
          sourceName: source.name,
          configuredUrl: source.url,
          provider: 'firecrawl',
          status: 'completed',
          discoveredCount: links.length,
        });
        progress({
          phase: 'source_completed',
          message: `Source ${sourceIndex + 1}/${enabledSources.length}: ${source.name} completed; ${links.length} article links discovered.`,
          completed: sourceIndex + 1,
          total: enabledSources.length,
        });
      } catch (error) {
        const sourceError = (error as Error).message;
        sourceResults.push({
          sourceId: source.id,
          sourceName: source.name,
          configuredUrl: source.url,
          provider: source.sourceClass === 'creator_signal'
            ? 'youtube_rss'
            : source.id.startsWith('reddit-')
              ? 'reddit_rss'
              : 'firecrawl',
          status: 'failed',
          discoveredCount: 0,
          error: sourceError,
        });
        manifest.failedCount += 1;
        manifest.errors.push(`${source.id}: ${sourceError}`);
        progress({
          phase: 'source_failed',
          message: `Source ${sourceIndex + 1}/${enabledSources.length}: ${source.name} failed; warning recorded and collection continues.`,
          completed: sourceIndex + 1,
          total: enabledSources.length,
        });
      }
    }

    const topicSearchResults: TopicSearchCollectionResult[] = [];
    for (const [searchIndex, query] of CREDDY_TOPIC_SEARCHES.entries()) {
      progress({
        phase: 'search_started',
        message: `Topic search ${searchIndex + 1}/${CREDDY_TOPIC_SEARCHES.length}: “${query}” started.`,
        completed: searchIndex,
        total: CREDDY_TOPIC_SEARCHES.length,
      });
      try {
        const results = await options.client.searchNews(query);
        let discoveredCount = 0;
        for (const result of results) {
          let canonical: string;
          try {
            canonical = normalizeArticleUrl(result.url);
          } catch {
            manifest.skippedCount += 1;
            continue;
          }
          if (!candidates.has(canonical)) {
            candidates.set(canonical, {
              url: canonical,
              source: sourceForUrl(canonical),
              searchQuery: query,
              discoveredTitle: result.title,
              discoveredDescription: result.description,
              laneId: `search:${query}`,
            });
            discoveredCount += 1;
          }
        }
        topicSearchResults.push({
          query,
          provider: 'firecrawl',
          status: 'completed',
          discoveredCount,
        });
        progress({
          phase: 'search_completed',
          message: `Topic search ${searchIndex + 1}/${CREDDY_TOPIC_SEARCHES.length}: “${query}” completed; ${discoveredCount} new candidates.`,
          completed: searchIndex + 1,
          total: CREDDY_TOPIC_SEARCHES.length,
        });
      } catch (error) {
        topicSearchResults.push({
          query,
          provider: 'firecrawl',
          status: 'failed',
          discoveredCount: 0,
          error: (error as Error).message,
        });
        manifest.failedCount += 1;
        manifest.errors.push(`search:${query}: ${(error as Error).message}`);
        progress({
          phase: 'search_failed',
          message: `Topic search ${searchIndex + 1}/${CREDDY_TOPIC_SEARCHES.length}: “${query}” failed; warning recorded and collection continues.`,
          completed: searchIndex + 1,
          total: CREDDY_TOPIC_SEARCHES.length,
        });
      }
    }

    manifest.inputCount = candidates.size;
    const index = await loadUrlIndex(options.root);
    const due = [...candidates.values()]
      .filter((candidate) => shouldRecheck(index[candidate.url], now, recheckAfterHours));
    const selection = selectDiscoveryCandidates(due, maxArticleScrapes, now);
    const eligible = selection.selected;
    manifest.skippedCount += candidates.size - eligible.length;
    progress({
      phase: 'queue_ready',
      message: `${candidates.size} unique candidates discovered; ${eligible.length} selected for raw collection in this run.`,
      completed: 0,
      total: eligible.length,
    });

    const eligibleUrls = new Set(eligible.map((candidate) => candidate.url));
    const dueUrls = new Set(due.map((candidate) => candidate.url));
    const discovery: DiscoveryRunRecord = {
      version: CREDDY_PIPELINE_VERSION,
      runId,
      createdAt: now.toISOString(),
      candidateCount: candidates.size,
      scrapeLimit: maxArticleScrapes,
      sourceResults,
      topicSearchResults,
      candidates: [...candidates.values()].map((candidate): DiscoveryCandidateRecord => ({
        url: candidate.url,
        sourceId: candidate.source?.id ?? `topic-search:${candidate.searchQuery ?? 'unknown'}`,
        sourceName: candidate.source?.name ?? `Firecrawl search: ${candidate.searchQuery ?? 'unknown'}`,
        searchQuery: candidate.searchQuery,
        discoveredTitle: candidate.discoveredTitle,
        discoveredDescription: candidate.discoveredDescription,
        discoveryClass: selection.classified.get(candidate.url)?.discoveryClass,
        selectionReason: selection.classified.get(candidate.url)?.reason,
        disposition: eligibleUrls.has(candidate.url)
          ? 'selected_for_scrape'
          : selection.classified.get(candidate.url)?.discoveryClass === 'low_relevance'
            ? 'deferred_low_relevance'
          : dueUrls.has(candidate.url)
            ? 'deferred_capacity'
            : 'recently_checked',
      })),
    };
    const discoveryByUrl = new Map(discovery.candidates.map((candidate) => [candidate.url, candidate]));

    for (const [articleIndex, candidate] of eligible.entries()) {
      const articleLabel = candidate.discoveredTitle || candidate.url;
      progress({
        phase: 'article_started',
        message: `Article ${articleIndex + 1}/${eligible.length}: ${articleLabel} started.`,
        completed: articleIndex,
        total: eligible.length,
      });
      try {
        const page = candidate.prefetchedMarkdown
          ? {
              markdown: candidate.prefetchedMarkdown,
              metadata: candidate.providerMetadata ?? {},
            }
          : await options.client.scrapePage(candidate.url, { maxAgeMs: 15 * 60 * 1000 });
        const markdown = page.markdown?.trim() ?? '';
        if (!markdown) throw new Error('Firecrawl returned empty Markdown');
        const title = String(page.metadata?.title ?? candidate.discoveredTitle ?? '').trim();
        const identity = buildArticleIdentity({ url: candidate.url, content: markdown, title });
        const previous = index[identity.canonicalUrl];
        if (previous?.lastContentHash === identity.contentHash) {
          previous.lastFetchedAt = now.toISOString();
          const discovered = discoveryByUrl.get(candidate.url);
          if (discovered) discovered.disposition = 'unchanged';
          manifest.skippedCount += 1;
          progress({
            phase: 'article_skipped',
            message: `Article ${articleIndex + 1}/${eligible.length}: unchanged; existing raw record retained.`,
            completed: articleIndex + 1,
            total: eligible.length,
          });
          continue;
        }

        const id = recordId(identity.canonicalUrl, identity.contentHash);
        const source = candidate.source;
        const record: RawArticleRecord = {
          version: CREDDY_PIPELINE_VERSION,
          id,
          runId,
          sourceId: source?.id ?? `topic-search:${candidate.searchQuery ?? 'unknown'}`,
          sourceName: source?.name ?? `Firecrawl search: ${candidate.searchQuery ?? 'unknown'}`,
          sourceTier: source?.tier ?? 'C',
          factualUse: source?.factualUse ?? 'discovery_only',
          originalUrl: candidate.url,
          canonicalUrl: identity.canonicalUrl,
          title,
          markdown,
          contentHash: identity.contentHash,
          titleFingerprint: identity.titleFingerprint,
          fetchedAt: now.toISOString(),
          publishedAt: candidate.publishedAt,
          providerMetadata: page.metadata ?? {},
        };
        await writeJsonAtomic(
          safeDataPath(options.root, '01-raw', runDate(runId), runId, `${id}.json`),
          record,
        );
        const discovered = discoveryByUrl.get(candidate.url);
        if (discovered) {
          discovered.disposition = 'stored_raw';
          discovered.rawRecordId = id;
        }
        index[identity.canonicalUrl] = {
          lastFetchedAt: now.toISOString(),
          lastContentHash: identity.contentHash,
          lastRecordId: id,
        };
        manifest.outputCount += 1;
        progress({
          phase: 'article_stored',
          message: `Article ${articleIndex + 1}/${eligible.length}: stored raw record “${title || identity.canonicalUrl}”.`,
          completed: articleIndex + 1,
          total: eligible.length,
        });
      } catch (error) {
        const discovered = discoveryByUrl.get(candidate.url);
        if (discovered) {
          discovered.disposition = 'scrape_failed';
          discovered.error = (error as Error).message;
        }
        manifest.failedCount += 1;
        manifest.errors.push(`${candidate.url}: ${(error as Error).message}`);
        progress({
          phase: 'article_failed',
          message: `Article ${articleIndex + 1}/${eligible.length}: fetch failed; warning recorded and collection continues.`,
          completed: articleIndex + 1,
          total: eligible.length,
        });
      }
    }

    await writeJsonAtomic(safeDataPath(options.root, '00-discovery', `${runId}.json`), discovery);

    await writeJsonAtomic(safeDataPath(options.root, 'indexes', 'url-index.json'), index);
    const usage = options.client.getUsageSnapshot();
    manifest.providerUsage = { firecrawl: usage };
    // Only expose providerCredits when Firecrawl explicitly reports credits
    // for every successful response. Partial credit totals are misleading.
    if (usage.creditsComplete) manifest.providerCredits = usage.reportedCredits;
    manifest.completedAt = new Date().toISOString();
    manifest.status =
      manifest.failedCount === 0
        ? 'completed'
        : manifest.outputCount > 0
          ? 'partially_completed'
          : 'failed';
    await writeRunManifest(options.root, manifest);
    progress({
      phase: 'run_completed',
      message: `Agent 01 ${manifest.status}: ${manifest.inputCount} candidates, ${manifest.outputCount} new raw records, ${manifest.skippedCount} skipped, ${manifest.failedCount} warnings/failures.`,
    });
    return manifest;
  });
}

export async function countRawRecords(root: string): Promise<number> {
  return (await listJsonFiles(safeDataPath(root, '01-raw'))).length;
}
