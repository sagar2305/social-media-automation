import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { CREDDY_DISCOVERY_PROFILE } from './config.js';
import { selectEditorialPortfolio } from './analysis-stage.js';
import {
  listJsonFiles,
  pathExists,
  readJson,
  safeDataPath,
} from './pipeline-store.js';
import type {
  AnalysisDecisionRecord,
  AnalysisPerformanceFeedbackRecord,
  AnalysisTaskRecord,
  CanonicalNewsRecord,
  ContentBankRecord,
  ContentDraftRecord,
  ContentPackageRecord,
  DiscoveryRunRecord,
  PipelineRunManifest,
  RawArticleRecord,
  RejectedArticleRecord,
  VisualPlanRecord,
  VideoJobRecord,
} from './pipeline-types.js';

function cell(value: unknown): string {
  return String(value ?? '').replaceAll('|', '\\|').replace(/\s+/g, ' ').trim();
}

async function writeMarkdown(path: string, markdown: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${markdown.trim()}\n`, 'utf8');
}

async function latestManifest(root: string, stage: PipelineRunManifest['stage']): Promise<PipelineRunManifest | undefined> {
  const manifests = await Promise.all(
    (await listJsonFiles(safeDataPath(root, 'manifests'))).map((path) => readJson<PipelineRunManifest>(path)),
  );
  return manifests.filter((item) => item.stage === stage).sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

async function latestProductiveManifest(
  root: string,
  stage: PipelineRunManifest['stage'],
): Promise<PipelineRunManifest | undefined> {
  const manifests = await Promise.all(
    (await listJsonFiles(safeDataPath(root, 'manifests'))).map((path) => readJson<PipelineRunManifest>(path)),
  );
  return manifests
    .filter((item) => item.stage === stage && item.outputCount > 0)
    .sort((a, b) => b.startedAt.localeCompare(a.startedAt))[0];
}

export async function writeObservablePipelineReports(root: string): Promise<string[]> {
  const outputRoot = safeDataPath(root, 'reports', 'latest');
  const written: string[] = [];

  const discoveryFiles = await listJsonFiles(safeDataPath(root, '00-discovery'));
  const discovery = discoveryFiles.length
    ? await readJson<DiscoveryRunRecord>(discoveryFiles.at(-1)!)
    : undefined;
  const rawRecords = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '01-raw'))).map((path) => readJson<RawArticleRecord>(path)),
  );
  const rawById = new Map(rawRecords.map((item) => [item.id, item]));
  const collection = await latestManifest(root, 'collection');
  const productiveCollection = await latestProductiveManifest(root, 'collection');
  const usage = collection?.providerUsage?.firecrawl;
  const discoveryCandidates = discovery?.candidates ?? [];
  const dispositionCount = (value: DiscoveryRunRecord['candidates'][number]['disposition']): number =>
    discoveryCandidates.filter((item) => item.disposition === value).length;
  const selectedDispositions = new Set<DiscoveryRunRecord['candidates'][number]['disposition']>([
    'selected_for_scrape',
    'stored_raw',
    'unchanged',
    'scrape_failed',
  ]);
  const selectedCandidates = discoveryCandidates.filter((item) => selectedDispositions.has(item.disposition));
  const selectedCoreCount = selectedCandidates.filter((item) => item.discoveryClass === 'core').length;
  const selectedAdjacentCount = selectedCandidates.filter((item) => item.discoveryClass === 'adjacent').length;
  const selectedPublisherCounts = selectedCandidates.reduce<Record<string, number>>((counts, item) => {
    const publisher = item.publisherKey ?? 'unknown';
    counts[publisher] = (counts[publisher] ?? 0) + 1;
    return counts;
  }, {});
  const selectedEventCounts = selectedCandidates.reduce<Record<string, number>>((counts, item) => {
    const event = item.eventFingerprint?.trim();
    if (!event) return counts;
    counts[event] = (counts[event] ?? 0) + 1;
    return counts;
  }, {});
  const selectedIntentCounts = selectedCandidates.reduce<Record<string, number>>((counts, item) => {
    const intent = item.queryIntent ?? 'unclassified';
    counts[intent] = (counts[intent] ?? 0) + 1;
    return counts;
  }, {});
  const publisherEntries = Object.entries(selectedPublisherCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const eventEntries = Object.entries(selectedEventCounts)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const maximumPublisherCount = Math.max(0, ...publisherEntries.map(([, count]) => count));
  const maximumEventCount = Math.max(0, ...eventEntries.map(([, count]) => count));
  const lowRelevanceCount = discoveryCandidates.filter((item) => item.discoveryClass === 'low_relevance').length;
  const emergingDomains = [...(discovery?.candidates ?? [])]
    .filter((item) => item.sourceId.startsWith('topic-search:'))
    .reduce<Record<string, number>>((counts, item) => {
      try {
        const domain = new URL(
          (item.rawRecordId ? rawById.get(item.rawRecordId)?.canonicalUrl : undefined) ?? item.url,
        ).hostname.replace(/^www\./, '');
        counts[domain] = (counts[domain] ?? 0) + 1;
      } catch {
        // Malformed URLs are already excluded by collection; keep reports resilient.
      }
      return counts;
    }, {});
  const collectionLines = [
    '# 01 — Discovery and Firecrawl collection',
    '',
    `Generated: ${new Date().toISOString()}`,
    `Latest run: ${collection?.runId ?? 'none'}`,
    `Candidates: ${discovery?.candidateCount ?? 0}; scrape limit: ${discovery?.scrapeLimit ?? 0}; stored: ${collection?.outputCount ?? 0}; skipped: ${collection?.skippedCount ?? 0}; failed: ${collection?.failedCount ?? 0}`,
    `Selection: selected=${selectedCandidates.length} (core=${selectedCoreCount}, adjacent=${selectedAdjacentCount}); low relevance=${lowRelevanceCount}; deferred capacity=${dispositionCount('deferred_capacity')}; deferred low relevance=${dispositionCount('deferred_low_relevance')}; recently checked=${dispositionCount('recently_checked')}`,
    `Selection publisher diversity: ${publisherEntries.length} pre-scrape publisher lanes (best-effort target ${CREDDY_DISCOVERY_PROFILE.targetPublishers}); maximum selected per lane ${maximumPublisherCount} (hard limit ${CREDDY_DISCOVERY_PROFILE.maxPerPublisher}).`,
    `Selection event diversity: ${eventEntries.length} classified pre-scrape event fingerprints; maximum selected per event ${maximumEventCount} (hard limit ${CREDDY_DISCOVERY_PROFILE.maxPerEvent}); blank/legacy fingerprints are excluded from this audit.`,
    `Editorial intent proxy: timely=${selectedIntentCounts.timely ?? 0}, evergreen=${selectedIntentCounts.evergreen ?? 0}, experimental=${selectedIntentCounts.experimental ?? 0}, unclassified source-listing=${selectedIntentCounts.unclassified ?? 0}. The ${CREDDY_DISCOVERY_PROFILE.editorialTarget.timely * 100}/${CREDDY_DISCOVERY_PROFILE.editorialTarget.evergreen * 100}/${CREDDY_DISCOVERY_PROFILE.editorialTarget.experimental * 100} mix is a reporting target, not a hard selection rule; source-listing candidates are unclassified.`,
    `Total raw article records retained across runs: ${rawRecords.length}`,
    `Most recent productive collection: ${productiveCollection?.runId ?? 'none'} (${productiveCollection?.outputCount ?? 0} raw records stored)`,
    '',
    '## Configured source execution',
    '',
    '| Source | Configured URL | Provider | Status | Article candidates | Error/fallback detail |',
    '|---|---|---|---|---:|---|',
    ...(discovery?.sourceResults ?? []).map((item) =>
      `| ${cell(item.sourceName)} | ${cell(item.configuredUrl)} | ${cell(item.provider)} | ${cell(item.status)} | ${item.discoveredCount} | ${cell(item.error ?? '')} |`),
    '',
    '## Additional topic searches',
    '',
    `Inactive rotating query IDs this window: ${(discovery?.inactiveTopicSearchIds ?? []).join(', ') || 'none'}`,
    '',
    '| Query ID | Intent | Query | Provider | Status | New candidates | Error |',
    '|---|---|---|---|---|---:|---|',
    ...(discovery?.topicSearchResults ?? []).map((item) =>
      `| ${cell(item.id ?? 'legacy')} | ${cell(item.intent ?? 'unknown')} | ${cell(item.query)} | ${cell(item.provider)} | ${cell(item.status)} | ${item.discoveredCount} | ${cell(item.error ?? '')} |`),
    '',
    '## Provider usage',
    '',
    usage
      ? `Firecrawl requests: ${usage.scrapeRequests} scrape (${usage.scrapeSuccesses} successful, ${usage.scrapeFailures} failed) and ${usage.searchRequests} search (${usage.searchSuccesses} successful, ${usage.searchFailures} failed).`
      : 'Firecrawl request accounting unavailable for this legacy run.',
    usage?.reportedCredits === undefined
      ? 'Exact Firecrawl credits: unavailable because the provider did not report a credit value in any response.'
      : usage.creditsComplete
        ? `Exact Firecrawl credits reported for all successful responses: ${usage.reportedCredits}.`
        : `Partial Firecrawl credit total reported by ${usage.responsesReportingCredits} responses: ${usage.reportedCredits}. This is not the full run cost.`,
    '',
    '> Request counts are exact for this run. A credit total is labelled exact only when Firecrawl reports credits for every successful response.',
    '',
    '## Selection diversity audit',
    '',
    '| Pre-scrape publisher lane | Selected |',
    '|---|---:|',
    ...publisherEntries.map(([publisher, count]) => `| ${cell(publisher)} | ${count} |`),
    '',
    '| Pre-scrape event fingerprint | Selected |',
    '|---|---:|',
    ...eventEntries.map(([event, count]) => `| ${cell(event)} | ${count} |`),
    '',
    '## Emerging source observations',
    '',
    '> These domains were found by focused searches. They are observations only and are never added to the trusted source registry automatically.',
    '',
    '| Domain | Candidates this run |',
    '|---|---:|',
    ...Object.entries(emergingDomains).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([domain, count]) => `| ${cell(domain)} | ${count} |`),
    '',
    '## Discovered article ledger',
    '',
    '| Source | Article/title | Selection publisher lane | Resolved publisher | Query intent | Selection event | Resolved event | Discovery class | Selection reason | URL | Disposition |',
    '|---|---|---|---|---|---|---|---|---|---|---|',
    ...discoveryCandidates.map((item) => {
      const raw = item.rawRecordId ? rawById.get(item.rawRecordId) : undefined;
      return `| ${cell(item.sourceName)} | ${cell(item.discoveredTitle || raw?.title || '(title available after article scrape)')} | ${cell(item.publisherKey ?? 'unknown')} | ${cell(item.resolvedPublisherKey ?? 'unresolved')} | ${cell(item.queryIntent ?? 'unclassified')} | ${cell(item.eventFingerprint ?? 'legacy-unclassified')} | ${cell(item.resolvedEventFingerprint ?? 'unresolved')} | ${cell(item.discoveryClass ?? 'legacy')} | ${cell(item.selectionReason ?? '')} | ${cell(item.url)} | ${cell(item.disposition)} |`;
    }),
  ];
  const collectionPath = safeDataPath(outputRoot, '01-discovery-and-collection.md');
  await writeMarkdown(collectionPath, collectionLines.join('\n'));
  written.push(collectionPath);

  // Keep an immutable, run-scoped copy as well as the convenient `latest`
  // report. This lets the team audit exactly what Agent 01 saw on any run
  // without relying on the Codex chat transcript.
  if (collection?.runId) {
    const runReportPath = safeDataPath(
      root,
      'reports',
      'runs',
      collection.runId,
      '01-discovery-and-collection.md',
    );
    await writeMarkdown(runReportPath, collectionLines.join('\n'));
    written.push(runReportPath);

    const runRawRecords = rawRecords.filter((record) => record.runId === collection.runId);
    const rawIndexLines = [
      '# Agent 01 — Raw article index',
      '',
      `Run: ${collection.runId}`,
      `Generated: ${new Date().toISOString()}`,
      `New raw records: ${runRawRecords.length}`,
      '',
      '> Full extracted article text and provider metadata are stored in the corresponding JSON records under `01-raw/<date>/<run-id>/`.',
      '',
      '| Source | Title | Published | Fetched | Characters | Canonical URL | Raw record ID |',
      '|---|---|---|---|---:|---|---|',
      ...runRawRecords.map((record) =>
        `| ${cell(record.sourceName)} | ${cell(record.title || '(untitled)')} | ${cell(record.publishedAt ?? '')} | ${cell(record.fetchedAt)} | ${record.markdown.length} | ${cell(record.canonicalUrl)} | ${cell(record.id)} |`),
    ];
    const rawIndexPath = safeDataPath(
      root,
      'reports',
      'runs',
      collection.runId,
      '01-raw-article-index.md',
    );
    await writeMarkdown(rawIndexPath, rawIndexLines.join('\n'));
    written.push(rawIndexPath);
  }

  const canonical = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '03-canonical-news', 'approved')))
      .map((path) => readJson<CanonicalNewsRecord>(path)),
  );
  const filtering = await latestManifest(root, 'filtering');
  const dedupe = await latestManifest(root, 'deduplication');
  const productiveFiltering = await latestProductiveManifest(root, 'filtering');
  const productiveDedupe = await latestProductiveManifest(root, 'deduplication');
  const rejected = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '03-canonical-news', 'rejected')))
      .map((path) => readJson<RejectedArticleRecord>(path)),
  );
  const archivedDuplicates = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '03-canonical-news', 'archived')))
      .map((path) => readJson<RejectedArticleRecord>(path)),
  );
  const quarantinedCount = (
    await listJsonFiles(safeDataPath(root, '03-canonical-news', 'quarantined'))
  ).length;
  const rejectionCounts = [...rejected, ...archivedDuplicates].reduce<Record<string, number>>(
    (counts, item) => ({ ...counts, [item.reason]: (counts[item.reason] ?? 0) + 1 }),
    {},
  );
  const verificationCounts = canonical.reduce<Record<string, number>>(
    (counts, item) => {
      const status = item.verification?.status ?? 'legacy_unclassified';
      counts[status] = (counts[status] ?? 0) + 1;
      return counts;
    },
    {},
  );
  const latestRetained = canonical.filter((item) =>
    Boolean(filtering?.runId) && item.qualification.filterRunId === filtering?.runId,
  );
  const latestRejected = rejected.filter((item) =>
    Boolean(filtering?.runId) && item.filterRunId === filtering?.runId,
  );
  const latestDuplicates = archivedDuplicates.filter((item) =>
    Boolean(dedupe?.runId) && item.dedupeRunId === dedupe?.runId,
  );
  const filterLines = [
    '# Agent 02 — Cleaning, verification, and deduplication', '',
    `Generated: ${new Date().toISOString()}`,
    `Latest filtering: input ${filtering?.inputCount ?? 0}, qualified ${filtering?.outputCount ?? 0}, skipped/rejected ${filtering?.skippedCount ?? 0}, failed ${filtering?.failedCount ?? 0}`,
    `Latest dedupe: input ${dedupe?.inputCount ?? 0}, new canonical ${dedupe?.outputCount ?? 0}, duplicate/already processed ${dedupe?.skippedCount ?? 0}`,
    `Most recent productive filtering: ${productiveFiltering?.runId ?? 'none'} (${productiveFiltering?.outputCount ?? 0} newly qualified)`,
    `Most recent productive dedupe: ${productiveDedupe?.runId ?? 'none'} (${productiveDedupe?.outputCount ?? 0} new canonical records)` ,
    `Canonical articles retained: ${canonical.length}; rejected/non-article: ${rejected.length}; duplicate records archived as evidence: ${archivedDuplicates.length}; legacy canonical records recoverably quarantined: ${quarantinedCount}`,
    `Verification status: ${Object.entries(verificationCounts).map(([status, count]) => `${status}=${count}`).join(', ') || 'none'}`,
    '',
    '> Agent 2 does not claim that a single-source article is true. It marks verification status and carries evidence forward for Agent 3.',
    '',
    '## Latest calibration batch — retained',
    '',
    `Retained: ${latestRetained.length}`,
    '',
    '| Source | Article | Why retained | URL | Record ID |',
    '|---|---|---|---|---|',
    ...latestRetained.map((item) => `| ${cell(item.sourceName)} | ${cell(item.title)} | ${cell(item.qualification.matchedKeywords.join(', '))} | ${cell(item.canonicalUrl)} | ${cell(item.id)} |`),
    '',
    '## Latest calibration batch — rejected',
    '',
    `Rejected: ${latestRejected.length}; duplicate evidence archived: ${latestDuplicates.length}`,
    '',
    '| Source | Article | Why rejected | URL | Record ID |',
    '|---|---|---|---|---|',
    ...[...latestRejected, ...latestDuplicates].map((item) => {
      const raw = rawById.get(item.sourceRecordId);
      return `| ${cell(raw?.sourceName ?? 'unknown')} | ${cell(raw?.title ?? '(title unavailable)')} | ${cell(`${item.reason}: ${item.details ?? ''}`)} | ${cell(item.canonicalUrl)} | ${cell(item.sourceRecordId)} |`;
    }),
    '',
    '## Clean canonical article list',
    '', '| Source | Canonical article | Matched keywords | Evidence | Verification | Fact-check required | URL |', '|---|---|---|---|---:|---|---|',
    ...canonical.map((item) => `| ${cell(item.sourceName)} | ${cell(item.title)} | ${cell(item.qualification.matchedKeywords.join(', '))} | ${item.evidenceRecordIds.length} record(s) / ${item.verification?.evidenceSourceIds.length ?? 1} source(s) | ${cell(item.verification?.status ?? 'legacy_unclassified')} | ${item.verification?.requiresFactCheck ?? true} | ${cell(item.canonicalUrl)} |`),
    '',
    '## Rejection and duplicate summary',
    '',
    '| Reason | Count |',
    '|---|---:|',
    ...Object.entries(rejectionCounts).sort().map(([reason, count]) => `| ${cell(reason)} | ${count} |`),
    '',
    '## Rejected records',
    '',
    '| Reason | URL | Details |',
    '|---|---|---|',
    ...[...rejected, ...archivedDuplicates]
      .sort((a, b) => String(b.rejectedAt ?? '').localeCompare(String(a.rejectedAt ?? '')))
      .slice(0, 100)
      .map((item) => `| ${cell(item.reason)} | ${cell(item.canonicalUrl)} | ${cell(item.details ?? '')} |`),
  ];
  const filterPath = safeDataPath(outputRoot, '02-filtering-and-deduplication.md');
  await writeMarkdown(filterPath, filterLines.join('\n'));
  written.push(filterPath);

  const agent2RunId = dedupe?.runId ?? filtering?.runId;
  if (agent2RunId) {
    const runFilterPath = safeDataPath(
      root,
      'reports',
      'runs',
      agent2RunId,
      '02-filtering-and-deduplication.md',
    );
    await writeMarkdown(runFilterPath, filterLines.join('\n'));
    written.push(runFilterPath);

    const decisionRows = [
      ...canonical.map((item) => ({
        disposition: 'canonical',
        source: item.sourceName,
        title: item.title,
        reason: `matched: ${item.qualification.matchedKeywords.join(', ') || 'travel-rewards context'}`,
        verification: item.verification?.status ?? 'legacy_unclassified',
        url: item.canonicalUrl,
        id: item.canonicalId,
      })),
      ...rejected.map((item) => {
        const raw = rawById.get(item.sourceRecordId);
        return {
          disposition: 'rejected',
          source: raw?.sourceName ?? 'unknown',
          title: raw?.title ?? '(title unavailable)',
          reason: `${item.reason}: ${item.details ?? ''}`,
          verification: 'not_advanced',
          url: item.canonicalUrl,
          id: item.id,
        };
      }),
      ...archivedDuplicates.map((item) => {
        const raw = rawById.get(item.sourceRecordId);
        return {
          disposition: 'duplicate_archived',
          source: raw?.sourceName ?? 'unknown',
          title: raw?.title ?? '(title unavailable)',
          reason: `${item.reason}: ${item.details ?? ''}`,
          verification: 'attached_as_evidence',
          url: item.canonicalUrl,
          id: item.id,
        };
      }),
    ];
    const ledgerLines = [
      '# Agent 02 — Complete decision ledger',
      '',
      `Run: ${agent2RunId}`,
      `Generated: ${new Date().toISOString()}`,
      `Canonical: ${canonical.length}; rejected: ${rejected.length}; duplicates archived: ${archivedDuplicates.length}`,
      '',
      '> This ledger is cumulative and contains every currently retained Agent 2 disposition. The JSON files remain the source of truth.',
      '',
      '| Disposition | Source | Article | Reason / matched criteria | Verification | URL | Record ID |',
      '|---|---|---|---|---|---|---|',
      ...decisionRows.map((item) =>
        `| ${cell(item.disposition)} | ${cell(item.source)} | ${cell(item.title)} | ${cell(item.reason)} | ${cell(item.verification)} | ${cell(item.url)} | ${cell(item.id)} |`),
    ];
    const ledgerPath = safeDataPath(root, 'reports', 'runs', agent2RunId, '02-decision-ledger.md');
    await writeMarkdown(ledgerPath, ledgerLines.join('\n'));
    written.push(ledgerPath);
  }

  const allDecisions = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '04-analysis-queue', 'completed')))
      .map((path) => readJson<AnalysisDecisionRecord>(path)),
  );
  const activeCanonicalIds = new Set(canonical.map((item) => item.canonicalId));
  const decisions = allDecisions.filter((item) => activeCanonicalIds.has(item.canonicalId));
  decisions.sort((a, b) =>
    (b.editorialPriorityScore ?? -1) - (a.editorialPriorityScore ?? -1) ||
    (b.viralPotential?.score ?? -1) - (a.viralPotential?.score ?? -1) ||
    (b.productFitScore ?? -1) - (a.productFitScore ?? -1) ||
    (b.popularityScore ?? -1) - (a.popularityScore ?? -1) ||
    b.importanceScore - a.importanceScore || b.confidenceScore - a.confidenceScore);
  const portfolio = selectEditorialPortfolio(decisions, 5);
  const verificationQueue = decisions.filter((item) =>
    item.rubricVersion === 'creddy-ranking-v3' &&
    item.verificationState !== 'ready' &&
    (item.editorialDisposition === 'produce' || item.editorialDisposition === 'evergreen'));
  const performanceFeedback = await Promise.all(
    (await listJsonFiles(safeDataPath(root, 'feedback', 'agent-03')))
      .map((path) => readJson<AnalysisPerformanceFeedbackRecord>(path)),
  );
  const decisionByCanonicalId = new Map(decisions.map((item) => [item.canonicalId, item]));
  const pendingAnalysis = (await Promise.all(
    (await listJsonFiles(safeDataPath(root, '04-analysis-queue', 'pending')))
      .map((path) => readJson<AnalysisTaskRecord>(path)),
  )).filter((item) => activeCanonicalIds.has(item.canonicalId));
  const routeCounts = decisions.reduce<Record<string, number>>((counts, item) => {
    counts[item.route] = (counts[item.route] ?? 0) + 1;
    return counts;
  }, {});
  const rankingLines = [
    '# Agent 03 — Ranking, popularity, confidence, and routing', '',
    `Generated: ${new Date().toISOString()}`,
    `Active canonical inputs: ${canonical.length}; completed rankings: ${decisions.length}; pending rankings: ${pendingAnalysis.length}`,
    `Routes: ${Object.entries(routeCounts).map(([route, count]) => `${route}=${count}`).join(', ') || 'none'}`,
    '',
    '> Viral potential and channel scores are editorial predictions, not measured views. Legacy rows show `n/a` until ranking v3 re-analysis.',
    '> Editorial priority is independent of verification readiness. Nothing enters production until its operational route is ready.',
    '> Slack review is allowed only for a high-importance material conflict that changes the message after verification is exhausted.',
    '',
    '| Rank | Headline | Priority | Viral | Product fit | Freshness | Confidence | Hook | Best channel | Verification | Route |',
    '|---:|---|---:|---:|---:|---:|---:|---|---|---|---|',
    ...decisions.map((item, index) => {
      const channels = item.channelScores ? Object.entries(item.channelScores).sort((a, b) => b[1] - a[1])[0] : undefined;
      return `| ${index + 1} | ${cell(item.headline)} | ${item.editorialPriorityScore ?? 'n/a'} | ${item.viralPotential?.score ?? item.popularityScore ?? 'n/a'} | ${item.productFitScore ?? 'n/a'} | ${item.freshnessScore ?? 'n/a'} | ${item.confidenceScore} | ${cell(item.hookType ?? 'legacy')} | ${cell(channels ? `${channels[0]} (${channels[1]})` : 'n/a')} | ${cell(item.verificationState ?? 'legacy')} | ${cell(item.route)} |`;
    }),
    '',
    `## Recommended five-story slate (${portfolio.length})`,
    '',
    '> This is the highest-upside diversified editorial slate. Items that still require verification remain blocked from production.',
    '',
    '| Slate | Headline | Category | Priority | Viral | Hook | Verification | Operational route |',
    '|---:|---|---|---:|---:|---|---|---|',
    ...portfolio.map((item, index) => `| ${index + 1} | ${cell(item.headline)} | ${cell(item.portfolioCategory)} | ${item.editorialPriorityScore} | ${item.viralPotential?.score} | ${cell(item.hookType)} | ${cell(item.verificationState)} | ${cell(item.route)} |`),
    '',
    `## Verification queue (${verificationQueue.length})`,
    '',
    '| Priority | Headline | Verification needed |',
    '|---:|---|---|',
    ...verificationQueue.map((item) => `| ${item.editorialPriorityScore} | ${cell(item.headline)} | ${cell(item.verificationRequirements?.join('; '))} |`),
    '',
    `## Editorial and performance feedback (${performanceFeedback.length})`,
    '',
    '> Feedback is append-only local data. Predicted scores can be compared with observed channel results after content is published.',
    '',
    '| Recorded | Headline | Channel | Predicted channel score | Verdict | Views | Shares | Saves | Clicks | Conversions | Note |',
    '|---|---|---|---:|---|---:|---:|---:|---:|---:|---|',
    ...performanceFeedback.map((item) => {
      const decision = decisionByCanonicalId.get(item.canonicalId);
      const predicted = item.channel === 'instagram_tiktok'
        ? decision?.channelScores?.instagramTikTok
        : item.channel === 'blog_seo'
          ? decision?.channelScores?.blogSeo
          : item.channel === 'newsletter'
            ? decision?.channelScores?.newsletter
            : decision?.channelScores?.evergreen;
      return `| ${cell(item.recordedAt)} | ${cell(decision?.headline ?? item.canonicalId)} | ${cell(item.channel)} | ${predicted ?? 'n/a'} | ${cell(item.editorialVerdict ?? '')} | ${item.views ?? ''} | ${item.shares ?? ''} | ${item.saves ?? ''} | ${item.clicks ?? ''} | ${item.conversions ?? ''} | ${cell(item.note ?? '')} |`;
    }),
    '',
    `## Awaiting scheduled ranking (${pendingAnalysis.length})`,
    '',
    '| Source | Article | Matched keywords | URL |',
    '|---|---|---|---|',
    ...pendingAnalysis.map((item) => `| ${cell(item.article.sourceName)} | ${cell(item.article.title || '(missing title)')} | ${cell(item.article.qualification.matchedKeywords.join(', '))} | ${cell(item.article.canonicalUrl)} |`),
  ];
  const rankingPath = safeDataPath(outputRoot, '03-ranking-and-routing.md');
  await writeMarkdown(rankingPath, rankingLines.join('\n'));
  written.push(rankingPath);

  // Preserve an immutable Agent 03 snapshot for every analysis-queue run.
  // The cumulative ledger makes every score and routing reason reviewable
  // without depending on the Codex task transcript.
  const analysis = await latestManifest(root, 'analysis');
  if (analysis?.runId) {
    const runRankingPath = safeDataPath(
      root,
      'reports',
      'runs',
      analysis.runId,
      '03-ranking-and-routing.md',
    );
    await writeMarkdown(runRankingPath, rankingLines.join('\n'));
    written.push(runRankingPath);

    const rankingLedgerLines = [
      '# Agent 03 — Complete ranking decision ledger',
      '',
      `Run: ${analysis.runId}`,
      `Generated: ${new Date().toISOString()}`,
      `Completed rankings: ${decisions.length}; pending: ${pendingAnalysis.length}`,
      `Routes: ${Object.entries(routeCounts).map(([route, count]) => `${route}=${count}`).join(', ') || 'none'}`,
      '',
      '> Scores are cumulative for all currently active canonical articles. JSON decision records remain the source of truth.',
      '',
      '| Rank | Headline | Priority | Viral | Product fit | Importance | Freshness | Confidence | Editorial disposition | Verification | Route | Hook | Channel scores | Evidence IDs |',
      '|---:|---|---:|---:|---:|---:|---:|---:|---|---|---|---|---|---|',
      ...decisions.map((item, index) =>
        `| ${index + 1} | ${cell(item.headline)} | ${item.editorialPriorityScore ?? 'n/a'} | ${item.viralPotential?.score ?? item.popularityScore ?? 'n/a'} | ${item.productFitScore ?? 'n/a'} | ${item.importanceScore} | ${item.freshnessScore ?? 'n/a'} | ${item.confidenceScore} | ${cell(item.editorialDisposition ?? 'legacy')} | ${cell(item.verificationState ?? 'legacy')} | ${cell(item.route)} | ${cell(item.hookType ?? 'legacy')} | ${cell(item.channelScores ? JSON.stringify(item.channelScores) : 'n/a')} | ${cell(item.evidenceRecordIds.join(', '))} |`),
    ];
    const rankingLedgerPath = safeDataPath(
      root,
      'reports',
      'runs',
      analysis.runId,
      '03-ranking-decision-ledger.md',
    );
    await writeMarkdown(rankingLedgerPath, rankingLedgerLines.join('\n'));
    written.push(rankingLedgerPath);
  }

  const opportunities = (await Promise.all(
    (await listJsonFiles(safeDataPath(root, '05-content-opportunities')))
      .map((path) => readJson<AnalysisDecisionRecord>(path)),
  )).filter((item) =>
    activeCanonicalIds.has(item.canonicalId) &&
    ['auto_process', 'evergreen_queue'].includes(item.route),
  );
  const drafts = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '06-content-drafts')))
      .filter((path) => !/\/(scripts|captions|briefs|legacy)\//.test(path))
      .map((path) => readJson<ContentDraftRecord>(path)),
  );
  const packages = (await listJsonFiles(safeDataPath(root, '06-content-packages')))
    .filter((path) => !/\/(scripts|captions|images|briefs)\//.test(path));
  const opportunityIds = new Set(opportunities.map((opportunity) => opportunity.id));
  const conceptDrafts = drafts.filter((draft) =>
    opportunityIds.has(draft.analysisId) && draft.copyVersion === 'creddy-copy-v2' && draft.conceptPack);
  const contentLines = [
    '# Agent 04 — Scripts, captions, CTA, and production briefs', '',
    `Generated: ${new Date().toISOString()}`,
    `Content opportunities: ${opportunities.length}`,
    `Completed copy drafts: ${conceptDrafts.length}`,
    `Pending copy drafts: ${Math.max(0, opportunities.length - conceptDrafts.length)}`,
    '',
    '> Agent 04 writes copy only. It does not generate images, choose mascot expressions, create Video Factory jobs, render, approve, schedule, or publish.',
    '',
    '| Hook | Selected style | Slot | Text scenes | Narration words | Instagram caption | TikTok caption | CTA | Sources |',
    '|---|---|---|---:|---:|---|---|---|---:|',
    ...drafts.map((draft) => {
      const selected = draft.conceptPack?.candidates.find((candidate) =>
        candidate.id === draft.conceptPack?.selectedCandidateId);
      return `| ${cell(draft.hook)} | ${cell(selected?.style ?? 'legacy')} | ${cell(draft.slot)} | ${draft.textScenes.length} | ${draft.narrationScript.trim().split(/\s+/).filter(Boolean).length} | ${cell(draft.instagramCaption)} | ${cell(draft.tiktokCaption)} | ${cell(`${draft.cta.label} → ${draft.cta.deepLink}`)} | ${draft.sourceUrls.length} |`;
    }),
    '',
    '## Concept candidates and selection',
    '',
    '> Accepted copy-v2 records passed structural claim references, numeric-token checks, guarded superlatives, display limits, fulfillment excerpts, and banned-phrase validation. Factual entailment remains an Agent 04 authoring and human-review responsibility.',
    '',
    ...conceptDrafts.flatMap((draft) => {
      const pack = draft.conceptPack!;
      return [
        `### ${cell(draft.hook)}`,
        '',
        `Selected: ${cell(pack.selectedCandidateId)} — ${cell(pack.selectionRationale)}`,
        `Promise resolved by slide ${pack.resolution.slideNumber}: ${cell(pack.resolution.explanation)}`,
        '',
        '| Candidate | Style | Concept | Promise | Claim fields | Decision |',
        '|---|---|---|---|---|---|',
        ...pack.candidates.map((candidate) => {
          const rejection = pack.rejectionReasons.find((item) => item.candidateId === candidate.id);
          return `| ${cell(candidate.id)} | ${cell(candidate.style)} | ${cell(candidate.concept)} | ${cell(candidate.promise)} | ${cell(candidate.supportingClaimFields.join(', '))} | ${rejection ? `Rejected: ${cell(rejection.reason)}` : 'Selected'} |`;
        }),
        '',
      ];
    }),
    '## Platform headline packs',
    '',
    '| Selected hook | Blog | Newsletter | YouTube | Thumbnail | YouTube Short | Instagram | TikTok |',
    '|---|---|---|---|---|---|---|---|',
    ...conceptDrafts.map((draft) => {
      const platforms = draft.conceptPack!.platforms;
      return `| ${cell(draft.hook)} | ${cell(platforms.blog.headline)} | ${cell(`${platforms.newsletter.subject} — ${platforms.newsletter.preheader}`)} | ${cell(platforms.youtubeLong.title)} | ${cell(platforms.youtubeLong.thumbnailPhrase)} | ${cell(platforms.youtubeShort.title)} | ${cell(platforms.instagram.coverHook)} | ${cell(platforms.tiktok.coverHook)} |`;
    }),
    '',
    '## Downstream legacy/output status',
    '',
    `Content packages: ${packages.length}`,
    `Pending human approval: ${(await listJsonFiles(safeDataPath(root, '09-pending-approval'))).length}`,
    `Approved: ${(await listJsonFiles(safeDataPath(root, '10-approved'))).length}`,
    `Scheduled: ${(await listJsonFiles(safeDataPath(root, '11-scheduled'))).length}`,
    `Published: ${(await listJsonFiles(safeDataPath(root, '12-published'))).length}`,
    '', 'Only Agent 3 routes `auto_process` and `evergreen_queue` can enter Agent 4.',
  ];
  const contentPath = safeDataPath(outputRoot, '04-content-writing.md');
  await writeMarkdown(contentPath, contentLines.join('\n'));
  written.push(contentPath);

  const visualPlans = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '06-visual-plans')))
      .map((path) => readJson<VisualPlanRecord>(path)),
  );
  const visualLines = [
    '# Agent 05 — Creddy visual direction', '',
    `Generated: ${new Date().toISOString()}`,
    `Completed Agent 04 drafts: ${drafts.length}`,
    `Completed visual plans: ${visualPlans.length}`,
    `Pending visual plans: ${Math.max(0, drafts.length - visualPlans.length)}`,
    '',
    '> Agent 05 plans visuals only. It does not generate/download images, create Video Factory jobs, render, approve, schedule, or publish.',
    '> Allowed character expressions use the complete approved Creddy library: neutral, waving, thinking, confused, idea, worried, surprised, sleepy, sad, wink, card, thumbs-up, guide, rewards, celebrate, curious, skeptical, pointing, happy, urgent.',
    '> Six-slide posts require at least five distinct visible expressions, forbid adjacent expression repeats, and end with one approved real Creddy phone-screen template.',
    '',
    '| Cover | Theme | Scenes | Expressions | Generated illustration scenes | Safety overlays |',
    '|---|---|---:|---|---:|---|',
    ...visualPlans.map((plan) => `| ${cell(plan.cover.headline)} | ${cell(plan.theme)} | ${plan.scenes.length} | ${cell(plan.scenes.map((scene) => scene.expression).join(', '))} | ${plan.scenes.filter((scene) => scene.background.mode === 'generated_illustration').length} | ${cell(plan.safetyOverlays.join('; '))} |`),
  ];
  const visualPath = safeDataPath(outputRoot, '05-visual-planning.md');
  await writeMarkdown(visualPath, visualLines.join('\n'));
  written.push(visualPath);

  const productionPackages = (await listJsonFiles(safeDataPath(root, '06-content-packages')))
    .filter((path) => !/\/(scripts|captions|images|briefs)\//.test(path) && /\/production-[^/]+\.json$/.test(path));
  const allVideoJobs = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '07-video-jobs')))
      .map((path) => readJson<VideoJobRecord>(path)),
  );
  const productionIds = new Set(productionPackages.map((path) => path.split('/').at(-1)!.replace(/\.json$/, '')));
  const productionJobs = allVideoJobs.filter((job) => productionIds.has(job.contentPackageId));
  const jobCounts = productionJobs.reduce<Record<string, number>>((counts, job) => {
    counts[job.status] = (counts[job.status] ?? 0) + 1;
    return counts;
  }, {});
  const productionLines = [
    '# Agent 06 — Video Factory production', '',
    `Generated: ${new Date().toISOString()}`,
    `Visual-plan inputs: ${visualPlans.length}`,
    `Production packages: ${productionPackages.length}`,
    `Video jobs: ${productionJobs.length} (${Object.entries(jobCounts).map(([status, count]) => `${status}=${count}`).join(', ') || 'none'})`,
    `Rendered text + music: ${productionJobs.filter((job) => job.format === 'text_music' && job.status === 'done').length}`,
    `Rendered narrated: ${productionJobs.filter((job) => job.format === 'narrated' && job.status === 'done').length}`,
    `Current-production failures: ${productionJobs.filter((job) => job.status === 'failed').length}`,
    '',
    '> Agent 06 creates exactly two videos per package and stops after rendering. Agent 07 performs the Content Bank handoff. Agent 06 does not approve, schedule, or publish.',
    '',
    '| Package | Format | Status | Video Factory job | Output | Error |',
    '|---|---|---|---|---|---|',
    ...productionJobs.map((job) => `| ${cell(job.contentPackageId)} | ${cell(job.format)} | ${cell(job.status)} | ${cell(job.videoFactoryJobId ?? '')} | ${cell(job.outputPath ?? '')} | ${cell(job.error ?? '')} |`),
  ];
  const productionPath = safeDataPath(outputRoot, '06-video-production.md');
  await writeMarkdown(productionPath, productionLines.join('\n'));
  written.push(productionPath);

  const productionContent = await Promise.all(
    productionPackages.map((path) => readJson<ContentPackageRecord>(path)),
  );
  const bankDirectories = [
    '09-pending-approval',
    '10-approved',
    '11-scheduled',
    '12-published',
    '13-rejected-content',
  ];
  const allBankRecords = (await Promise.all(
    bankDirectories.map(async (directory) => Promise.all(
      (await listJsonFiles(safeDataPath(root, directory)))
        .map((path) => readJson<ContentBankRecord>(path)),
    )),
  )).flat();
  const newestBankById = new Map<string, ContentBankRecord>();
  for (const record of allBankRecords) {
    const previous = newestBankById.get(record.id);
    if (!previous || record.createdAt >= previous.createdAt) newestBankById.set(record.id, record);
  }
  const reviewRows = productionContent.map((content) => ({
    content,
    bank: newestBankById.get(content.id),
    jobs: productionJobs.filter((job) => job.contentPackageId === content.id),
  }));
  const reviewStatusCounts = reviewRows.reduce<Record<string, number>>((counts, row) => {
    const status = row.bank?.status ?? 'waiting_for_video_pair';
    counts[status] = (counts[status] ?? 0) + 1;
    return counts;
  }, {});
  const reviewLines = [
    '# Agent 07 — Content Bank and human review', '',
    `Generated: ${new Date().toISOString()}`,
    `Current production packages: ${reviewRows.length}`,
    `Status: ${Object.entries(reviewStatusCounts).map(([status, count]) => `${status}=${count}`).join(', ') || 'none'}`,
    '',
    '> Agent 07 creates a review item only when matching text + music and narrated videos are complete for the same revision.',
    '> Approval, rejection, change requests, destination selection, and scheduling are human dashboard actions. Agent 07 never performs them automatically.',
    '> Dashboard: /creddy/content-bank',
    '',
    '| Content | Revision | Text + music | Narrated | Review status | Instagram caption | TikTok caption | CTA | Claims | Sources |',
    '|---|---:|---|---|---|---|---|---|---:|---:|',
    ...reviewRows.map(({ content, bank, jobs }) => {
      const revision = bank?.revision ?? Math.max(1, ...jobs.map((job) => job.revision));
      const textStatus = jobs.find((job) => job.revision === revision && job.format === 'text_music')?.status ?? 'missing';
      const narratedStatus = jobs.find((job) => job.revision === revision && job.format === 'narrated')?.status ?? 'missing';
      return `| ${cell(content.hook)} | ${revision} | ${cell(textStatus)} | ${cell(narratedStatus)} | ${cell(bank?.status ?? 'waiting_for_video_pair')} | ${cell(content.platformCaptions?.instagram ?? content.caption)} | ${cell(content.platformCaptions?.tiktok ?? content.caption)} | ${cell(`${content.cta.label} → ${content.cta.deepLink}`)} | ${content.factualClaims.length} | ${content.sourceUrls.length} |`;
    }),
  ];
  const reviewPath = safeDataPath(outputRoot, '07-content-bank-review.md');
  await writeMarkdown(reviewPath, reviewLines.join('\n'));
  written.push(reviewPath);

  const publishingManifest = await latestManifest(root, 'publishing');
  const scheduledRecords = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '11-scheduled')))
      .map((path) => readJson<ContentBankRecord>(path)),
  );
  const publishedRecords = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '12-published')))
      .map((path) => readJson<ContentBankRecord>(path)),
  );
  const publishRecordsById = new Map<string, ContentBankRecord>();
  for (const record of [...scheduledRecords, ...publishedRecords]) publishRecordsById.set(record.id, record);
  const contentById = new Map(productionContent.map((content) => [content.id, content]));
  const publishRows = [...publishRecordsById.values()].flatMap((record) =>
    (record.destinations ?? []).map((destination) => ({
      record,
      destination,
      hook: contentById.get(record.contentPackageId)?.hook ?? record.contentPackageId,
    })),
  );
  const destinationCounts = publishRows.reduce<Record<string, number>>((counts, row) => {
    counts[row.destination.status] = (counts[row.destination.status] ?? 0) + 1;
    return counts;
  }, {});
  const publishingLines = [
    '# Agent 08 — Approved schedule publishing', '',
    `Generated: ${new Date().toISOString()}`,
    `Latest run: ${publishingManifest?.runId ?? 'none'}`,
    `Latest manifest: input=${publishingManifest?.inputCount ?? 0}, published/reconciled=${publishingManifest?.outputCount ?? 0}, skipped=${publishingManifest?.skippedCount ?? 0}, failed=${publishingManifest?.failedCount ?? 0}`,
    `Destination status: ${Object.entries(destinationCounts).map(([status, count]) => `${status}=${count}`).join(', ') || 'none'}`,
    '',
    '> Agent 08 reads only human-approved records in 11-scheduled. It never approves content or creates destinations.',
    '> Live automation remains paused until real Creddy Blotato account mappings and one staging post are verified.',
    '',
    '| Content | Platform | Format | Account | Scheduled for | Status | Submission ID | Published URL | Error |',
    '|---|---|---|---|---|---|---|---|---|',
    ...publishRows.map(({ hook, destination }) => `| ${cell(hook)} | ${cell(destination.platform)} | ${cell(destination.format)} | ${cell(destination.account)} | ${cell(destination.scheduledFor)} | ${cell(destination.status)} | ${cell(destination.submissionId ?? '')} | ${cell(destination.publishedUrl ?? '')} | ${cell(destination.error ?? '')} |`),
  ];
  const publishingPath = safeDataPath(outputRoot, '08-publishing.md');
  await writeMarkdown(publishingPath, publishingLines.join('\n'));
  written.push(publishingPath);

  const indexPath = safeDataPath(outputRoot, 'README.md');
  const indexLines = [
    '# Creddy observable pipeline control center',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    'Every scheduled agent produces a visible Codex task result and refreshes the durable report listed below. Open the numbered reports in order to audit why an article was collected, accepted or rejected, scored, turned into content, rendered, reviewed, and published.',
    '',
    '| Agent | Responsibility | Current durable output | Current count/status |',
    '|---:|---|---|---|',
    `| 01 | Discover all configured sources and store raw articles | 01-discovery-and-collection.md; 00-discovery; 01-raw | ${rawRecords.length} raw records retained |`,
    `| 02 | Clean, verify, reject, and deduplicate | 02-filtering-and-deduplication.md; 03-canonical-news | ${canonical.length} canonical; ${rejected.length} rejected |`,
    `| 03 | Product fit, popularity, importance, confidence, and routing | 03-ranking-and-routing.md; 04-analysis-queue | ${decisions.length} ranked; ${pendingAnalysis.length} pending |`,
    `| 04 | Scripts, narration, captions, CTA, claims, and briefs | 04-content-writing.md; 06-content-drafts | ${drafts.length} drafts |`,
    `| 05 | Visual theme, scenes, and Creddy expressions | 05-visual-planning.md; 06-visual-plans | ${visualPlans.length} plans |`,
    `| 06 | Text+music and narrated Video Factory renders | 06-video-production.md; 07-video-jobs; 08-rendered-videos | ${productionJobs.filter((job) => job.status === 'done').length}/${productionJobs.length} jobs done |`,
    `| 07 | Complete-pair handoff to human review | 07-content-bank-review.md; 09-pending-approval | ${reviewStatusCounts.pending_review ?? 0} current-production items pending review |`,
    `| 08 | Human-approved Blotato scheduling and reconciliation | 08-publishing.md; 11-scheduled; 12-published | ${destinationCounts.published ?? 0} published; ${destinationCounts.pending ?? 0} pending |`,
    '',
    '## Audit sequence',
    '',
    '1. Open `01-discovery-and-collection.md` for the complete discovered URL ledger and Firecrawl execution.',
    '2. Open `02-filtering-and-deduplication.md` for canonical, rejected, duplicate, and verification decisions.',
    '3. Open `03-ranking-and-routing.md` for every product-fit, popularity, importance, confidence, route, and written reason.',
    '4. Continue through reports 04–08 to trace downstream copy, visuals, videos, human review, and publishing.',
    '',
    '> Generic gas offers are blocked by the current Creddy product-fit safeguards. Any older gas item visible in the Content Bank is legacy test data created before those safeguards, not an output of the current ranked pipeline.',
    '',
    '## Reports',
    '',
    ...written.map((path) => `- ${path.split('/').at(-1)}`),
  ];
  await writeMarkdown(indexPath, indexLines.join('\n'));
  written.push(indexPath);
  return written;
}
