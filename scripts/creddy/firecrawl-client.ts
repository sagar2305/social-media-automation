const DEFAULT_BASE_URL = 'https://api.firecrawl.dev/v2';
const DEFAULT_TIMEOUT_MS = 60_000;

export interface FirecrawlScrapeData {
  markdown?: string;
  links?: string[];
  metadata?: {
    title?: string;
    description?: string;
    sourceURL?: string;
    url?: string;
    statusCode?: number;
    error?: string;
    [key: string]: unknown;
  };
  warning?: string;
}

export interface FirecrawlScrapeResponse {
  success: boolean;
  data: FirecrawlScrapeData;
  creditsUsed?: number;
}

export interface FirecrawlSearchResult {
  title?: string;
  description?: string;
  url: string;
  metadata?: Record<string, unknown>;
}

export interface FirecrawlSearchResponse {
  success: boolean;
  data: {
    web?: FirecrawlSearchResult[];
    news?: FirecrawlSearchResult[];
  };
  warning?: string;
  id?: string;
  creditsUsed?: number;
}

export interface FirecrawlClientOptions {
  apiKey: string;
  baseUrl?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}

export interface ScrapePageOptions {
  /** Cache only rapid retries; twice-daily discovery must not accept 2-day data. */
  maxAgeMs?: number;
}

export interface SearchNewsOptions {
  limit?: number;
  timeRange?: 'qdr:h' | 'qdr:d' | 'qdr:w';
}

export interface FirecrawlUsageSnapshot {
  scrapeRequests: number;
  scrapeSuccesses: number;
  scrapeFailures: number;
  searchRequests: number;
  searchSuccesses: number;
  searchFailures: number;
  reportedCredits?: number;
  responsesReportingCredits: number;
  creditsComplete: boolean;
}

export class FirecrawlRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'FirecrawlRequestError';
  }
}

export class FirecrawlClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly fetchImpl: typeof fetch;
  private readonly usage = {
    scrapeRequests: 0,
    scrapeSuccesses: 0,
    scrapeFailures: 0,
    searchRequests: 0,
    searchSuccesses: 0,
    searchFailures: 0,
    reportedCredits: 0,
    responsesReportingCredits: 0,
  };

  constructor(options: FirecrawlClientOptions) {
    this.apiKey = options.apiKey.trim();
    if (!this.apiKey) throw new Error('Firecrawl API key is required');
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async scrapePage(
    url: string,
    options: ScrapePageOptions = {},
  ): Promise<FirecrawlScrapeData> {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      throw new Error(`Unsupported scrape protocol: ${parsed.protocol}`);
    }

    this.usage.scrapeRequests += 1;
    try {
      const response = await this.request<FirecrawlScrapeResponse>('/scrape', {
        url: parsed.toString(),
        formats: ['markdown', 'links'],
        onlyMainContent: true,
        maxAge: options.maxAgeMs ?? 15 * 60 * 1000,
        timeout: this.timeoutMs,
        location: { country: 'US', languages: ['en-US'] },
        removeBase64Images: true,
        blockAds: true,
        proxy: 'basic',
        parsers: [],
        storeInCache: true,
      });
      this.usage.scrapeSuccesses += 1;
      this.recordReportedCredits(response.creditsUsed);
      return response.data;
    } catch (error) {
      this.usage.scrapeFailures += 1;
      throw error;
    }
  }

  /**
   * Search only for URLs and snippets. Results are not scraped here; callers
   * deduplicate against stored URLs first, then spend scrape credits only on
   * genuinely new pages.
   */
  async searchNews(
    query: string,
    options: SearchNewsOptions = {},
  ): Promise<FirecrawlSearchResult[]> {
    const cleanQuery = query.trim();
    if (!cleanQuery) throw new Error('Firecrawl search query is required');

    const limit = options.limit ?? 10;
    if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
      throw new Error('Firecrawl search limit must be an integer from 1 to 100');
    }

    this.usage.searchRequests += 1;
    try {
      const response = await this.request<FirecrawlSearchResponse>('/search', {
        query: cleanQuery,
        limit,
        sources: ['news'],
        tbs: options.timeRange ?? 'qdr:d',
        country: 'US',
        timeout: this.timeoutMs,
        ignoreInvalidURLs: true,
      });
      this.usage.searchSuccesses += 1;
      this.recordReportedCredits(response.creditsUsed);
      return response.data.news ?? [];
    } catch (error) {
      this.usage.searchFailures += 1;
      throw error;
    }
  }

  getUsageSnapshot(): FirecrawlUsageSnapshot {
    const successfulResponses = this.usage.scrapeSuccesses + this.usage.searchSuccesses;
    return {
      ...this.usage,
      reportedCredits: this.usage.responsesReportingCredits > 0
        ? this.usage.reportedCredits
        : undefined,
      creditsComplete:
        successfulResponses > 0 &&
        this.usage.responsesReportingCredits === successfulResponses,
    };
  }

  private recordReportedCredits(value: number | undefined): void {
    if (!Number.isFinite(value) || value === undefined) return;
    this.usage.reportedCredits += value;
    this.usage.responsesReportingCredits += 1;
  }

  private async request<T>(path: string, body: Record<string, unknown>): Promise<T> {
    const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(this.timeoutMs),
    });

    const raw = await response.text();
    if (!response.ok) {
      const safeBody = raw.replaceAll(this.apiKey, '[redacted]').slice(0, 500);
      throw new FirecrawlRequestError(
        `Firecrawl ${path} failed with HTTP ${response.status}: ${safeBody}`,
        response.status,
      );
    }

    let parsed: T;
    try {
      parsed = JSON.parse(raw) as T;
    } catch {
      throw new FirecrawlRequestError(
        `Firecrawl ${path} returned invalid JSON`,
        response.status,
      );
    }

    if (!(parsed as { success?: boolean }).success) {
      throw new FirecrawlRequestError(
        `Firecrawl ${path} returned success=false`,
        response.status,
      );
    }
    return parsed;
  }
}
