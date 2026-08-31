import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';

type ContentStatus =
  | 'pending_review'
  | 'changes_requested'
  | 'rendering_revision'
  | 'approved'
  | 'scheduled'
  | 'published'
  | 'rejected';

type ContentBankRecord = Record<string, unknown> & {
  id: string;
  createdAt: string;
  updatedAt?: string;
  status: ContentStatus;
  approvedAt?: string;
  approvedBy?: string;
  rejectedAt?: string;
  rejectedBy?: string;
  restoredAt?: string;
  destinations?: Array<Record<string, unknown> & {
    status?: string;
    lastCheckedAt?: string;
    publishedAt?: string;
    submittedAt?: string;
  }>;
  scheduleHistory?: Array<{ changedAt?: string }>;
  reviewHistory?: Array<{
    action: 'approved' | 'rejected' | 'undone';
    actor: string;
    changedAt: string;
    fromStatus: ContentStatus;
    toStatus: ContentStatus;
  }>;
  articlePreviewPath?: string;
  articleReview?: {
    status: 'needs_assets' | 'pending_review' | 'changes_requested' | 'approved' | 'publishing' | 'published' | 'publish_failed';
    approvedBy?: string;
    approvedAt?: string;
    approvedContentSha256?: string;
    publishingStartedAt?: string;
    publishAttemptedAt?: string;
    publishAttempts?: number;
    publishError?: string;
    cmsIdentifier?: string;
    publishedAt?: string;
    publishedUrl?: string;
    requestedBy?: string;
    requestedAt?: string;
    changeNotes?: string;
    blockers?: string[];
  };
};

type ContentDraftRecord = {
  id: string;
  hook: string;
  textScenes?: string[];
  scriptLines?: string[];
  instagramCaption?: string;
  tiktokCaption?: string;
  caption?: string;
  hashtags?: string[];
  cta?: { label?: string; deepLink?: string };
  brief?: string;
  sourceUrls?: string[];
  factualClaims?: Array<{ field?: string; value?: unknown; confidence?: number }>;
  article?: {
    title: string;
    dek: string;
    excerpt: string;
    category: string;
    readingMinutes: number;
    sourceUrls: string[];
    blocks: unknown[];
  };
};

export type CreddySlackFullReview = {
  id: string;
  status: ContentStatus;
  revision: number;
  createdAt: string;
  hook: string;
  scriptLines: string[];
  instagramCaption: string;
  tiktokCaption: string;
  hashtags: string[];
  cta?: { label?: string; deepLink?: string };
  brief?: string;
  sourceUrls: string[];
  factualClaims: Array<{ field?: string; value?: unknown; confidence?: number }>;
  reviewHistory: NonNullable<ContentBankRecord['reviewHistory']>;
  article?: ContentDraftRecord['article'];
  articleReview?: ContentBankRecord['articleReview'];
  articlePreviewAttached: boolean;
};

const DEFAULT_DATA_ROOT = '/Users/mohitkourav/Documents/ChatGPT/Social media automation data';
const BANK_DIRECTORIES = [
  '12-published',
  '11-scheduled',
  '10-approved',
  '09-pending-approval',
  '13-rejected-content',
] as const;

function creddyRoot(env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env): string {
  const configured = env.CREDDY_DATA_ROOT?.trim() || DEFAULT_DATA_ROOT;
  if (!isAbsolute(configured)) throw new Error('CREDDY_DATA_ROOT must be absolute');
  return resolve(configured, 'creddy');
}

function validateId(id: string): string {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,199}$/.test(id)) throw new Error('Invalid content id');
  return id;
}

function safePath(root: string, ...segments: string[]): string {
  if (segments.some((segment) => !segment || segment === '.' || segment === '..')) {
    throw new Error('Unsafe Creddy data path');
  }
  const target = resolve(root, ...segments);
  const rel = relative(root, target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw new Error('Creddy path escaped its data root');
  return target;
}

async function readJson<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, 'utf8')) as T;
}

async function writeJsonAtomic(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx' });
  await rename(temporary, path);
}

function freshness(record: ContentBankRecord): number {
  const values = [
    record.updatedAt,
    record.createdAt,
    record.approvedAt,
    record.rejectedAt,
    record.restoredAt,
    ...(record.destinations ?? []).flatMap((destination) => [
      destination.lastCheckedAt,
      destination.publishedAt,
      destination.submittedAt,
    ]),
    ...(record.scheduleHistory ?? []).map((entry) => entry.changedAt),
  ];
  return Math.max(0, ...values.map((value) => value ? Date.parse(value) : 0).filter(Number.isFinite));
}

function existingReviewHistory(record: ContentBankRecord): NonNullable<ContentBankRecord['reviewHistory']> {
  if (record.reviewHistory?.length) return record.reviewHistory;
  if (record.status === 'approved' && record.approvedBy && record.approvedAt) {
    return [{ action: 'approved', actor: record.approvedBy, changedAt: record.approvedAt, fromStatus: 'pending_review', toStatus: 'approved' }];
  }
  if (record.status === 'rejected' && record.rejectedBy && record.rejectedAt) {
    return [{ action: 'rejected', actor: record.rejectedBy, changedAt: record.rejectedAt, fromStatus: 'pending_review', toStatus: 'rejected' }];
  }
  return [];
}

async function findRecord(root: string, id: string): Promise<{ path: string; record: ContentBankRecord }> {
  validateId(id);
  const candidates: Array<{ path: string; record: ContentBankRecord }> = [];
  for (const directory of BANK_DIRECTORIES) {
    const path = safePath(root, directory, `${id}.json`);
    try {
      candidates.push({ path, record: await readJson<ContentBankRecord>(path) });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  candidates.sort((left, right) => freshness(right.record) - freshness(left.record));
  if (!candidates[0]) throw new Error('Creddy content item not found');
  return candidates[0];
}

export async function approveCreddyContentFromSlack(input: {
  id: string;
  approvedBy: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}, now = new Date()): Promise<void> {
  const root = creddyRoot(input.env);
  const { path, record } = await findRecord(root, input.id);
  if (record.status === 'approved') return;
  if (record.status !== 'pending_review' && record.status !== 'changes_requested') {
    throw new Error(`Cannot approve an item in ${record.status} state`);
  }
  const approved = {
    ...record,
    status: 'approved' as const,
    approvedBy: input.approvedBy,
    approvedAt: now.toISOString(),
    destinations: [],
    reviewHistory: [
      ...existingReviewHistory(record),
      { action: 'approved' as const, actor: input.approvedBy, changedAt: now.toISOString(), fromStatus: record.status, toStatus: 'approved' as const },
    ],
  };
  await writeJsonAtomic(path, approved);
  await writeJsonAtomic(safePath(root, '09-pending-approval', `${record.id}.json`), approved);
  await writeJsonAtomic(safePath(root, '10-approved', `${record.id}.json`), approved);
}

export async function rejectCreddyContentFromSlack(input: {
  id: string;
  rejectedBy: string;
  reason: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}, now = new Date()): Promise<void> {
  const root = creddyRoot(input.env);
  const { path, record } = await findRecord(root, input.id);
  if (record.status === 'rejected') return;
  if (record.status === 'published') {
    throw new Error(`Cannot reject an item in ${record.status} state`);
  }
  const active = (record.destinations ?? []).some((destination) =>
    ['pending', 'submitted', 'draft_sent', 'blotato_draft', 'scheduled', 'publishing'].includes(destination.status ?? ''),
  );
  if (active) {
    throw new Error('Confirm that every external Blotato or TikTok delivery has been removed before rejecting this post');
  }
  const reason = input.reason.trim();
  if (reason.length < 5 || reason.length > 2000) throw new Error('Rejection reason must be 5–2000 characters');
  const rejected = {
    ...record,
    status: 'rejected' as const,
    statusBeforeRejection: record.status,
    destinationsBeforeRejection: record.destinations ?? [],
    rejectedBy: input.rejectedBy,
    rejectedAt: now.toISOString(),
    rejectionReason: reason,
    reviewHistory: [
      ...existingReviewHistory(record),
      { action: 'rejected' as const, actor: input.rejectedBy, changedAt: now.toISOString(), fromStatus: record.status, toStatus: 'rejected' as const },
    ],
  };
  await writeJsonAtomic(path, rejected);
  await writeJsonAtomic(safePath(root, '13-rejected-content', `${record.id}.json`), rejected);
  await writeJsonAtomic(safePath(root, '09-pending-approval', `${record.id}.json`), rejected);
}

export async function undoCreddyContentDecisionFromSlack(input: {
  id: string;
  undoneBy: string;
  env?: NodeJS.ProcessEnv | Record<string, string | undefined>;
}, now = new Date()): Promise<void> {
  const root = creddyRoot(input.env);
  const { path, record } = await findRecord(root, input.id);
  if (record.status === 'pending_review') {
    const history = existingReviewHistory(record);
    const last = history.at(-1);
    if (last?.action === 'undone') return;
    if (last?.action === 'approved' || last?.action === 'rejected') {
      const reconciled: ContentBankRecord = {
        ...record,
        reviewHistory: [
          ...history,
          { action: 'undone', actor: input.undoneBy, changedAt: now.toISOString(), fromStatus: last.toStatus, toStatus: 'pending_review' },
        ],
        restoredBy: input.undoneBy,
        restoredAt: now.toISOString(),
      };
      await writeJsonAtomic(path, reconciled);
      await writeJsonAtomic(safePath(root, '09-pending-approval', `${record.id}.json`), reconciled);
      if (last.toStatus === 'approved') {
        await writeJsonAtomic(safePath(root, '10-approved', `${record.id}.json`), reconciled);
      } else {
        await writeJsonAtomic(safePath(root, '13-rejected-content', `${record.id}.json`), reconciled);
      }
      return;
    }
  }
  if (record.status !== 'approved' && record.status !== 'rejected') {
    throw new Error(`Cannot undo an item in ${record.status} state`);
  }
  const restored: ContentBankRecord = {
    ...record,
    status: 'pending_review',
    destinations: [],
    restoredBy: input.undoneBy,
    restoredAt: now.toISOString(),
    reviewHistory: [
      ...existingReviewHistory(record),
      { action: 'undone', actor: input.undoneBy, changedAt: now.toISOString(), fromStatus: record.status, toStatus: 'pending_review' },
    ],
  };
  await writeJsonAtomic(path, restored);
  await writeJsonAtomic(safePath(root, '09-pending-approval', `${record.id}.json`), restored);
  if (record.status === 'approved') {
    await writeJsonAtomic(safePath(root, '10-approved', `${record.id}.json`), restored);
  } else {
    await writeJsonAtomic(safePath(root, '13-rejected-content', `${record.id}.json`), restored);
  }
}

export async function loadCreddySlackFullReview(
  id: string,
  env: NodeJS.ProcessEnv | Record<string, string | undefined> = process.env,
): Promise<CreddySlackFullReview> {
  const root = creddyRoot(env);
  const { record } = await findRecord(root, id);
  const draftId = String(record.contentDraftId ?? record.contentPackageId ?? '');
  validateId(draftId);
  const draft = await readJson<ContentDraftRecord>(safePath(root, '06-content-drafts', `${draftId}.json`));
  const instagramCaption = draft.instagramCaption ?? draft.caption ?? '';
  const tiktokCaption = draft.tiktokCaption ?? draft.caption ?? '';
  const reviewHistory = existingReviewHistory(record);
  return {
    id: record.id,
    status: record.status,
    revision: Number(record.revision ?? 1),
    createdAt: record.createdAt,
    hook: draft.hook,
    scriptLines: draft.textScenes ?? draft.scriptLines ?? [],
    instagramCaption,
    tiktokCaption,
    hashtags: draft.hashtags ?? [],
    cta: draft.cta,
    brief: draft.brief,
    sourceUrls: draft.sourceUrls ?? [],
    factualClaims: draft.factualClaims ?? [],
    reviewHistory,
    article: draft.article,
    articleReview: record.articleReview,
    articlePreviewAttached: Boolean(record.articlePreviewPath),
  };
}
