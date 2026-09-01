import dotenv from 'dotenv';

import { acceptAnalysisDecision, runAnalysisQueueStage } from '../creddy/analysis-stage.js';
import { runCollectionStage } from '../creddy/collection-stage.js';
import { CREDDY_DISCOVERY_PROFILE } from '../creddy/config.js';
import { runDedupeStage } from '../creddy/dedupe-stage.js';
import { runFilterStage } from '../creddy/filter-stage.js';
import { FirecrawlClient } from '../creddy/firecrawl-client.js';
import {
  acceptOfficialVerification,
  listPendingOfficialVerificationTasks,
  prepareOfficialVerificationTasks,
} from '../creddy/official-verification-stage.js';
import {
  initializeCreddyDataRoot,
  listJsonFiles,
  readJson,
  safeDataPath,
} from '../creddy/pipeline-store.js';
import type { AnalysisDecisionRecord, CreddyOfficialVerificationRecord } from '../creddy/pipeline-types.js';
import { resolveCreddyNewsDataRoot } from './data-root.js';
import { runAppNewsStage } from './news-stage.js';

dotenv.config({ path: '.env.local', quiet: true });

function requireAgentEnabled(): void {
  if (process.env.CREDDY_NEWS_AGENT_ENABLED?.trim().toLowerCase() !== 'true') {
    throw new Error('News Agent is disabled. Set CREDDY_NEWS_AGENT_ENABLED=true only for the standalone News workflow.');
  }
}

function argument(index: number, label: string): string {
  const value = process.argv[index]?.trim();
  if (!value) throw new Error(`${label} is required`);
  return value;
}

function positiveInteger(value: string | undefined, fallback: number, label: string): number {
  const parsed = Number(value?.trim() || fallback);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${label} must be a positive integer`);
  return parsed;
}

function positiveNumber(value: string | undefined, fallback: number, label: string): number {
  const parsed = Number(value?.trim() || fallback);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${label} must be a positive number`);
  return parsed;
}

async function counts(root: string) {
  const locations = {
    raw: ['01-raw'],
    canonical: ['03-canonical-news', 'approved'],
    analysisPending: ['04-analysis-queue', 'pending'],
    analysisCompleted: ['04-analysis-queue', 'completed'],
    officialPending: ['04-official-verification', 'pending'],
    officialCompleted: ['04-official-verification', 'completed'],
  } as const;
  return Object.fromEntries(await Promise.all(Object.entries(locations).map(async ([key, segments]) =>
    [key, (await listJsonFiles(safeDataPath(root, ...segments))).length],
  )));
}

async function prepareCycle(root: string) {
  const key = process.env.FIRECRAWL_API_KEY?.trim();
  if (!key) throw new Error('FIRECRAWL_API_KEY is required for News collection');
  const collection = await runCollectionStage({
    root,
    client: new FirecrawlClient({ apiKey: key }),
    maxLinksPerSource: positiveInteger(process.env.CREDDY_NEWS_MAX_LINKS_PER_SOURCE, CREDDY_DISCOVERY_PROFILE.maxLinksPerSourceDefault, 'CREDDY_NEWS_MAX_LINKS_PER_SOURCE'),
    maxArticleScrapes: positiveInteger(process.env.CREDDY_NEWS_MAX_ARTICLE_SCRAPES, CREDDY_DISCOVERY_PROFILE.productionScrapeLimit, 'CREDDY_NEWS_MAX_ARTICLE_SCRAPES'),
    recheckAfterHours: positiveNumber(process.env.CREDDY_NEWS_RECHECK_HOURS, CREDDY_DISCOVERY_PROFILE.freshnessHours, 'CREDDY_NEWS_RECHECK_HOURS'),
    onProgress: (event) => console.log(`[News Agent][collection][${event.phase}] ${event.message}`),
  });
  const filtering = await runFilterStage(root, new Date(), (event) =>
    console.log(`[News Agent][filtering][${event.phase}] ${event.message}`));
  const deduplication = await runDedupeStage(root, new Date(), (event) =>
    console.log(`[News Agent][deduplication][${event.phase}] ${event.message}`));
  const analysisQueue = await runAnalysisQueueStage(root);
  return { collection, filtering, deduplication, analysisQueue, counts: await counts(root) };
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'status';
  const root = resolveCreddyNewsDataRoot();
  if (command === 'status') {
    console.log(JSON.stringify({ workflow: 'creddy-app-news', root, enabled: process.env.CREDDY_NEWS_AGENT_ENABLED === 'true', counts: await counts(root) }, null, 2));
    return;
  }
  if (command === 'init') {
    await initializeCreddyDataRoot(root);
    console.log(JSON.stringify({ workflow: 'creddy-app-news', initialized: root }, null, 2));
    return;
  }
  requireAgentEnabled();
  await initializeCreddyDataRoot(root);
  if (command === 'cycle-prep') {
    console.log(JSON.stringify({ workflow: 'creddy-app-news', ...(await prepareCycle(root)), next: 'Rank every pending task with the standalone News Agent prompt.' }, null, 2));
    return;
  }
  if (command === 'analysis-pending') {
    console.log(JSON.stringify(await listJsonFiles(safeDataPath(root, '04-analysis-queue', 'pending')), null, 2));
    return;
  }
  if (command === 'accept-analysis') {
    const decision = await readJson<AnalysisDecisionRecord>(argument(3, 'analysis decision file'));
    await acceptAnalysisDecision(root, decision);
    console.log(JSON.stringify({ accepted: decision.id, route: decision.route }, null, 2));
    return;
  }
  if (command === 'verification-prepare') {
    const selected = await prepareOfficialVerificationTasks(root);
    console.log(JSON.stringify({ selected: selected.length, pending: await listPendingOfficialVerificationTasks(root) }, null, 2));
    return;
  }
  if (command === 'verification-pending') {
    console.log(JSON.stringify(await listPendingOfficialVerificationTasks(root), null, 2));
    return;
  }
  if (command === 'accept-verification') {
    const verification = await readJson<CreddyOfficialVerificationRecord>(argument(3, 'official verification file'));
    const decision = await acceptOfficialVerification(root, verification);
    console.log(JSON.stringify({ accepted: verification.id, status: verification.status, decisionId: decision.id }, null, 2));
    return;
  }
  if (command === 'publish') {
    const canonicalIds = process.argv.slice(3).map((value) => value.trim()).filter(Boolean);
    console.log(JSON.stringify(await runAppNewsStage(root, canonicalIds.length ? { canonicalIds } : {}), null, 2));
    return;
  }
  throw new Error(`Unknown News Agent command: ${command}`);
}

main().catch((error) => {
  console.error(`[News Agent] ${(error as Error).message}`);
  process.exitCode = 1;
});
