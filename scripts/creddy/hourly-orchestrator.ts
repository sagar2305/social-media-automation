import { createHash } from 'node:crypto';
import { unlink } from 'node:fs/promises';

import { notifyWithheldNewsDigest } from '../../shared/creddy-news/creddy-news-slack.js';
import { runAppNewsStage } from '../creddy-news/news-stage.js';
import { runAnalysisQueueStage } from './analysis-stage.js';
import { runCollectionStage } from './collection-stage.js';
import { CREDDY_DISCOVERY_PROFILE } from './config.js';
import { runDedupeStage } from './dedupe-stage.js';
import { runFilterStage } from './filter-stage.js';
import type { FirecrawlClient } from './firecrawl-client.js';
import type { AnalysisDecisionRecord } from './pipeline-types.js';
import { prepareRollingOfficialVerificationTasks } from './official-verification-stage.js';
import {
  createRunId,
  listJsonFiles,
  pathExists,
  readJson,
  safeDataPath,
  withStageLock,
  writeJsonAtomic,
} from './pipeline-store.js';
import {
  authorizeRollingProduction,
  newsProjectionPlan,
  officialVerificationFingerprint,
  rollingEditorialStatus,
  selectDailyEditorialSlate,
  verificationCandidateIds,
} from './rolling-editorial.js';

export interface HourlyOrchestratorLease {
  version: 1;
  runId: string;
  status: 'running' | 'completed' | 'failed';
  startedAt: string;
  heartbeatAt: string;
  completedAt?: string;
  error?: string;
}

const LEASE_PATH = ['05-editorial-ledger', 'hourly-runs', 'current.json'] as const;

/** A News service outage must not prevent authorized blog/social delivery.
 * Persist an explicitly degraded result rather than a healthy-looking no-op. */
export async function runHourlyNewsProjection(root: string, env: NodeJS.ProcessEnv,
  suppliedPlan?: Awaited<ReturnType<typeof newsProjectionPlan>>, now = new Date()) {
  let plan = suppliedPlan;
  const empty = { disabled: env.CREDDY_NEWS_ENABLED !== 'true', published: 0, publishedNew: 0,
    publishedChanged: 0, publishedReconciled: 0, publishedUnchanged: 0, notPublished: 0,
    deleted: 0, publishedIds: [] as string[], withheld: [] as Array<{ id: string; headline: string; reason: string }>,
    failures: [] as Array<{ id: string; reason: string }> };
  try {
    plan ??= await newsProjectionPlan(root, now);
    const result = plan.eligibleIds.length || plan.conflictIds.length
      ? await runAppNewsStage(root, { env, canonicalIds: plan.eligibleIds,
        conflictIds: plan.conflictIds, notifyMode: 'published_only' }) : empty;
    const reported = { ...result, status: result.disabled ? 'disabled' : result.failures.length ? 'degraded' : 'completed',
      excluded: plan.excluded };
    await writeJsonAtomic(safeDataPath(root, 'reports', 'latest', 'app-news.json'), reported);
    return reported;
  } catch {
    const result = { ...empty, status: 'degraded', excluded: plan?.excluded ?? [],
      failures: [{ id: 'news-stage', reason: 'News stage failed; check configuration and local inputs. Delivery remains retryable.' }] };
    await writeJsonAtomic(safeDataPath(root, 'reports', 'latest', 'app-news.json'), result);
    return result;
  }
}

type WithheldNewsItem = { id: string; headline: string; reason: string; fingerprint: string };

export async function selectNewWithheldNewsItems(
  root: string,
  candidates: Array<{ id: string; headline: string; reason: string }>,
): Promise<WithheldNewsItem[]> {
  const selected: WithheldNewsItem[] = [];
  for (const item of candidates) {
    const itemKey = createHash('sha256').update(item.id).digest('hex');
    let officialHash = 'missing';
    try {
      officialHash = officialVerificationFingerprint(await readJson<AnalysisDecisionRecord>(
        safeDataPath(root, '04-analysis-queue', 'completed', `${item.id}.json`),
      ));
    } catch {
      // A processing failure can lack a completed decision; its stable reason
      // still deduplicates the digest until local state changes.
    }
    const fingerprint = createHash('sha256').update(JSON.stringify({ id: item.id, officialHash, reason: item.reason })).digest('hex');
    const itemReceipt = safeDataPath(root, 'reports', 'news-withheld-slack', 'items', `${itemKey}.json`);
    const prior = await pathExists(itemReceipt) ? await readJson<{ fingerprint: string }>(itemReceipt) : undefined;
    if (prior?.fingerprint !== fingerprint) selected.push({ ...item, fingerprint });
  }
  return selected;
}

export async function recordWithheldNewsItems(
  root: string,
  items: WithheldNewsItem[],
  input: { sentAt: string; digestKey: string; ts?: string },
): Promise<void> {
  for (const item of items) {
    const itemKey = createHash('sha256').update(item.id).digest('hex');
    await writeJsonAtomic(
      safeDataPath(root, 'reports', 'news-withheld-slack', 'items', `${itemKey}.json`),
      { version: 1, canonicalId: item.id, fingerprint: item.fingerprint, ...input },
    );
  }
}

export async function beginHourlyRun(root: string, now = new Date()): Promise<HourlyOrchestratorLease | undefined> {
  return withStageLock(root, 'hourly_orchestrator_start', async () => {
    const path = safeDataPath(root, ...LEASE_PATH);
    if (await pathExists(path)) {
      const current = await readJson<HourlyOrchestratorLease>(path);
      const heartbeat = Date.parse(current.heartbeatAt);
      if (current.status === 'running' && Number.isFinite(heartbeat) && now.getTime() - heartbeat < 2 * 60 * 60 * 1000) {
        return undefined;
      }
    }
    const lease: HourlyOrchestratorLease = {
      version: 1,
      runId: createRunId(now),
      status: 'running',
      startedAt: now.toISOString(),
      heartbeatAt: now.toISOString(),
    };
    await writeJsonAtomic(path, lease);
    await writeJsonAtomic(safeDataPath(root, '05-editorial-ledger', 'hourly-runs', `${lease.runId}.json`), lease);
    return lease;
  });
}

export async function heartbeatHourlyRun(root: string, runId: string, now = new Date()): Promise<HourlyOrchestratorLease> {
  const path = safeDataPath(root, ...LEASE_PATH);
  const lease = await readJson<HourlyOrchestratorLease>(path);
  if (lease.runId !== runId || lease.status !== 'running') throw new Error('Hourly orchestrator lease is not current');
  const next = { ...lease, heartbeatAt: now.toISOString() };
  await writeJsonAtomic(path, next);
  await writeJsonAtomic(safeDataPath(root, '05-editorial-ledger', 'hourly-runs', `${runId}.json`), next);
  return next;
}

export async function finishHourlyRun(
  root: string,
  runId: string,
  error?: string,
  now = new Date(),
): Promise<HourlyOrchestratorLease> {
  const path = safeDataPath(root, ...LEASE_PATH);
  const lease = await readJson<HourlyOrchestratorLease>(path);
  if (lease.runId !== runId) throw new Error('Cannot finish a superseded hourly orchestrator lease');
  const completed: HourlyOrchestratorLease = {
    ...lease,
    status: error ? 'failed' : 'completed',
    heartbeatAt: now.toISOString(),
    completedAt: now.toISOString(),
    error,
  };
  await writeJsonAtomic(safeDataPath(root, '05-editorial-ledger', 'hourly-runs', `${runId}.json`), completed);
  await unlink(path).catch(() => undefined);
  return completed;
}

export async function runHourlyDiscovery(input: {
  root: string;
  client: FirecrawlClient;
  runId: string;
  now?: Date;
  maxLinksPerSource?: number;
  maxArticleScrapes?: number;
  recheckAfterHours?: number;
}): Promise<Record<string, unknown>> {
  const now = input.now ?? new Date();
  await heartbeatHourlyRun(input.root, input.runId, now);
  const collection = await runCollectionStage({
    root: input.root,
    client: input.client,
    maxLinksPerSource: input.maxLinksPerSource ?? CREDDY_DISCOVERY_PROFILE.maxLinksPerSourceDefault,
    maxArticleScrapes: input.maxArticleScrapes ?? CREDDY_DISCOVERY_PROFILE.productionScrapeLimit,
    recheckAfterHours: input.recheckAfterHours ?? CREDDY_DISCOVERY_PROFILE.freshnessHours,
  });
  const filtering = await runFilterStage(input.root, now);
  const deduplication = await runDedupeStage(input.root, now);
  const analysisQueue = await runAnalysisQueueStage(input.root, now);
  await heartbeatHourlyRun(input.root, input.runId, new Date());
  return { collection, filtering, deduplication, analysisQueue };
}

export async function runHourlyRouting(input: {
  root: string;
  runId: string;
  now?: Date;
  env?: NodeJS.ProcessEnv;
}): Promise<Record<string, unknown>> {
  const now = input.now ?? new Date();
  const env = input.env ?? process.env;
  await heartbeatHourlyRun(input.root, input.runId, now);
  const dailySelection = await selectDailyEditorialSlate(input.root, now);
  const analysisPending = (await listJsonFiles(safeDataPath(input.root, '04-analysis-queue', 'pending'))).length;
  const verificationIds = await verificationCandidateIds(input.root, now, 5, dailySelection ?? null);
  const verificationTasks = await prepareRollingOfficialVerificationTasks(input.root, verificationIds, now);
  const authorizations = await authorizeRollingProduction(input.root, now, dailySelection ?? null);
  const news = await runHourlyNewsProjection(input.root, env, undefined, now);
  let withheldSlack: { sent: boolean; ts?: string; error?: string } = { sent: false };
  const digestKey = now.toISOString().slice(0, 13);
  const receiptPath = safeDataPath(input.root, 'reports', 'news-withheld-slack', `${digestKey}.json`);
  const withheldCandidates = [
    ...news.withheld,
    ...news.excluded.filter((item) => item.actionable && !news.disabled &&
      !news.withheld.some((withheld) => withheld.id === item.id)),
    ...news.failures.map((item) => ({ id: item.id, headline: item.id, reason: 'Processing failed; inspect the local hourly report.' })),
  ];
  const withheldItems = await selectNewWithheldNewsItems(input.root, withheldCandidates);
  if (withheldItems.length && !(await pathExists(receiptPath))) {
    try {
      withheldSlack = await notifyWithheldNewsDigest(
        withheldItems.map(({ headline, reason }) => ({ headline, reason })),
        digestKey,
        env.DASHBOARD_BASE_URL?.trim() || 'http://127.0.0.1:3000',
        env,
      );
      if (withheldSlack.sent) {
        const sentAt = new Date().toISOString();
        await writeJsonAtomic(receiptPath, { version: 1, digestKey, sentAt, count: withheldItems.length, ts: withheldSlack.ts });
        await recordWithheldNewsItems(input.root, withheldItems, { sentAt, digestKey, ts: withheldSlack.ts });
      }
    } catch {
      withheldSlack = { sent: false, error: 'Withheld News Slack digest failed; inspect Slack configuration and the local hourly report.' };
    }
  }
  const result = {
    runId: input.runId,
    status: news.status === 'degraded' || withheldSlack.error ? 'degraded' : 'completed',
    dailySelection,
    dailySelectionDeferred: !dailySelection && analysisPending > 0,
    verificationCandidateIds: verificationIds,
    verificationTaskCount: verificationTasks.length,
    authorizations,
    news,
    withheldSlack,
    rolling: await rollingEditorialStatus(input.root, now),
  };
  await writeJsonAtomic(safeDataPath(input.root, 'reports', 'latest', 'hourly-editorial.json'), result);
  await heartbeatHourlyRun(input.root, input.runId, new Date());
  return result;
}
