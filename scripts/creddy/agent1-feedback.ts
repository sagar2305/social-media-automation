import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { normalizeArticleUrl } from './article-identity.js';
import { CREDDY_DISCOVERY_PROFILE, CREDDY_SOURCES } from './config.js';
import {
  listJsonFiles,
  pathExists,
  readJson,
  safeDataPath,
  withStageLock,
  writeJsonAtomic,
} from './pipeline-store.js';

export type Agent1FeedbackDecision = 'retain' | 'reject';

export interface Agent1FeedbackInput {
  decision: Agent1FeedbackDecision;
  canonicalUrl: string;
  sourceId: string;
  sourceName: string;
  runId: string;
  reason: string;
  note?: string;
  createdAt?: string;
}

export interface Agent1FeedbackRecord extends Agent1FeedbackInput {
  version: 1;
  id: string;
  sequence: number;
  createdAt: string;
}

export interface Agent1FeedbackSnapshot {
  version: 1;
  feedbackRecordCount: number;
  currentDecisionCount: number;
  recordsHash: string;
  totals: Record<Agent1FeedbackDecision, number>;
  domains: Array<{
    domain: string;
    retained: number;
    rejected: number;
    retainedRunCount: number;
    retainedRunIds: string[];
    sourceIds: string[];
    sampleUrls: string[];
    reasons: string[];
    alreadyConfigured: boolean;
    promisingSourceCandidate: boolean;
  }>;
  reasons: Record<string, number>;
}

function stableId(input: Agent1FeedbackInput): string {
  return createHash('sha256')
    .update(JSON.stringify({
      decision: input.decision,
      canonicalUrl: input.canonicalUrl,
      sourceId: input.sourceId,
      runId: input.runId,
      reason: input.reason,
      note: input.note ?? '',
    }))
    .digest('hex')
    .slice(0, 24);
}

export async function recordAgent1Feedback(
  root: string,
  input: Agent1FeedbackInput,
): Promise<{ record: Agent1FeedbackRecord; created: boolean; snapshot: Agent1FeedbackSnapshot }> {
  if (!['retain', 'reject'].includes(input.decision)) throw new Error('Feedback decision must be retain or reject');
  if (!input.sourceId.trim() || !input.sourceName.trim() || !input.runId.trim() || !input.reason.trim()) {
    throw new Error('Feedback source, run, and reason are required');
  }
  return withStageLock(root, 'agent1_feedback', async () => {
    const normalized: Agent1FeedbackInput = {
      ...input,
      canonicalUrl: normalizeArticleUrl(input.canonicalUrl),
      sourceId: input.sourceId.trim(),
      sourceName: input.sourceName.trim(),
      runId: input.runId.trim(),
      reason: input.reason.trim(),
      note: input.note?.trim() || undefined,
      createdAt: input.createdAt ?? new Date().toISOString(),
    };
    const id = stableId(normalized);
    const path = safeDataPath(root, 'feedback', 'agent-01', 'records', `${id}.json`);
    if (await pathExists(path)) {
      const record = await readJson<Agent1FeedbackRecord>(path);
      const snapshot = await buildAgent1FeedbackSnapshot(root);
      await writeAgent1FeedbackSnapshot(root, snapshot);
      return { record, created: false, snapshot };
    }

    const existing = await Promise.all(
      (await listJsonFiles(safeDataPath(root, 'feedback', 'agent-01', 'records')))
        .map((recordPath) => readJson<Agent1FeedbackRecord>(recordPath)),
    );
    const sequence = existing.reduce((maximum, record) => Math.max(maximum, record.sequence ?? 0), 0) + 1;
    const record: Agent1FeedbackRecord = {
      version: 1,
      ...normalized,
      id,
      sequence,
      createdAt: normalized.createdAt!,
    };
    await writeJsonAtomic(path, record);
    const snapshot = await buildAgent1FeedbackSnapshot(root);
    await writeAgent1FeedbackSnapshot(root, snapshot);
    return { record, created: true, snapshot };
  });
}

export async function buildAgent1FeedbackSnapshot(root: string): Promise<Agent1FeedbackSnapshot> {
  const records = await Promise.all(
    (await listJsonFiles(safeDataPath(root, 'feedback', 'agent-01', 'records')))
      .map((path) => readJson<Agent1FeedbackRecord>(path)),
  );
  records.sort((a, b) =>
    (a.sequence ?? 0) - (b.sequence ?? 0) || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
  const latestByUrl = new Map<string, Agent1FeedbackRecord>();
  for (const record of records) latestByUrl.set(record.canonicalUrl, record);
  const current = [...latestByUrl.values()];
  const multiTenantDomains = new Set(['youtube.com', 'youtu.be', 'reddit.com']);
  const configuredSourceIds = new Set(CREDDY_SOURCES.map((source) => source.id));
  const configuredDomains = new Set(CREDDY_SOURCES
    .map((source) => new URL(normalizeArticleUrl(source.url)).hostname.replace(/^www\./, ''))
    .filter((domain) => !multiTenantDomains.has(domain)));
  const domainStats = new Map<string, {
    domain: string;
    retained: number;
    rejected: number;
    retainedRuns: Set<string>;
    sourceIds: Set<string>;
    sampleUrls: Set<string>;
    reasons: Set<string>;
  }>();
  const reasons: Record<string, number> = {};
  for (const record of current) {
    const domain = new URL(record.canonicalUrl).hostname.replace(/^www\./, '');
    const proposalKey = multiTenantDomains.has(domain) ? `${domain}::${record.sourceId}` : domain;
    const stats = domainStats.get(proposalKey) ?? {
      domain,
      retained: 0,
      rejected: 0,
      retainedRuns: new Set<string>(),
      sourceIds: new Set<string>(),
      sampleUrls: new Set<string>(),
      reasons: new Set<string>(),
    };
    if (record.decision === 'retain') {
      stats.retained += 1;
      stats.retainedRuns.add(record.runId);
      if (stats.sampleUrls.size < 3) stats.sampleUrls.add(record.canonicalUrl);
    } else {
      stats.rejected += 1;
    }
    stats.sourceIds.add(record.sourceId);
    stats.reasons.add(record.reason);
    domainStats.set(proposalKey, stats);
    reasons[record.reason] = (reasons[record.reason] ?? 0) + 1;
  }
  const recordsHash = createHash('sha256').update(JSON.stringify(records)).digest('hex');
  return {
    version: 1,
    feedbackRecordCount: records.length,
    currentDecisionCount: current.length,
    recordsHash,
    totals: {
      retain: current.filter((item) => item.decision === 'retain').length,
      reject: current.filter((item) => item.decision === 'reject').length,
    },
    domains: [...domainStats.values()].map((stats) => {
      const sourceIds = [...stats.sourceIds].sort();
      const alreadyConfigured = multiTenantDomains.has(stats.domain)
        ? sourceIds.every((sourceId) => configuredSourceIds.has(sourceId))
        : configuredDomains.has(stats.domain);
      return {
        domain: stats.domain,
        retained: stats.retained,
        rejected: stats.rejected,
        retainedRunCount: stats.retainedRuns.size,
        retainedRunIds: [...stats.retainedRuns].sort(),
        sourceIds,
        sampleUrls: [...stats.sampleUrls],
        reasons: [...stats.reasons].sort(),
        alreadyConfigured,
        promisingSourceCandidate:
          !alreadyConfigured &&
          stats.retained >= CREDDY_DISCOVERY_PROFILE.promisingSourceMinimumRetained &&
          stats.retainedRuns.size >= CREDDY_DISCOVERY_PROFILE.promisingSourceMinimumRuns,
      };
    }).sort((a, b) => b.retained - a.retained || a.domain.localeCompare(b.domain)),
    reasons,
  };
}

async function writeAgent1FeedbackSnapshot(root: string, snapshot: Agent1FeedbackSnapshot): Promise<void> {
  const immutable = safeDataPath(root, 'feedback', 'agent-01', 'snapshots', `${snapshot.recordsHash}.json`);
  if (!(await pathExists(immutable))) await writeJsonAtomic(immutable, snapshot);
  await writeJsonAtomic(safeDataPath(root, 'feedback', 'agent-01', 'snapshot.json'), snapshot);
  const reportPath = safeDataPath(root, 'reports', 'latest', '01-editorial-feedback.md');
  await mkdir(dirname(reportPath), { recursive: true });
  const lines = [
    '# Agent 01 — Editorial calibration feedback', '',
    `Feedback records: ${snapshot.feedbackRecordCount}; current decisions: ${snapshot.currentDecisionCount}`,
    `Retained: ${snapshot.totals.retain}; rejected: ${snapshot.totals.reject}`,
    `Reproducible records hash: ${snapshot.recordsHash}`, '',
    '> A promising domain is a proposal only. It is never crawled or promoted automatically.', '',
    '| Domain | Source identity | Retained | Rejected | Retained runs | Already configured | Promising source proposal | Examples | Reasons |',
    '|---|---|---:|---:|---:|---|---|---|---|',
    ...snapshot.domains.map((item) =>
      `| ${item.domain} | ${item.sourceIds.join(', ')} | ${item.retained} | ${item.rejected} | ${item.retainedRunCount} (${item.retainedRunIds.join(', ')}) | ${item.alreadyConfigured ? 'yes' : 'no'} | ${item.promisingSourceCandidate ? 'yes' : 'no'} | ${item.sampleUrls.join('<br>')} | ${item.reasons.join(', ')} |`),
  ];
  await writeFile(reportPath, `${lines.join('\n')}\n`, 'utf8');
}
