import { createHash } from 'node:crypto';

import {
  pathExists,
  readJson,
  safeDataPath,
  writeJsonAtomic,
} from './pipeline-store.js';

export type HookTrendExample = {
  id: string;
  url: string;
  platform: 'instagram' | 'tiktok' | 'youtube';
  publishedAt?: string;
  views: number;
  likes: number;
  shares?: number;
  comments: number;
  bookmarks?: number;
  authorFollowers?: number;
};

export type HookTrendResearchRun = {
  version: 1;
  id: string;
  orbitId?: string;
  status: 'queued' | 'processing' | 'ready_for_review' | 'completed' | 'failed' | 'unavailable';
  createdAt: string;
  updatedAt: string;
  nextEligibleAt: string;
  examples: HookTrendExample[];
  error?: string;
};

export type HookTrendPattern = {
  id: string;
  label: string;
  structure: string;
  rationale: string;
  suitableFor: Array<'act_now' | 'understand' | 'decide_or_discuss'>;
  exampleIds: string[];
};

export type HookTrendSnapshot = {
  version: 1;
  id: string;
  researchRunId: string;
  createdAt: string;
  expiresAt: string;
  patterns: HookTrendPattern[];
};

type FetchLike = typeof fetch;

const STATE_PATH = ['feedback', 'agent-04', 'trends', 'state.json'] as const;
const ACTIVE_PATH = ['feedback', 'agent-04', 'trends', 'active.json'] as const;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_ACTIVE_DAYS = 35;
const KEYWORDS = [
  'credit card benefits',
  'points and miles',
  'travel rewards',
  'welcome bonus',
  'annual fee',
  'airline miles',
  'hotel points',
  'card credits',
] as const;

function dateId(now: Date): string {
  return now.toISOString().slice(0, 10);
}

function stableExampleId(url: string): string {
  return `example-${createHash('sha256').update(url).digest('hex').slice(0, 16)}`;
}

function positiveMetric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0;
}

function sanitizeProviderError(status: number): string {
  return `Virlo request failed with HTTP ${status}`;
}

async function virloJson<T>(
  path: string,
  apiKey: string,
  fetchImpl: FetchLike,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetchImpl(`https://api.virlo.ai/v1${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(sanitizeProviderError(response.status));
  return response.json() as Promise<T>;
}

function normalizeExamples(value: unknown): HookTrendExample[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const examples: HookTrendExample[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== 'object') continue;
    const item = raw as Record<string, unknown>;
    const url = typeof item.url === 'string' ? item.url.trim() : '';
    const platform = typeof item.platform === 'string' ? item.platform.toLowerCase() : '';
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' || !['instagram', 'tiktok', 'youtube'].includes(platform) || seen.has(url)) continue;
    } catch {
      continue;
    }
    seen.add(url);
    const author = item.author && typeof item.author === 'object' ? item.author as Record<string, unknown> : {};
    examples.push({
      id: stableExampleId(url),
      url,
      platform: platform as HookTrendExample['platform'],
      publishedAt: typeof item.publish_date === 'string' ? item.publish_date : undefined,
      views: positiveMetric(item.views),
      likes: positiveMetric(item.likes),
      shares: item.shares === undefined ? undefined : positiveMetric(item.shares),
      comments: positiveMetric(item.comments),
      bookmarks: item.bookmarks === undefined ? undefined : positiveMetric(item.bookmarks),
      authorFollowers: author.followers === undefined ? undefined : positiveMetric(author.followers),
    });
    if (examples.length === 20) break;
  }
  return examples;
}

async function persistRun(root: string, run: HookTrendResearchRun): Promise<HookTrendResearchRun> {
  await writeJsonAtomic(safeDataPath(root, ...STATE_PATH), run);
  await writeJsonAtomic(safeDataPath(root, 'feedback', 'agent-04', 'trends', 'runs', `${run.id}.json`), run);
  return run;
}

export async function refreshHookTrendResearch(
  root: string,
  now = new Date(),
  env: NodeJS.ProcessEnv = process.env,
  fetchImpl: FetchLike = fetch,
): Promise<HookTrendResearchRun> {
  const statePath = safeDataPath(root, ...STATE_PATH);
  const existing = (await pathExists(statePath))
    ? await readJson<HookTrendResearchRun>(statePath)
    : undefined;
  const nextWeek = new Date(now.getTime() + WEEK_MS).toISOString();

  if (existing?.status === 'ready_for_review') return existing;
  if (existing && ['completed', 'unavailable', 'failed'].includes(existing.status) &&
      now.getTime() < Date.parse(existing.nextEligibleAt)) return existing;

  const apiKey = env.VIRLO_API_KEY?.trim();
  if (!apiKey) {
    return persistRun(root, {
      version: 1,
      id: `hook-research-${dateId(now)}`,
      status: 'unavailable',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      nextEligibleAt: nextWeek,
      examples: [],
      error: 'VIRLO_API_KEY is not configured; stable built-in hook patterns remain active.',
    });
  }

  if (existing?.orbitId && ['queued', 'processing'].includes(existing.status)) {
    try {
      const statusResponse = await virloJson<{ data?: { status?: string } }>(
        `/orbit/${encodeURIComponent(existing.orbitId)}?order_by=views&sort=desc`, apiKey, fetchImpl,
      );
      const providerStatus = statusResponse.data?.status;
      if (providerStatus === 'failed') {
        return persistRun(root, { ...existing, status: 'failed', updatedAt: now.toISOString(), nextEligibleAt: nextWeek, error: 'Virlo Orbit reported failure.' });
      }
      if (providerStatus !== 'completed') {
        return persistRun(root, { ...existing, status: providerStatus === 'processing' ? 'processing' : 'queued', updatedAt: now.toISOString() });
      }
      const videosResponse = await virloJson<{ data?: { videos?: unknown[] } }>(
        `/orbit/${encodeURIComponent(existing.orbitId)}/videos?limit=20&platforms=instagram,tiktok,youtube&order_by=views&sort=desc`,
        apiKey, fetchImpl,
      );
      return persistRun(root, {
        ...existing,
        status: 'ready_for_review',
        updatedAt: now.toISOString(),
        examples: normalizeExamples(videosResponse.data?.videos),
        error: undefined,
      });
    } catch (error) {
      return persistRun(root, {
        ...existing,
        status: 'failed',
        updatedAt: now.toISOString(),
        nextEligibleAt: nextWeek,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  try {
    const response = await virloJson<{ data?: { orbit_id?: string } }>('/orbit', apiKey, fetchImpl, {
      method: 'POST',
      body: JSON.stringify({
        name: `creddy-hook-research-${dateId(now)}`,
        keywords: [...KEYWORDS],
        platforms: ['instagram', 'tiktok', 'youtube'],
        time_period: 'this_week',
        min_views: 25_000,
        run_analysis: false,
      }),
    });
    const orbitId = response.data?.orbit_id;
    if (!orbitId) throw new Error('Virlo Orbit returned no ID');
    return persistRun(root, {
      version: 1,
      id: `hook-research-${dateId(now)}`,
      orbitId,
      status: 'queued',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      nextEligibleAt: nextWeek,
      examples: [],
    });
  } catch (error) {
    return persistRun(root, {
      version: 1,
      id: `hook-research-${dateId(now)}`,
      status: 'failed',
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      nextEligibleAt: nextWeek,
      examples: [],
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

function validatePatternText(value: string, field: string, max: number): void {
  if (!value.trim() || value.length > max) throw new Error(`${field} must contain 1-${max} characters`);
  if (/https?:\/\/|www\.|@[a-z0-9_.-]+|[“”"]/.test(value)) {
    throw new Error(`${field} must be an abstract pattern, not copied source wording or attribution`);
  }
}

export async function acceptHookTrendSnapshot(root: string, input: HookTrendSnapshot, now = new Date()): Promise<void> {
  if (input.version !== 1 || !/^hook-patterns-\d{4}-\d{2}-\d{2}$/.test(input.id)) {
    throw new Error('Invalid hook-trend snapshot identity');
  }
  const state = await readJson<HookTrendResearchRun>(safeDataPath(root, ...STATE_PATH));
  if (state.status !== 'ready_for_review' || state.id !== input.researchRunId) {
    throw new Error('Hook patterns require one completed current research run');
  }
  const createdAt = Date.parse(input.createdAt);
  const expiresAt = Date.parse(input.expiresAt);
  if (!Number.isFinite(createdAt) || !Number.isFinite(expiresAt) || createdAt > now.getTime() + 60_000 ||
      expiresAt <= createdAt || expiresAt - createdAt > MAX_ACTIVE_DAYS * 24 * 60 * 60 * 1000) {
    throw new Error('Hook-trend snapshot dates are invalid or active for too long');
  }
  if (!Array.isArray(input.patterns) || input.patterns.length < 1 || input.patterns.length > 8) {
    throw new Error('Hook-trend snapshot requires 1-8 abstract patterns');
  }
  const availableExamples = new Set(state.examples.map((example) => example.id));
  const patternIds = new Set<string>();
  for (const pattern of input.patterns) {
    if (!/^[a-z][a-z0-9-]{2,60}$/.test(pattern.id) || patternIds.has(pattern.id)) {
      throw new Error('Hook-trend patterns require unique stable IDs');
    }
    patternIds.add(pattern.id);
    validatePatternText(pattern.label, `Pattern ${pattern.id} label`, 80);
    validatePatternText(pattern.structure, `Pattern ${pattern.id} structure`, 180);
    validatePatternText(pattern.rationale, `Pattern ${pattern.id} rationale`, 240);
    if (!Array.isArray(pattern.suitableFor) || pattern.suitableFor.length === 0 ||
        pattern.suitableFor.some((slot) => !['act_now', 'understand', 'decide_or_discuss'].includes(slot))) {
      throw new Error(`Pattern ${pattern.id} requires valid content slots`);
    }
    if (!Array.isArray(pattern.exampleIds) || pattern.exampleIds.length === 0 ||
        pattern.exampleIds.some((id) => !availableExamples.has(id))) {
      throw new Error(`Pattern ${pattern.id} must cite current research example IDs`);
    }
  }
  await writeJsonAtomic(safeDataPath(root, 'feedback', 'agent-04', 'trends', 'snapshots', `${input.id}.json`), input);
  await writeJsonAtomic(safeDataPath(root, ...ACTIVE_PATH), input);
  await persistRun(root, { ...state, status: 'completed', updatedAt: now.toISOString(), nextEligibleAt: new Date(now.getTime() + WEEK_MS).toISOString() });
}

export async function activeHookTrendSnapshot(root: string): Promise<HookTrendSnapshot | undefined> {
  const path = safeDataPath(root, ...ACTIVE_PATH);
  return (await pathExists(path)) ? readJson<HookTrendSnapshot>(path) : undefined;
}

export async function validateDraftTrendReference(
  root: string,
  trendSnapshotId: string | undefined,
  trendPatternIds: Array<string | undefined>,
  slot: 'act_now' | 'understand' | 'decide_or_discuss',
  now = new Date(),
): Promise<void> {
  const used = trendPatternIds.filter((id): id is string => Boolean(id));
  if (used.length === 0) {
    if (trendSnapshotId !== undefined) throw new Error('Trend snapshot cannot be declared without a trend-inspired candidate');
    return;
  }
  if (used.length > 1) throw new Error('At most one of four concept candidates may use a current trend pattern');
  const snapshot = await activeHookTrendSnapshot(root);
  if (!snapshot || snapshot.id !== trendSnapshotId || Date.parse(snapshot.expiresAt) <= now.getTime()) {
    throw new Error('Trend-inspired copy must reference the current unexpired hook-pattern snapshot');
  }
  const pattern = snapshot.patterns.find((candidate) => candidate.id === used[0]);
  if (!pattern) {
    throw new Error('Trend-inspired candidate references an unknown pattern');
  }
  if (!pattern.suitableFor.includes(slot)) {
    throw new Error('Trend-inspired candidate uses a hook pattern that is not approved for its content slot');
  }
}
