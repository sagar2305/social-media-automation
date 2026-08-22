import dotenv from 'dotenv';

import {
  acceptAnalysisDecision,
  auditAnalysisDecisionBatch,
  runAnalysisQueueStage,
} from './analysis-stage.js';
import { BlotatoClient } from './blotato-client.js';
import { runCollectionStage } from './collection-stage.js';
import { acceptContentDraft, listPendingCopyTasks } from './copy-stage.js';
import {
  acceptContentPackage,
  acceptContentRevision,
  listPendingContentOpportunities,
  listPendingContentRevisions,
} from './content-stage.js';
import { runDedupeStage } from './dedupe-stage.js';
import { runFilterStage } from './filter-stage.js';
import { FirecrawlClient } from './firecrawl-client.js';
import {
  initializeCreddyDataRoot,
  listJsonFiles,
  pathExists,
  readJson,
  resolveCreddyDataRoot,
  safeDataPath,
} from './pipeline-store.js';
import type {
  AnalysisDecisionRecord,
  ContentBankRecord,
  ContentDraftRecord,
  ContentPackageRecord,
  VisualPlanRecord,
} from './pipeline-types.js';
import { requireStableDashboardBaseUrl } from './public-dashboard.js';
import { runPublishStage } from './publish-stage.js';
import { listPendingProductionTasks, prepareProductionPackages } from './production-stage.js';
import { writeObservablePipelineReports } from './report-stage.js';
import { runSlackReviewStage, SlackClient } from './slack-stage.js';
import { runSlideshowContentBankHandoff } from './slideshow-bank-stage.js';
import { VideoFactoryClient } from './video-factory-client.js';
import { approveContentBankItem, rejectContentBankItem, runContentBankHandoff, runVideoStage } from './video-stage.js';
import { acceptVisualPlan, listPendingVisualTasks } from './visual-stage.js';

dotenv.config({ path: '.env.local', quiet: true });

function requireEnabled(): void {
  if (process.env.CREDDY_PIPELINE_ENABLED?.trim().toLocaleLowerCase('en-US') !== 'true') {
    throw new Error('Creddy pipeline is disabled. Set CREDDY_PIPELINE_ENABLED=true only after preflight.');
  }
  if ((process.env.CREDDY_AI_EXECUTION_MODE?.trim() || 'codex_scheduled') !== 'codex_scheduled') {
    throw new Error('Scheduled CLI requires CREDDY_AI_EXECUTION_MODE=codex_scheduled');
  }
}

function argument(index: number, label: string): string {
  const value = process.argv[index]?.trim();
  if (!value) throw new Error(`${label} is required`);
  return value;
}

async function status(root: string): Promise<Record<string, number>> {
  const locations = {
    raw: ['01-raw'],
    filtered: ['02-filtered'],
    canonical: ['03-canonical-news', 'approved'],
    analysisPending: ['04-analysis-queue', 'pending'],
    analysisCompleted: ['04-analysis-queue', 'completed'],
    contentOpportunities: ['05-content-opportunities'],
    contentDrafts: ['06-content-drafts'],
    visualPlans: ['06-visual-plans'],
    contentPackages: ['06-content-packages'],
    videoJobs: ['07-video-jobs'],
    pendingApproval: ['09-pending-approval'],
    approved: ['10-approved'],
    scheduled: ['11-scheduled'],
    published: ['12-published'],
    rejectedContent: ['13-rejected-content'],
  } as const;
  const result: Record<string, number> = {};
  for (const [name, segments] of Object.entries(locations)) {
    const files = await listJsonFiles(safeDataPath(root, ...segments));
    if (name === 'pendingApproval') {
      const records = await Promise.all(files.map((path) => readJson<ContentBankRecord>(path)));
      result[name] = records.filter((record) =>
        ['pending_review', 'changes_requested', 'rendering_revision'].includes(record.status),
      ).length;
    } else {
      result[name] =
        name === 'contentPackages' || name === 'contentDrafts'
          ? files.filter((path) => !/\/(scripts|captions|images|briefs)\//.test(path)).length
          : files.length;
    }
  }
  return result;
}

function hasDurableWorkForLaterAgents(counts: Record<string, number>): boolean {
  return [
    'raw',
    'filtered',
    'canonical',
    'analysisPending',
    'analysisCompleted',
    'contentOpportunities',
    'contentDrafts',
    'visualPlans',
    'contentPackages',
    'videoJobs',
    'pendingApproval',
    'approved',
    'scheduled',
  ].some((name) => (counts[name] || 0) > 0);
}

async function main(): Promise<void> {
  const command = process.argv[2] ?? 'status';
  const root = resolveCreddyDataRoot();

  if (command === 'init') {
    await initializeCreddyDataRoot(root);
    console.log(JSON.stringify({ ok: true, root }, null, 2));
    return;
  }
  if (command === 'status') {
    console.log(JSON.stringify({ root, enabled: process.env.CREDDY_PIPELINE_ENABLED === 'true', counts: await status(root) }, null, 2));
    return;
  }
  if (command === 'report') {
    await initializeCreddyDataRoot(root);
    console.log(JSON.stringify({ reports: await writeObservablePipelineReports(root) }, null, 2));
    return;
  }

  requireEnabled();
  await initializeCreddyDataRoot(root);

  if (command === 'collect' || command === 'agent-1') {
    const key = process.env.FIRECRAWL_API_KEY?.trim();
    if (!key) throw new Error('FIRECRAWL_API_KEY is required for collection');
    const result = await runCollectionStage({
      root,
      client: new FirecrawlClient({ apiKey: key }),
      maxLinksPerSource: Number(process.env.CREDDY_MAX_LINKS_PER_SOURCE || 10),
      maxArticleScrapes: Number(process.env.CREDDY_MAX_ARTICLE_SCRAPES || 40),
      recheckAfterHours: Number(process.env.CREDDY_RECHECK_HOURS || 24),
      ...(command === 'agent-1'
        ? {
            onProgress: (event: { phase: string; message: string }) => {
              console.log(`[Agent 01][${event.phase}] ${event.message}`);
            },
          }
        : {}),
    });
    if (command === 'agent-1') {
      const reports = await writeObservablePipelineReports(root);
      const durableCounts = await status(root);
      const durableDownstreamWork = hasDurableWorkForLaterAgents(durableCounts);
      // A source-specific collection failure must not strand already-persisted,
      // validated work. Agent 02 can safely no-op when Agent 01 found nothing new,
      // while later agents continue draining their own durable queues.
      const nextAgentReady = result.status !== 'failed' || durableDownstreamWork;
      console.log(JSON.stringify({
        agent: 1,
        result,
        localEvidence: {
          discovery: safeDataPath(root, '00-discovery', `${result.runId}.json`),
          rawDirectory: safeDataPath(root, '01-raw'),
          manifest: safeDataPath(root, 'manifests', `${result.runId}.json`),
          reports: reports.filter((path) => path.includes('01-')),
        },
        durableCounts,
        nextAgentReady,
        readinessReason: nextAgentReady
          ? result.status === 'failed'
            ? 'collection_failed_but_durable_downstream_work_exists'
            : 'collection_completed_or_partially_completed'
          : 'no_new_collection_output_and_no_durable_downstream_work',
      }, null, 2));
    } else {
      console.log(JSON.stringify(result, null, 2));
    }
    return;
  }
  if (command === 'filter') {
    console.log(JSON.stringify(await runFilterStage(root), null, 2));
    return;
  }
  if (command === 'agent-2') {
    const filtering = await runFilterStage(root, new Date(), (event) => {
      console.log(`[Agent 02][filtering][${event.phase}] ${event.message}`);
    });
    console.log('[Agent 02][handoff] Filtering produced durable output; starting verification and deduplication.');
    const deduplication = await runDedupeStage(root, new Date(), (event) => {
      console.log(`[Agent 02][deduplication][${event.phase}] ${event.message}`);
    });
    const reports = await writeObservablePipelineReports(root);
    const canonicalFiles = await listJsonFiles(safeDataPath(root, '03-canonical-news', 'approved'));
    const durableCounts = await status(root);
    const nextAgentReady = canonicalFiles.length > 0 || hasDurableWorkForLaterAgents(durableCounts);
    console.log(JSON.stringify({
      agent: 2,
      filtering,
      deduplication,
      localEvidence: {
        filteredDirectory: safeDataPath(root, '02-filtered'),
        canonicalDirectory: safeDataPath(root, '03-canonical-news', 'approved'),
        rejectedDirectory: safeDataPath(root, '03-canonical-news', 'rejected'),
        duplicateArchiveDirectory: safeDataPath(root, '03-canonical-news', 'archived'),
        filteringManifest: safeDataPath(root, 'manifests', `${filtering.runId}.json`),
        deduplicationManifest: safeDataPath(root, 'manifests', `${deduplication.runId}.json`),
        reports: reports.filter((path) => path.includes('02-')),
      },
      canonicalCount: canonicalFiles.length,
      durableCounts,
      nextAgentReady,
      readinessReason: nextAgentReady
        ? deduplication.failedCount > 0
          ? 'cleaning_had_item_failures_but_durable_downstream_work_exists'
          : 'canonical_or_durable_downstream_work_exists'
        : 'no_canonical_or_durable_downstream_work',
    }, null, 2));
    return;
  }
  if (command === 'dedupe') {
    console.log(JSON.stringify(await runDedupeStage(root), null, 2));
    return;
  }
  if (command === 'queue-analysis') {
    console.log(JSON.stringify(await runAnalysisQueueStage(root), null, 2));
    return;
  }
  if (command === 'agent-3-prepare') {
    const queue = await runAnalysisQueueStage(root);
    const pending = await listJsonFiles(safeDataPath(root, '04-analysis-queue', 'pending'));
    const reports = await writeObservablePipelineReports(root);
    console.log(JSON.stringify({ agent: 3, queue, pendingCount: pending.length, pending, reports }, null, 2));
    return;
  }
  if (command === 'analysis-pending') {
    console.log(
      JSON.stringify(await listJsonFiles(safeDataPath(root, '04-analysis-queue', 'pending')), null, 2),
    );
    return;
  }
  if (command === 'audit-analysis-batch') {
    const directory = argument(3, 'analysis decision directory');
    const minimumRoutable = Number(process.argv[4] || 5);
    const files = await listJsonFiles(directory);
    const decisions = await Promise.all(files.map((path) => readJson<AnalysisDecisionRecord>(path)));
    const audit = auditAnalysisDecisionBatch(decisions, minimumRoutable);
    if (!audit.meetsMinimum) {
      throw new Error(
        `Analysis batch has ${audit.routableCount} routable decisions; at least ${audit.minimumRoutable} are required. ` +
        'Reverify the strongest candidates with authoritative evidence, rebuild their decisions, and audit the complete batch again.',
      );
    }
    console.log(JSON.stringify({ ...audit, files }, null, 2));
    return;
  }
  if (command === 'accept-analysis') {
    const decision = await readJson<AnalysisDecisionRecord>(argument(3, 'analysis result file'));
    await acceptAnalysisDecision(root, decision);
    console.log(JSON.stringify({ accepted: decision.id, route: decision.route }, null, 2));
    return;
  }
  if (command === 'agent-4-prepare') {
    await runAnalysisQueueStage(root);
    const pending = await listPendingCopyTasks(root);
    const reports = await writeObservablePipelineReports(root);
    console.log(JSON.stringify({ agent: 4, pendingCount: pending.length, pending, reports }, null, 2));
    return;
  }
  if (command === 'copy-pending') {
    console.log(JSON.stringify(await listPendingCopyTasks(root), null, 2));
    return;
  }
  if (command === 'accept-copy') {
    const draft = await readJson<ContentDraftRecord>(argument(3, 'content draft file'));
    await acceptContentDraft(root, draft);
    console.log(JSON.stringify({ accepted: draft.id, createdVideoJobs: 0 }, null, 2));
    return;
  }
  if (command === 'agent-5-prepare') {
    const pending = await listPendingVisualTasks(root);
    const reports = await writeObservablePipelineReports(root);
    console.log(JSON.stringify({ agent: 5, pendingCount: pending.length, pending, reports }, null, 2));
    return;
  }
  if (command === 'visual-pending') {
    console.log(JSON.stringify(await listPendingVisualTasks(root), null, 2));
    return;
  }
  if (command === 'accept-visual') {
    const plan = await readJson<VisualPlanRecord>(argument(3, 'visual plan file'));
    await acceptVisualPlan(root, plan);
    console.log(JSON.stringify({ accepted: plan.id, createdVideoJobs: 0 }, null, 2));
    return;
  }
  if (command === 'agent-6-prepare') {
    const preparation = await prepareProductionPackages(root);
    const pending = await listPendingProductionTasks(root);
    const reports = await writeObservablePipelineReports(root);
    console.log(JSON.stringify({ agent: 6, preparation, pendingCount: pending.length, reports }, null, 2));
    return;
  }
  if (command === 'agent-6-render') {
    const preparation = await prepareProductionPackages(root);
    const musicPath = process.env.CREDDY_BACKGROUND_MUSIC_PATH?.trim();
    if (!musicPath || !(await pathExists(musicPath))) {
      throw new Error('Agent 6 requires an existing CREDDY_BACKGROUND_MUSIC_PATH');
    }
    const rendering = await runVideoStage({
      root,
      client: new VideoFactoryClient(process.env.VIDEO_FACTORY_BASE_URL?.trim() || 'http://127.0.0.1:4300'),
      musicPath,
    });
    const reports = await writeObservablePipelineReports(root);
    console.log(JSON.stringify({ agent: 6, preparation, rendering, reports }, null, 2));
    return;
  }
  if (command === 'agent-7-bank') {
    const videoCreated = await runContentBankHandoff(root);
    const slideshow = await runSlideshowContentBankHandoff(root);
    const bank = await Promise.all(
      (await listJsonFiles(safeDataPath(root, '09-pending-approval')))
        .map((path) => readJson<ContentBankRecord>(path)),
    );
    const reports = await writeObservablePipelineReports(root);
    const statusCounts = bank.reduce<Record<string, number>>((counts, item) => {
      counts[item.status] = (counts[item.status] ?? 0) + 1;
      return counts;
    }, {});
    console.log(JSON.stringify({
      agent: 7,
      videoCreated,
      slideshow,
      statusCounts,
      policy: 'Human review only: Agent 7 never approves, schedules, or publishes.',
      reports,
    }, null, 2));
    return;
  }
  if (command === 'content-pending') {
    console.log(JSON.stringify(await listPendingContentOpportunities(root), null, 2));
    return;
  }
  if (command === 'accept-content') {
    const content = await readJson<ContentPackageRecord>(argument(3, 'content package file'));
    const jobs = await acceptContentPackage(root, content);
    console.log(JSON.stringify({ accepted: content.id, videoJobs: jobs }, null, 2));
    return;
  }
  if (command === 'revision-pending') {
    console.log(JSON.stringify(await listPendingContentRevisions(root), null, 2));
    return;
  }
  if (command === 'accept-revision') {
    const content = await readJson<ContentPackageRecord>(argument(3, 'revised content package file'));
    const jobs = await acceptContentRevision(root, content);
    console.log(JSON.stringify({ acceptedRevision: content.id, videoJobs: jobs }, null, 2));
    return;
  }
  if (command === 'video') {
    const result = await runVideoStage({
      root,
      client: new VideoFactoryClient(
        process.env.VIDEO_FACTORY_BASE_URL?.trim() || 'http://127.0.0.1:4300',
      ),
      musicPath: process.env.CREDDY_BACKGROUND_MUSIC_PATH?.trim(),
    });
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'slack-review') {
    const token = process.env.SLACK_BOT_TOKEN?.trim();
    const channel = process.env.SLACK_APPROVAL_CHANNEL_ID?.trim();
    if (!token || !channel) {
      throw new Error('SLACK_BOT_TOKEN, SLACK_APPROVAL_CHANNEL_ID, and DASHBOARD_BASE_URL are required');
    }
    const dashboardUrl = requireStableDashboardBaseUrl();
    console.log(JSON.stringify(await runSlackReviewStage(root, new SlackClient(token, channel), dashboardUrl), null, 2));
    return;
  }
  if (command === 'bank') {
    console.log(JSON.stringify({ created: await runContentBankHandoff(root) }, null, 2));
    return;
  }
  if (command === 'approve') {
    const approval = await readJson<{
      id: string;
      approvedBy: string;
      destinations: Array<{
        format: 'text_music' | 'narrated';
        platform: 'instagram' | 'tiktok';
        account: string;
        scheduledFor: string;
      }>;
    }>(argument(3, 'approval input file'));
    console.log(JSON.stringify(await approveContentBankItem(root, approval), null, 2));
    return;
  }
  if (command === 'reject-bank') {
    const rejected = await rejectContentBankItem(root, {
      id: argument(3, 'Content Bank id'),
      rejectedBy: argument(4, 'reviewer'),
      reason: argument(5, 'rejection reason'),
    });
    const reports = await writeObservablePipelineReports(root);
    console.log(JSON.stringify({ rejected, reports }, null, 2));
    return;
  }
  if (command === 'publish' || command === 'agent-8-publish') {
    const key = process.env.BLOTATO_API_KEY?.trim();
    if (!key) throw new Error('BLOTATO_API_KEY is required for publishing');
    const publishing = await runPublishStage(
      root,
      new BlotatoClient(key),
      new Date(),
      Number(process.env.CREDDY_PUBLISH_LEAD_MINUTES || 15),
    );
    const reports = await writeObservablePipelineReports(root);
    console.log(JSON.stringify({
      agent: 8,
      publishing,
      policy: 'Publishes only human-approved scheduled destinations; never approves content.',
      reports,
    }, null, 2));
    return;
  }
  throw new Error(`Unknown Creddy pipeline command: ${command}`);
}

main().catch((error) => {
  console.error((error as Error).message);
  process.exitCode = 1;
});
