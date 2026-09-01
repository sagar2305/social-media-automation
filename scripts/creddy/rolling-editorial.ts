import { createHash } from 'node:crypto';
import { mkdir, open } from 'node:fs/promises';
import { dirname } from 'node:path';

import { calculateEditorialPriorityScore, validateAnalysisDecision } from './analysis-stage.js';
import {
  createRunId,
  listJsonFiles,
  pathExists,
  readJson,
  safeDataPath,
  withStageLock,
  writeJsonAtomic,
} from './pipeline-store.js';
import type {
  AnalysisDecisionRecord,
  CanonicalNewsRecord,
  CreddyDistributionMode,
  CreddyOfficialVerificationRecord,
  CreddyProductionAuthorization,
} from './pipeline-types.js';

export type EditorialFreshnessClass = 'breaking' | 'time_sensitive' | 'timely' | 'evergreen';
export type EditorialLaneState = 'active' | 'authorized' | 'in_production' | 'review' | 'published' | 'rejected' | 'expired';

export interface RollingEditorialRecord {
  version: 1;
  canonicalId: string;
  decisionId: string;
  analysisInputHash: string;
  decisionHash: string;
  officialVerificationHash: string;
  firstSeenAt: string;
  lastSeenAt: string;
  sourcePublishedAt?: string;
  eventOccurredAt: string;
  freshnessClass: EditorialFreshnessClass;
  hardExpiresAt: string;
  basePriority: number;
  effectivePriority: number;
  effectiveFreshness: number;
  lastCalculatedAt: string;
  channels: {
    news: EditorialLaneState;
    blog: EditorialLaneState;
    social: EditorialLaneState;
  };
}

export interface DailyEditorialSelection {
  version: 1;
  id: string;
  editorialDate: string;
  selectedAt: string;
  selectionRunId: string;
  canonicalIds: string[];
  scores: Array<{ canonicalId: string; effectivePriority: number }>;
  analysisPendingAtSelection?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;
const CLASS_TTL_MS: Record<EditorialFreshnessClass, number> = {
  breaking: 72 * 60 * 60 * 1000,
  time_sensitive: 7 * DAY_MS,
  timely: 14 * DAY_MS,
  evergreen: 180 * DAY_MS,
};

function hash(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

export function decisionFingerprint(decision: AnalysisDecisionRecord): string {
  const { productionAuthorization: _authorization, ...immutable } = decision;
  return hash(immutable);
}

export function officialVerificationFingerprint(decision: AnalysisDecisionRecord): string {
  return decision.verificationGate ? hash(decision.verificationGate.official) : 'none';
}

export function urgentEventFingerprint(decision: AnalysisDecisionRecord, _record: RollingEditorialRecord): string {
  const normalize = (value: unknown): string => String(value ?? '').trim().toLowerCase().replace(/\s+/g, ' ');
  return hash({
    materialEventType: decision.materialEventType,
    affectedPrograms: [...decision.affectedPrograms].map(normalize).sort(),
    expiryDate: decision.expiry?.slice(0, 10) ?? null,
  });
}

async function claimUrgentChannel(
  root: string,
  eventFingerprint: string,
  eventOccurredAt: string,
  channel: 'blog' | 'social',
  authorizationId: string,
  now: Date,
): Promise<boolean> {
  const eventTime = Date.parse(eventOccurredAt);
  if (!Number.isFinite(eventTime)) return false;
  for (const priorPath of await listJsonFiles(safeDataPath(root, '05-editorial-ledger', 'urgent-claims'))) {
    const prior = await readJson<{ eventFingerprint?: string; eventOccurredAt?: string; channel?: string }>(priorPath);
    const priorTime = Date.parse(prior.eventOccurredAt ?? '');
    if (prior.eventFingerprint === eventFingerprint && prior.channel === channel && Number.isFinite(priorTime) &&
        Math.abs(priorTime - eventTime) <= 12 * 60 * 60 * 1000) return false;
  }
  const eventKey = eventOccurredAt.replace(/[^0-9A-Za-z]+/g, '').slice(0, 18);
  const path = safeDataPath(root, '05-editorial-ledger', 'urgent-claims', `${eventFingerprint}-${channel}-${eventKey}.json`);
  await mkdir(dirname(path), { recursive: true });
  try {
    const handle = await open(path, 'wx');
    try {
      await handle.writeFile(`${JSON.stringify({ version: 1, eventFingerprint, eventOccurredAt, channel, authorizationId, claimedAt: now.toISOString() }, null, 2)}\n`);
    } finally {
      await handle.close();
    }
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') return false;
    throw error;
  }
}

function validDate(value: string | undefined | null): number | undefined {
  if (!value) return undefined;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function freshnessClassForDecision(decision: AnalysisDecisionRecord): EditorialFreshnessClass {
  if (decision.freshnessClass) return decision.freshnessClass;
  if (decision.editorialDisposition === 'evergreen') return 'evergreen';
  if (decision.expiry) return 'time_sensitive';
  return 'timely';
}

export function eventTimeForDecision(decision: AnalysisDecisionRecord, article: CanonicalNewsRecord): number {
  return validDate(decision.eventOccurredAt) ?? validDate(article.publishedAt) ?? validDate(article.fetchedAt) ??
    validDate(decision.analyzedAt) ?? 0;
}

export function hardExpiryForDecision(
  decision: AnalysisDecisionRecord,
  article: CanonicalNewsRecord,
): number {
  const explicit = validDate(decision.expiry);
  if (explicit) return explicit;
  return eventTimeForDecision(decision, article) + CLASS_TTL_MS[freshnessClassForDecision(decision)];
}

export function currentFreshnessScore(
  freshnessClass: EditorialFreshnessClass,
  eventAt: number,
  hardExpiresAt: number,
  now: Date,
): number {
  if (now.getTime() >= hardExpiresAt) return 0;
  const age = Math.max(0, now.getTime() - eventAt);
  const lifetime = Math.max(1, hardExpiresAt - eventAt);
  const remaining = Math.max(0, 1 - age / lifetime);
  const floor = freshnessClass === 'evergreen' ? 45 : 0;
  const ceiling = freshnessClass === 'breaking' ? 100 : freshnessClass === 'time_sensitive' ? 95 : freshnessClass === 'timely' ? 85 : 70;
  return Math.round(floor + (ceiling - floor) * remaining);
}

function effectivePriority(decision: AnalysisDecisionRecord, freshnessScore: number): number {
  if (!decision.viralPotential || decision.productFitScore === undefined) return decision.editorialPriorityScore ?? 0;
  return calculateEditorialPriorityScore({ ...decision, freshnessScore });
}

function nyParts(now: Date): { date: string; hour: number } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23',
  }).formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) => parts.find((part) => part.type === type)?.value ?? '';
  return { date: `${value('year')}-${value('month')}-${value('day')}`, hour: Number(value('hour')) };
}

async function decisionsByCanonical(root: string): Promise<Map<string, AnalysisDecisionRecord>> {
  const decisions = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '04-analysis-queue', 'completed')))
      .map((path) => readJson<AnalysisDecisionRecord>(path)),
  );
  return new Map(decisions.map((decision) => [decision.canonicalId, decision]));
}

async function articlesByCanonical(root: string): Promise<Map<string, CanonicalNewsRecord>> {
  const articles = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '03-canonical-news', 'approved')))
      .map((path) => readJson<CanonicalNewsRecord>(path)),
  );
  return new Map(articles.map((article) => [article.canonicalId, article]));
}

export async function reconcileRollingEditorialLedger(root: string, now = new Date()): Promise<RollingEditorialRecord[]> {
  return withStageLock(root, 'rolling_editorial', async () => {
    const [decisions, articles] = await Promise.all([decisionsByCanonical(root), articlesByCanonical(root)]);
    const records: RollingEditorialRecord[] = [];
    for (const [canonicalId, decision] of decisions) {
      const article = articles.get(canonicalId);
      if (!article || !decision.analysisInputHash) continue;
      const path = safeDataPath(root, '05-editorial-ledger', 'items', `${canonicalId}.json`);
      const previous = await pathExists(path) ? await readJson<RollingEditorialRecord>(path) : undefined;
      const freshnessClass = freshnessClassForDecision(decision);
      const eventAt = eventTimeForDecision(decision, article);
      const hardExpiresAt = hardExpiryForDecision(decision, article);
      const freshness = currentFreshnessScore(freshnessClass, eventAt, hardExpiresAt, now);
      const expired = hardExpiresAt <= now.getTime();
      const authorization = decision.productionAuthorization;
      const revisionChanged = previous !== undefined && previous.analysisInputHash !== decision.analysisInputHash;
      const priorChannels = previous?.channels;
      const preserveTerminal = (state: EditorialLaneState | undefined): EditorialLaneState =>
        state === 'published' || state === 'rejected' ? state : 'active';
      const channels = revisionChanged
        ? {
            news: preserveTerminal(priorChannels?.news),
            blog: preserveTerminal(priorChannels?.blog),
            social: preserveTerminal(priorChannels?.social),
          }
        : priorChannels ?? { news: 'active' as const, blog: 'active' as const, social: 'active' as const };
      if (authorization) {
        channels.blog = channels.blog === 'published' ? 'published' : 'authorized';
        if (authorization.distributionMode === 'article_and_social') {
          channels.social = channels.social === 'published' ? 'published' : 'authorized';
        }
      }
      if (expired) {
        if (channels.news === 'active') channels.news = 'expired';
        if (channels.blog === 'active') channels.blog = 'expired';
        if (channels.social === 'active') channels.social = 'expired';
      }
      const record: RollingEditorialRecord = {
        version: 1,
        canonicalId,
        decisionId: decision.id,
        analysisInputHash: decision.analysisInputHash,
        decisionHash: decisionFingerprint(decision),
        officialVerificationHash: officialVerificationFingerprint(decision),
        firstSeenAt: previous?.firstSeenAt ?? article.fetchedAt,
        lastSeenAt: article.fetchedAt,
        sourcePublishedAt: article.publishedAt,
        eventOccurredAt: new Date(eventAt).toISOString(),
        freshnessClass,
        hardExpiresAt: new Date(hardExpiresAt).toISOString(),
        basePriority: decision.editorialPriorityScore ?? 0,
        effectivePriority: effectivePriority(decision, freshness),
        effectiveFreshness: freshness,
        lastCalculatedAt: now.toISOString(),
        channels,
      };
      await writeJsonAtomic(path, record);
      records.push(record);
    }
    return records.sort((left, right) => right.effectivePriority - left.effectivePriority);
  });
}

function eligibleForDaily(record: RollingEditorialRecord, decision: AnalysisDecisionRecord): boolean {
  return record.effectivePriority >= 75 && (decision.productFitScore ?? 0) >= 75 &&
    record.channels.blog === 'active' && record.channels.social === 'active' &&
    ['produce', 'evergreen'].includes(decision.editorialDisposition ?? '') &&
    !decision.materialConflict && record.effectiveFreshness > 0;
}

function diversified(decisions: AnalysisDecisionRecord[], records: Map<string, RollingEditorialRecord>, limit: number): string[] {
  const selected: string[] = [];
  const categories = new Map<string, number>();
  const programs = new Map<string, number>();
  for (const decision of decisions.sort((left, right) =>
    (records.get(right.canonicalId)?.effectivePriority ?? 0) - (records.get(left.canonicalId)?.effectivePriority ?? 0))) {
    if (selected.length >= limit) break;
    const category = decision.portfolioCategory ?? 'uncategorized';
    const program = decision.affectedPrograms[0] ?? 'none';
    if ((categories.get(category) ?? 0) >= 2 || (programs.get(program) ?? 0) >= 2) continue;
    selected.push(decision.canonicalId);
    categories.set(category, (categories.get(category) ?? 0) + 1);
    programs.set(program, (programs.get(program) ?? 0) + 1);
  }
  return selected;
}

export async function selectDailyEditorialSlate(
  root: string,
  now = new Date(),
  limit = 5,
): Promise<DailyEditorialSelection | undefined> {
  const ny = nyParts(now);
  if (ny.hour < 6) return undefined;
  const path = safeDataPath(root, '05-editorial-ledger', 'daily-selections', `${ny.date}.json`);
  if (await pathExists(path)) return readJson<DailyEditorialSelection>(path);
  const analysisPending = (await listJsonFiles(safeDataPath(root, '04-analysis-queue', 'pending'))).length;
  // Prefer the first clean post-06:00 tick. At 09:00 ET the deterministic
  // fallback prevents one poisoned analysis task from blocking the day forever.
  if (analysisPending > 0 && ny.hour < 9) return undefined;
  const records = await reconcileRollingEditorialLedger(root, now);
  const recordById = new Map(records.map((record) => [record.canonicalId, record]));
  const decisions = [...(await decisionsByCanonical(root)).values()]
    .filter((decision) => {
      const record = recordById.get(decision.canonicalId);
      return Boolean(record && eligibleForDaily(record, decision));
    });
  const canonicalIds = diversified(decisions, recordById, limit);
  const selection: DailyEditorialSelection = {
    version: 1,
    id: `daily-${ny.date}`,
    editorialDate: ny.date,
    selectedAt: now.toISOString(),
    selectionRunId: createRunId(now),
    canonicalIds,
    scores: canonicalIds.map((canonicalId) => ({ canonicalId, effectivePriority: recordById.get(canonicalId)!.effectivePriority })),
    analysisPendingAtSelection: analysisPending,
  };
  await writeJsonAtomic(path, selection);
  return selection;
}

export function passesUrgentPreGate(
  record: RollingEditorialRecord,
  decision: AnalysisDecisionRecord,
  article: CanonicalNewsRecord,
  now = new Date(),
): boolean {
  try {
    validateAnalysisDecision(decision);
  } catch {
    return false;
  }
  const explicitEventAt = validDate(decision.eventOccurredAt);
  const eventClaim = decision.claims.find((claim) => claim.field === 'event_occurred_at');
  const claimedEventAt = typeof eventClaim?.value === 'string' ? validDate(eventClaim.value) : undefined;
  const eventAt = Date.parse(record.eventOccurredAt);
  const discoveredAt = Date.parse(record.firstSeenAt);
  return decision.editorialDisposition === 'produce' && decision.route === 'auto_process' &&
    decision.verificationState === 'ready' && decision.rejectionReasons.length === 0 &&
    explicitEventAt !== undefined && claimedEventAt === explicitEventAt && eventAt === explicitEventAt &&
    record.freshnessClass === 'breaking' && Number.isFinite(eventAt) && now.getTime() - eventAt <= 6 * 60 * 60 * 1000 &&
    now.getTime() - eventAt >= 0 && Number.isFinite(discoveredAt) && discoveredAt >= eventAt &&
    discoveredAt - eventAt <= 60 * 60 * 1000 &&
    Boolean(decision.materialEventType) && (decision.productFitScore ?? 0) >= 85 && decision.importanceScore >= 90 &&
    (decision.viralPotential?.score ?? 0) >= 85 && (decision.viralPotential?.urgency ?? 0) >= 90 &&
    decision.confidenceScore >= 85 && (decision.channelScores?.blogSeo ?? 0) >= 80 &&
    (decision.channelScores?.instagramTikTok ?? 0) >= 85 && (decision.viralPotential?.visualPotential ?? 0) >= 75 &&
    article.canonicalId === decision.canonicalId && !decision.materialConflict;
}

export function passesUrgentVerifiedGate(
  record: RollingEditorialRecord,
  decision: AnalysisDecisionRecord,
  article: CanonicalNewsRecord,
  now = new Date(),
): boolean {
  if (!passesUrgentPreGate(record, decision, article, now)) return false;
  const official = decision.verificationGate?.official;
  const checkedAt = validDate(official?.checkedAt);
  const eventOutcome = official?.claimOutcomes.find((claim) => claim.field === 'event_occurred_at');
  return official?.status === 'verified' && checkedAt !== undefined && now.getTime() - checkedAt <= 30 * 60 * 1000 &&
    eventOutcome?.status === 'verified' && eventOutcome.officialUrls.length > 0 &&
    official.claimOutcomes.length === decision.claims.length && official.claimOutcomes.every((claim) => claim.status === 'verified') &&
    official.remainingRequirements.length === 0 && official.failureReasons.length === 0;
}

async function urgentAuthorizations(root: string): Promise<CreddyProductionAuthorization[]> {
  return Promise.all(
    (await listJsonFiles(safeDataPath(root, '05-editorial-ledger', 'authorizations')))
      .map((path) => readJson<CreddyProductionAuthorization>(path)),
  ).then((items) => items.filter((item) => item.lane === 'urgent'));
}

async function reconcileAuthorizationWrites(root: string): Promise<void> {
  for (const path of await listJsonFiles(safeDataPath(root, '05-editorial-ledger', 'authorizations'))) {
    const authorization = await readJson<CreddyProductionAuthorization>(path);
    const decisionPath = safeDataPath(root, '04-analysis-queue', 'completed', `${authorization.canonicalId}.json`);
    if (!(await pathExists(decisionPath))) continue;
    const decision = await readJson<AnalysisDecisionRecord>(decisionPath);
    if (decision.productionAuthorization?.id === authorization.id) {
      if (!(await pathExists(safeDataPath(root, '05-content-opportunities', `${decision.id}.json`)))) {
        await writeJsonAtomic(safeDataPath(root, '05-content-opportunities', `${decision.id}.json`), decision);
      }
      continue;
    }
    if (decision.productionAuthorization || decision.id !== authorization.decisionId ||
        decision.analysisInputHash !== authorization.analysisInputHash ||
        decisionFingerprint(decision) !== authorization.decisionHash ||
        officialVerificationFingerprint(decision) !== authorization.officialVerificationHash) continue;
    const restored = { ...decision, productionAuthorization: authorization };
    await writeJsonAtomic(decisionPath, restored);
    await writeJsonAtomic(safeDataPath(root, '05-content-opportunities', `${decision.id}.json`), restored);
  }
}

function sameNyDate(left: Date, right: Date): boolean {
  return nyParts(left).date === nyParts(right).date;
}

async function writeAuthorization(
  root: string,
  decision: AnalysisDecisionRecord,
  record: RollingEditorialRecord,
  input: { lane: 'urgent' | 'daily'; distributionMode: CreddyDistributionMode; reason: string; approvalMode: 'auto_urgent' | 'human_review'; selectionRunId: string; expiresAt?: string },
  now: Date,
): Promise<CreddyProductionAuthorization> {
  const authorization: CreddyProductionAuthorization = {
    version: 1,
    id: `authorization-${input.lane}-${decision.canonicalId}-${decision.analysisInputHash!.slice(0, 12)}`,
    canonicalId: decision.canonicalId,
    decisionId: decision.id,
    analysisInputHash: decision.analysisInputHash!,
    decisionHash: record.decisionHash,
    officialVerificationHash: record.officialVerificationHash,
    selectedAt: now.toISOString(),
    expiresAt: input.expiresAt,
    lane: input.lane,
    distributionMode: input.distributionMode,
    reason: input.reason,
    approvalMode: input.approvalMode,
    selectionRunId: input.selectionRunId,
  };
  const authorizedDecision = { ...decision, productionAuthorization: authorization };
  await writeJsonAtomic(safeDataPath(root, '05-editorial-ledger', 'authorizations', `${authorization.id}.json`), authorization);
  await writeJsonAtomic(safeDataPath(root, '05-content-opportunities', `${decision.id}.json`), authorizedDecision);
  await writeJsonAtomic(safeDataPath(root, '04-analysis-queue', 'completed', `${decision.canonicalId}.json`), authorizedDecision);
  return authorization;
}

export async function authorizeRollingProduction(root: string, now = new Date(), selectedDaily?: DailyEditorialSelection | null): Promise<{
  urgent: CreddyProductionAuthorization[];
  daily: CreddyProductionAuthorization[];
}> {
  return withStageLock(root, 'production_authorization', async () => {
    await reconcileAuthorizationWrites(root);
    const records = await reconcileRollingEditorialLedger(root, now);
    const [decisions, articles, existing] = await Promise.all([
      decisionsByCanonical(root), articlesByCanonical(root), urgentAuthorizations(root),
    ]);
    const daily = selectedDaily === undefined ? await selectDailyEditorialSlate(root, now) : selectedDaily ?? undefined;
    const recordById = new Map(records.map((record) => [record.canonicalId, record]));
    const urgent: CreddyProductionAuthorization[] = [];
    const dailyAuthorizations: CreddyProductionAuthorization[] = [];
    const urgentToday = existing.filter((item) => sameNyDate(new Date(item.selectedAt), now));
    const lastUrgentSocial = existing.filter((item) => item.distributionMode === 'article_and_social')
      .sort((left, right) => Date.parse(right.selectedAt) - Date.parse(left.selectedAt))[0];
    let blogBudget = Math.max(0, 2 - urgentToday.length);
    let socialAvailable = !lastUrgentSocial || now.getTime() - Date.parse(lastUrgentSocial.selectedAt) >= 6 * 60 * 60 * 1000;
    const authorizedThisRun = new Set<string>();
    for (const record of records) {
      if (blogBudget <= 0) break;
      const decision = decisions.get(record.canonicalId);
      const article = articles.get(record.canonicalId);
      if (!decision || !article || decision.productionAuthorization || !passesUrgentVerifiedGate(record, decision, article, now)) continue;
      const eventAt = Date.parse(record.eventOccurredAt);
      const prospectiveId = `authorization-urgent-${decision.canonicalId}-${decision.analysisInputHash!.slice(0, 12)}`;
      const eventFingerprint = urgentEventFingerprint(decision, record);
      if (!(await claimUrgentChannel(root, eventFingerprint, record.eventOccurredAt, 'blog', prospectiveId, now))) continue;
      const socialClaimed = socialAvailable
        ? await claimUrgentChannel(root, eventFingerprint, record.eventOccurredAt, 'social', prospectiveId, now)
        : false;
      const mode: CreddyDistributionMode = socialClaimed ? 'article_and_social' : 'article_only';
      urgent.push(await writeAuthorization(root, decision, record, {
        lane: 'urgent', distributionMode: mode, approvalMode: 'auto_urgent', selectionRunId: createRunId(now),
        expiresAt: new Date(eventAt + 12 * 60 * 60 * 1000).toISOString(),
        reason: 'Fully verified breaking event passed the unattended urgent publication policy.',
      }, now));
      authorizedThisRun.add(decision.canonicalId);
      blogBudget -= 1;
      if (socialClaimed) socialAvailable = false;
    }
    for (const canonicalId of daily?.canonicalIds ?? []) {
      const decision = decisions.get(canonicalId);
      const record = recordById.get(canonicalId);
      if (!decision || !record || authorizedThisRun.has(canonicalId) || decision.productionAuthorization ||
          !decision.verificationGate || decision.verificationGate.official.status === 'conflicting') continue;
      dailyAuthorizations.push(await writeAuthorization(root, decision, record, {
        lane: 'daily', distributionMode: 'article_and_social', approvalMode: 'human_review', selectionRunId: daily!.selectionRunId,
        reason: 'Selected from the rolling diversified daily editorial slate.',
      }, now));
    }
    return { urgent, daily: dailyAuthorizations };
  });
}

export async function verificationCandidateIds(
  root: string,
  now = new Date(),
  limit = 5,
  selectedDaily?: DailyEditorialSelection | null,
): Promise<string[]> {
  const records = await reconcileRollingEditorialLedger(root, now);
  const [decisions, articles] = await Promise.all([decisionsByCanonical(root), articlesByCanonical(root)]);
  const officialAttempts = await Promise.all(
    (await listJsonFiles(safeDataPath(root, '04-official-verification', 'completed')))
      .map((path) => readJson<CreddyOfficialVerificationRecord>(path)),
  );
  const attemptsByCanonical = new Map<string, CreddyOfficialVerificationRecord[]>();
  for (const attempt of officialAttempts) {
    const attempts = attemptsByCanonical.get(attempt.canonicalId) ?? [];
    attempts.push(attempt);
    attemptsByCanonical.set(attempt.canonicalId, attempts);
  }
  const daily = selectedDaily === undefined ? await selectDailyEditorialSlate(root, now) : selectedDaily ?? undefined;
  const dailyIds = new Set(daily?.canonicalIds ?? []);
  const candidates = records.flatMap((record) => {
    const decision = decisions.get(record.canonicalId);
    const article = articles.get(record.canonicalId);
    if (!decision || !article || record.effectiveFreshness <= 0 || decision.materialConflict) return [];
    const official = decision.verificationGate?.official;
    const checkedAt = validDate(official?.checkedAt);
    const urgent = passesUrgentPreGate(record, decision, article, now);
    const news = validDate(article.publishedAt) !== undefined && now.getTime() - validDate(article.publishedAt)! <= 72 * 60 * 60 * 1000 &&
      decision.verificationState === 'ready' && ['auto_process', 'evergreen_queue'].includes(decision.route);
    const selectedDaily = dailyIds.has(record.canonicalId);
    if (!urgent && !news && !selectedDaily) return [];
    const maxAge = urgent ? 30 * 60 * 1000 : record.freshnessClass === 'evergreen' ? 30 * DAY_MS : DAY_MS;
    if (official?.status === 'verified' && checkedAt !== undefined && now.getTime() - checkedAt <= maxAge) return [];
    if (official?.status === 'conflicting') return [];
    if (checkedAt !== undefined && official?.status === 'inconclusive' && now.getTime() - checkedAt < DAY_MS) return [];
    if (checkedAt !== undefined && official?.status === 'unavailable') {
      const unavailableAttempts = (attemptsByCanonical.get(record.canonicalId) ?? [])
        .filter((attempt) => attempt.status === 'unavailable').length;
      const retryAfter = unavailableAttempts <= 1 ? 6 * 60 * 60 * 1000 : DAY_MS;
      if (now.getTime() - checkedAt < retryAfter) return [];
    }
    return [{ id: record.canonicalId, priority: urgent ? 3 : news ? 2 : 1, score: record.effectivePriority }];
  });
  return candidates.sort((left, right) => right.priority - left.priority || right.score - left.score)
    .slice(0, limit).map((item) => item.id);
}

/** Explicit News projection list. The News publisher must never scan the whole
 * completed analysis directory in shared-workflow mode. */
export async function newsProjectionCandidateIds(root: string, now = new Date()): Promise<string[]> {
  const [decisions, articles] = await Promise.all([decisionsByCanonical(root), articlesByCanonical(root)]);
  return [...decisions.values()].flatMap((decision) => {
    const article = articles.get(decision.canonicalId);
    const publishedAt = validDate(article?.publishedAt);
    if (!article || publishedAt === undefined || now.getTime() - publishedAt > 72 * 60 * 60 * 1000 || now.getTime() < publishedAt) return [];
    if (decision.rubricVersion !== 'creddy-ranking-v3' || decision.verificationState !== 'ready' ||
        !['auto_process', 'evergreen_queue'].includes(decision.route) || !decision.verificationGate) return [];
    return [decision.canonicalId];
  });
}

export async function rollingEditorialStatus(root: string, now = new Date()): Promise<Record<string, unknown>> {
  const records = await reconcileRollingEditorialLedger(root, now);
  return {
    active: records.filter((record) => record.effectiveFreshness > 0).length,
    expired: records.filter((record) => record.effectiveFreshness === 0).length,
    top20: records.filter((record) => record.effectiveFreshness > 0).slice(0, 20).map((record) => ({
      canonicalId: record.canonicalId,
      freshnessClass: record.freshnessClass,
      effectivePriority: record.effectivePriority,
      hardExpiresAt: record.hardExpiresAt,
      channels: record.channels,
    })),
  };
}
